"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { connectImap, FlowPort, accountToImapConfig } from "./imap";
import { decryptCredentials } from "./crypto";
import type { Doc } from "../_generated/dataModel";
import { materializeDraftAttachments } from "./draftAttachments";

export async function buildDraftSource(
  ctx: Pick<ActionCtx, "runQuery" | "runAction" | "storage">,
  draft: Doc<"drafts">,
  account: Doc<"accounts">,
): Promise<Buffer> {
  const attachments: {
    filename: string;
    contentType?: string;
    content: Buffer;
  }[] = [];
  for (const att of draft.attachments) {
    if (att.kind === "upload") {
      const blob = await ctx.storage.get(att.storageId);
      if (!blob) throw new Error("Draft attachment upload not found");
      attachments.push({
        filename: att.filename,
        contentType: att.contentType,
        content: Buffer.from(await blob.arrayBuffer()),
      });
    } else {
      const data = await ctx.runAction(internal.node.content.fetchAttachmentData, {
        messageId: att.messageId,
        attachmentId: att.attachmentId,
      });
      attachments.push({
        filename: att.filename,
        contentType: att.contentType,
        content: Buffer.from(data),
      });
    }
  }
  const mail = new MailComposer({
    from: `${account.displayName} <${account.email}>`,
    to: draft.to.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)),
    cc: draft.cc.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)),
    bcc: draft.bcc.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)),
    subject: draft.subject,
    text: draft.text || undefined,
    html: draft.html || undefined,
    messageId: `<${draft.messageIdHeader}>`,
    headers: { "X-Post-Draft-Id": draft.messageIdHeader },
    attachments,
  });
  const compiled = mail.compile();
  // Drafts are private mailbox copies, not SMTP payloads.
  compiled.keepBcc = true;
  return await new Promise<Buffer>((resolve, reject) => {
    compiled.build((err, msg) =>
      err ? reject(err) : resolve(msg as Buffer),
    );
  });
}

// APPENDs a new draft version to the Drafts mailbox, then removes the
// previous remote copy. Returns the new remote uid when the server reports
// it (UIDPLUS).
export const pushDraftNow = internalAction({
  args: { draftId: v.id("drafts") },
  handler: async (ctx, args): Promise<{ uid: number | undefined }> => {
    const draft = await ctx.runQuery(internal.syncStore.draftById, args);
    if (!draft || !draft.remoteDirty) return { uid: draft?.remoteUid };
    const owner = crypto.randomUUID();
    try {
      await ctx.runMutation(internal.syncStore.acquireLease, { accountId: draft.accountId, owner, ttlMs: 240_000 });
    } catch {
      await ctx.scheduler.runAfter(30_000, internal.node.draftsOps.pushDraftNow, args);
      return { uid: draft.remoteUid };
    }
    try { return await ctx.runAction(internal.node.draftsOps.pushDraftUnderLease, args); }
    finally { await ctx.runMutation(internal.syncStore.releaseLease, { accountId: draft.accountId, owner }); }
  },
});

// Also called by the sync engine, which already owns the account lease.
export const pushDraftUnderLease = internalAction({
  args: { draftId: v.id("drafts") },
  handler: async (ctx, args): Promise<{ uid: number | undefined }> => {
    let draft: Doc<"drafts"> | null = await ctx.runQuery(
      internal.syncStore.draftById,
      { draftId: args.draftId },
    );
    if (!draft || !draft.remoteDirty) return { uid: draft?.remoteUid };
    const account: Doc<"accounts"> | null = await ctx.runQuery(
      internal.syncStore.getAccountDoc,
      { accountId: draft.accountId },
    );
    const secret = await ctx.runQuery(internal.syncStore.getSecret, {
      accountId: draft.accountId,
    });
    if (!account || !secret) return { uid: undefined };
    const { username, password } = decryptCredentials(secret);
    const cfg = accountToImapConfig(account);
    const client = await connectImap({ ...cfg, username, password });
    try {
      const port = new FlowPort(client);
      draft = await materializeDraftAttachments(ctx, draft);
      if (!draft) return { uid: undefined };
      const source = await buildDraftSource(ctx, draft, account);
      const draftsState = await ctx.runQuery(
        internal.syncStore.folderByRole,
        { accountId: draft.accountId, role: "drafts" },
      );
      const draftsPath = draftsState?.path ?? "Drafts";
      if (!draftsState) await port.createMailbox("Drafts");
      const { uid } = await port.append(
        draftsPath,
        source,
        ["\\Draft", "\\Seen"],
        new Date(draft.updatedAt),
      );
      const prevUid: number | undefined = draft.remoteUid;
      const folderId = await ctx.runMutation(internal.syncStore.upsertFolder, {
        accountId: draft.accountId,
        path: draftsPath,
        role: "drafts",
      });
      const recorded = await ctx.runMutation(internal.syncStore.markDraftPushed, {
        draftId: args.draftId,
        folderId,
        uid,
        pushedUpdatedAt: draft.updatedAt,
        pushedAccountId: draft.accountId,
      });
      if (!recorded && uid !== undefined) {
        // The draft was sent or discarded while APPEND was in flight.
        await port.expunge(draftsPath, [uid], true);
        return { uid: undefined };
      }
      if (prevUid !== undefined && prevUid !== uid) {
        try {
          await port.expunge(draftsPath, [prevUid], true);
        } catch {
          // The old remote copy will be cleaned on the next sync.
        }
      }
      return { uid };
    } finally {
      await client.logout().catch(() => client.close());
    }
  },
});

// Removes a draft's remote copy from the Drafts mailbox.
export const deleteRemoteDraftNow = internalAction({
  args: {
    accountId: v.id("accounts"),
    folderPath: v.string(),
    uid: v.number(),
  },
  handler: async (ctx, args) => {
    const secret = await ctx.runQuery(internal.syncStore.getSecret, {
      accountId: args.accountId,
    });
    const account = await ctx.runQuery(internal.syncStore.getAccountDoc, {
      accountId: args.accountId,
    });
    if (!account || !secret) return;
    const { username, password } = decryptCredentials(secret);
    const cfg = accountToImapConfig(account);
    const client = await connectImap({ ...cfg, username, password });
    try {
      const port = new FlowPort(client);
      await port.expunge(args.folderPath, [args.uid], true);
    } finally {
      await client.logout().catch(() => client.close());
    }
  },
});
