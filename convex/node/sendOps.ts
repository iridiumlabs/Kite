"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
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
    const source = await new Promise<Buffer>((resolve, reject) => {
      mail.compile().build((err, msg) =>
        err ? reject(err) : resolve(msg as Buffer),
      );
    });

    const transport = smtpTransport({
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      username,
      password,
    });
    try {
      await ctx.runMutation(internal.send.markSendUncertain, {
        sendLogId: args.sendLogId,
        draftId: args.draftId,
      });
      await transport.sendMail({
        envelope: {
          from: account.email,
          to: [...to, ...cc, ...bcc].map((a) => a.email),
        },
        raw: source,
      });
    } catch (error) {
      // An explicit SMTP 4xx/5xx response is a rejection, not an ambiguous
      // disconnect after DATA. Transport/timeouts remain reserved as uncertain.
      const code = (error as { responseCode?: number } | null)?.responseCode;
      if (typeof code === "number" && code >= 400 && code < 600) {
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
          const res = await port.append(sentPath, source, ["\\Seen"]);
          sentUid = res.uid;
        }
      } finally {
        await client.logout().catch(() => client.close());
      }
    } catch {
      // The message was sent; a Sent copy failure is reconciled by sync.
    }

    const completion = {
      sendLogId: args.sendLogId,
      draftId: args.draftId,
      replyToMessageDocId: args.replyToMessageDocId,
      accountId: args.accountId,
      sentFolderId,
      sentUid,
      messageIdHeader: args.messageIdHeader,
      inReplyTo: args.inReplyTo,
      references: args.references ?? [],
      subject: args.subject,
      from: { name: account.displayName, email: account.email },
      to: to as never,
      cc: cc as never,
      bcc: bcc as never,
      text: args.text ?? "",
      attachments: attachments.map((a, i) => ({
        id: `a${i}`,
        filename: a.filename,
        contentType: a.contentType ?? "application/octet-stream",
        size: a.content.length,
        inline: false,
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
