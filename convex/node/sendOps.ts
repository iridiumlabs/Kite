"use node";

import { v } from "convex/values";
import { isDefiniteSmtpFailure } from "../lib/smtpFailure";
import { smtpDelivery } from "../lib/smtpDelivery";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { MailParserPort } from "./mailParser";
import { connectImap, FlowPort, accountToImapConfig } from "./imap";
import { decryptCredentials } from "./crypto";
import { smtpTransport } from "./accountsOps";
import type { Address } from "../lib/types";

const SENT_SEARCH_WAIT_MS = 2000;
const ATTACHMENT_TOTAL_MAX = 25 * 1024 * 1024;

const sendAttachmentV = v.union(
  v.object({
    storageId: v.id("_storage"),
    filename: v.optional(v.string()),
    contentType: v.optional(v.string()),
  }),
  v.object({ messageId: v.id("messages"), attachmentId: v.string() }),
  v.object({
    filename: v.string(),
    contentType: v.string(),
    contentBase64: v.string(),
  }),
);

function fmt(a: Address): string {
  return a.name ? `${a.name} <${a.email}>` : a.email;
}

// Composes the RFC822 message, sends it over SMTP, then locates or appends
// the copy in the Sent folder. The caller records the result in sendLog.
export const performSend = internalAction({
  args: {
    accountId: v.id("accounts"),
    sendLogId: v.id("sendLog"),
    draftId: v.optional(v.id("drafts")),
    replyToMessageDocId: v.optional(v.id("messages")),
    to: v.array(v.any()),
    cc: v.optional(v.array(v.any())),
    bcc: v.optional(v.array(v.any())),
    subject: v.string(),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.array(v.string())),
    messageIdHeader: v.string(),
    attachments: v.optional(v.array(sendAttachmentV)),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    messageId: Id<"messages"> | undefined;
    deduped: boolean;
    rejectedRecipients?: string[];
  }> => {
    const account = await ctx.runQuery(
      internal.syncStore.getAccountDoc,
      { accountId: args.accountId },
    );
    const secret = await ctx.runQuery(internal.syncStore.getSecret, {
      accountId: args.accountId,
    });
    if (!account || !secret) throw new Error("Account not found");
    const { username, password } = decryptCredentials(secret);

    const attachments: {
      filename: string;
      contentType?: string;
      content: Buffer;
    }[] = [];
    for (const att of args.attachments ?? []) {
      if ("storageId" in att) {
        const blob = await ctx.storage.get(att.storageId);
        if (!blob) throw new Error("Attachment upload not found");
        attachments.push({
          filename: att.filename ?? "attachment",
          contentType: att.contentType ?? blob.type,
          content: Buffer.from(await blob.arrayBuffer()),
        });
      } else if ("messageId" in att) {
        const data = await ctx.runAction(
          internal.node.content.fetchAttachmentData,
          { messageId: att.messageId, attachmentId: att.attachmentId },
        );
        const meta = await ctx.runQuery(internal.syncStore.messageRemoteRef, {
          messageId: att.messageId,
        });
        const stored = meta?.message.attachments.find(
          (a: { id: string }) => a.id === att.attachmentId,
        );
        attachments.push({
          filename: stored?.filename ?? "attachment",
          contentType: stored?.contentType,
          content: Buffer.from(data as ArrayBuffer),
        });
      } else {
        attachments.push({
          filename: att.filename,
          contentType: att.contentType,
          content: Buffer.from(att.contentBase64, "base64"),
        });
      }
    }
    const totalBytes = attachments.reduce((s, a) => s + a.content.length, 0);
    if (totalBytes > ATTACHMENT_TOTAL_MAX) {
      throw new Error("Attachments exceed the 25 MB limit.");
    }

    // Capture forwarded bytes on the locked draft before SMTP. A partial
    // delivery may keep the draft but delete its old remote draft copy.
    if (args.draftId) {
      const uploads: { messageId: Id<"messages">; attachmentId: string; storageId: Id<"_storage">; size: number }[] = [];
      let submitted = false;
      try {
        for (const [i, att] of (args.attachments ?? []).entries()) {
          if (!("messageId" in att)) continue;
          const bytes = Uint8Array.from(attachments[i].content);
          const storageId = await ctx.storage.store(new Blob([bytes], { type: attachments[i].contentType }));
          uploads.push({ messageId: att.messageId, attachmentId: att.attachmentId, storageId, size: bytes.byteLength });
        }
        if (uploads.length) {
          submitted = true;
          const draft = await ctx.runMutation(internal.syncStore.materializeDraftAttachments, {
            draftId: args.draftId, accountId: args.accountId, uploads, allowSending: true,
          });
          if (!draft) throw new Error("Draft attachments could not be preserved");
        }
      } catch (error) {
        if (!submitted) for (const upload of uploads) await ctx.storage.delete(upload.storageId);
        throw error;
      }
    }

    const headers: Record<string, string> = {};
    if (args.inReplyTo) headers["In-Reply-To"] = `<${args.inReplyTo}>`;
    if (args.references && args.references.length > 0) {
      headers["References"] = args.references
        .map((r) => `<${r}>`)
        .join(" ");
    }

    const to = args.to as Address[];
    const cc = (args.cc ?? []) as Address[];
    const bcc = (args.bcc ?? []) as Address[];

    const buildMimeSource = async (keepBcc: boolean) => {
      const mail = new MailComposer({
        from: `${account.displayName} <${account.email}>`,
        to: to.map(fmt),
        cc: cc.map(fmt),
        bcc: bcc.map(fmt),
        subject: args.subject,
        text: args.text,
        html: args.html,
        messageId: `<${args.messageIdHeader}>`,
        headers,
        attachments,
      });
      const compiled = mail.compile();
      if (keepBcc) compiled.keepBcc = true;
      return await new Promise<Buffer>((resolve, reject) => {
        compiled.build((err, msg) =>
          err ? reject(err) : resolve(msg as Buffer),
        );
      });
    };

    const source = await buildMimeSource(false);
    const sentSource = bcc.length > 0 ? await buildMimeSource(true) : source;

    // Use the same MIME identifiers as attachment downloads and sync.
    // Parse before SMTP so a parser failure is proven pre-delivery.
    const parsed = await new MailParserPort().parse(source);

    // Store the complete private MIME before SMTP and reserve a recovery job
    // atomically with the uncertain state. An action crash after acceptance
    // must not lose partial-delivery finalization or the attachment bytes.
    const sourceStorageId = await ctx.storage.store(
      new Blob([new Uint8Array(sentSource)], { type: "message/rfc822" }),
    );
    const recovery = {
      sendLogId: args.sendLogId, draftId: args.draftId,
      replyToMessageDocId: args.replyToMessageDocId, accountId: args.accountId,
      sourceStorageId, messageIdHeader: args.messageIdHeader, inReplyTo: args.inReplyTo,
      references: args.references ?? [], subject: args.subject,
      from: { name: account.displayName, email: account.email }, to, cc, bcc,
      text: (args.text ?? "").slice(0, 240),
      attachments: parsed.attachments.map(a => ({
        id: a.id, filename: a.filename, contentType: a.contentType,
        size: a.size, inline: a.inline, ...(a.cid ? { cid: a.cid } : {}),
      })),
    };
    const transport = smtpTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      username,
      password,
    });
    let delivery: ReturnType<typeof smtpDelivery> | undefined;
    try {
      await ctx.runMutation(internal.send.markSendUncertain, {
        sendLogId: args.sendLogId,
        draftId: args.draftId,
        recovery,
      });
      const result = await transport.sendMail({
        envelope: {
          from: account.email,
          to: [...to, ...cc, ...bcc].map((a) => a.email),
        },
        raw: source,
      });
      delivery = smtpDelivery(result, [...to, ...cc, ...bcc]);
    } catch (error) {
      // Release only proven non-delivery; generic socket errors/timeouts can
      // hide acceptance after DATA and must keep their reservation.
      if (isDefiniteSmtpFailure(error)) {
        await ctx.runMutation(internal.send.failSend, {
          sendLogId: args.sendLogId,
          draftId: args.draftId,
          error: error instanceof Error ? error.message : "SMTP rejected message",
          definiteRejection: true,
        });
      }
      throw error;
    } finally {
      transport.close();
      await ctx.runMutation(internal.send.finishSmtpAttempt, {
        sendLogId: args.sendLogId,
        accepted: !!delivery,
        rejectedRecipients: delivery?.rejected.map(a => a.email),
      }).catch(() => {}); // Keep the original SMTP outcome and continue finalization.
    }

    // Give the server a moment to file the message, then check whether it
    // appended a copy in Sent before adding one ourselves.
    await new Promise((r) => setTimeout(r, SENT_SEARCH_WAIT_MS));

    let sentUid: number | undefined;
    let sentFolderId: Id<"folders"> | undefined;
    try {
      const cfg = accountToImapConfig(account);
      const client = await connectImap({ ...cfg, username, password });
      try {
        const port = new FlowPort(client);
        const sentFolder = await ctx.runQuery(
          internal.syncStore.folderByRole,
          { accountId: args.accountId, role: "sent" },
        );
        const sentPath = sentFolder?.path ?? "Sent";
        if (!sentFolder) await port.createMailbox(sentPath);
        sentFolderId = await ctx.runMutation(internal.syncStore.upsertFolder, {
          accountId: args.accountId,
          path: sentPath,
          role: "sent",
        });
        const hits = await port.searchUids(sentPath);
        if (hits.length > 0) {
          const metas: { uid: number; messageIdHeader: string }[] = [];
          for await (const m of port.fetchMeta(sentPath, hits.slice(-25))) {
            metas.push(m);
          }
          const found = metas.find(
            (m) => m.messageIdHeader === args.messageIdHeader,
          );
          sentUid = found?.uid;
        }
        if (sentUid === undefined) {
          const res = await port.append(sentPath, sentSource, ["\\Seen"]);
          sentUid = res.uid;
        }
      } finally {
        await client.logout().catch(() => client.close());
      }
    } catch {
      // Sent append failed; persist source and retry below.
    }

    const completion = {
      sendLogId: args.sendLogId,
      draftId: args.draftId,
      replyToMessageDocId: args.replyToMessageDocId,
      accountId: args.accountId,
      sentFolderId,
      sentUid,
      sourceStorageId,
      messageIdHeader: args.messageIdHeader,
      inReplyTo: args.inReplyTo,
      references: args.references ?? [],
      subject: args.subject,
      from: { name: account.displayName, email: account.email },
      to: to.filter(a => delivery.accepted.includes(a)),
      cc: cc.filter(a => delivery.accepted.includes(a)),
      bcc: bcc.filter(a => delivery.accepted.includes(a)),
      rejectedRecipients: delivery.rejected.map(a => a.email),
      text: args.text ?? "",
      attachments: parsed.attachments.map(a => ({
        id: a.id, filename: a.filename, contentType: a.contentType,
        size: a.size, inline: a.inline, ...(a.cid ? { cid: a.cid } : {}),
      })),
    };
    try {
      return await ctx.runMutation(internal.send.completeSend, completion);
    } catch (error) {
      // Retry local finalization only, never SMTP. completeSend is idempotent,
      // so an accepted message cannot be delivered twice after a lost response.
      await ctx.scheduler.runAfter(5000, internal.send.completeSend, completion);
      throw error;
    }
  },
});

export const retrySentAppend = internalAction({
  args: {
    messageId: v.id("messages"),
    sourceStorageId: v.id("_storage"),
    accountId: v.id("accounts"),
    messageIdHeader: v.string(),
    attempt: v.number(),
  },
  handler: async (ctx, args) => {
    const ref = await ctx.runQuery(internal.syncStore.messageRemoteRef, {
      messageId: args.messageId,
    });
    if (!ref?.message || (ref.message.uid !== undefined && ref.message.folderId)) {
      await ctx.storage.delete(args.sourceStorageId).catch(() => {});
      return;
    }

    const owner = crypto.randomUUID();
    try {
      await ctx.runMutation(internal.syncStore.acquireLease, {
        accountId: args.accountId,
        owner,
        ttlMs: 120_000,
      });
    } catch {
      await ctx.scheduler.runAfter(15_000, internal.node.sendOps.retrySentAppend, args);
      return;
    }

    try {
      const blob = await ctx.storage.get(args.sourceStorageId);
      if (!blob) return;
      const source = Buffer.from(await blob.arrayBuffer());

      const account = await ctx.runQuery(internal.syncStore.getAccountDoc, {
        accountId: args.accountId,
      });
      const secret = await ctx.runQuery(internal.syncStore.getSecret, {
        accountId: args.accountId,
      });
      if (!account || !secret) return;

      const { username, password } = decryptCredentials(secret);
      const cfg = accountToImapConfig(account);
      const client = await connectImap({ ...cfg, username, password });
      try {
        const port = new FlowPort(client);
        const sentFolder = await ctx.runQuery(internal.syncStore.folderByRole, {
          accountId: args.accountId,
          role: "sent",
        });
        const sentPath = sentFolder?.path ?? "Sent";
        if (!sentFolder) await port.createMailbox(sentPath);
        const sentFolderId = await ctx.runMutation(internal.syncStore.upsertFolder, {
          accountId: args.accountId,
          path: sentPath,
          role: "sent",
        });

        let sentUid: number | undefined;
        const hits = await port.searchUids(sentPath);
        if (hits.length > 0) {
          const metas: { uid: number; messageIdHeader: string }[] = [];
          for await (const m of port.fetchMeta(sentPath, hits.slice(-25))) {
            metas.push(m);
          }
          const found = metas.find(
            (m) => m.messageIdHeader === args.messageIdHeader,
          );
          sentUid = found?.uid;
        }

        if (sentUid === undefined) {
          const res = await port.append(sentPath, source, ["\\Seen"]);
          sentUid = res.uid;
        }

        if (sentUid !== undefined) {
          await ctx.runMutation(internal.send.recordSentAppendSuccess, {
            messageId: args.messageId,
            folderId: sentFolderId,
            uid: sentUid,
            storageId: args.sourceStorageId,
          });
        }
      } finally {
        await client.logout().catch(() => client.close());
      }
    } catch {
      if (args.attempt < 8) {
        const delay = Math.min(300_000, 5000 * Math.pow(2, args.attempt));
        await ctx.scheduler.runAfter(delay, internal.node.sendOps.retrySentAppend, {
          ...args,
          attempt: args.attempt + 1,
        });
      }
    } finally {
      await ctx.runMutation(internal.syncStore.releaseLease, {
        accountId: args.accountId,
        owner,
      });
    }
  },
});
