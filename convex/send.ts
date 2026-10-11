import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { requireUserId } from "./model/auth";
import { ingestMessage } from "./model/ingest";
import { enqueueOp } from "./model/pendingOps";
import { addressV } from "./validators";
import {
  replyRecipients,
  threadingHeaders,
  replySubjectFor,
  forwardSubjectFor,
  newMessageId,
  appendOriginalQuote,
  htmlToText,
} from "./lib/compose";
import { sendContentHash } from "./lib/idempotency";
import type { Address } from "./lib/types";

const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const ATTACHMENT_TOTAL_MAX = 25 * 1024 * 1024;

const apiKeyArg = { apiKey: v.optional(v.string()) };

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

export const beginSend = internalMutation({
  args: {
    userId: v.string(),
    accountId: v.id("accounts"),
    idempotencyKey: v.optional(v.string()),
    contentHash: v.string(),
    messageIdHeader: v.string(),
    allowDuplicate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("sendLog")
        .withIndex("by_user_key", (q) =>
          q
            .eq("userId", args.userId)
            .eq("idempotencyKey", args.idempotencyKey!),
        )
        .first();
      if (existing) {
        return { existing } as const;
      }
    }
    const since = Date.now() - DUPLICATE_WINDOW_MS;
    const recent = await ctx.db
      .query("sendLog")
      .withIndex("by_user_hash", (q) =>
        q.eq("userId", args.userId).eq("contentHash", args.contentHash),
      )
      .collect();
    const dup = recent.find(
      (r) =>
        r.createdAt >= since &&
        (r.status === "sending" || r.status === "sent"),
    );
    if (dup && !args.allowDuplicate) {
      throw new Error("Possible duplicate send");
    }
    const sendLogId = await ctx.db.insert("sendLog", {
      userId: args.userId,
      accountId: args.accountId,
      idempotencyKey: args.idempotencyKey,
      contentHash: args.contentHash,
      status: "sending",
      messageIdHeader: args.messageIdHeader,
      createdAt: Date.now(),
    });
    return { sendLogId } as const;
  },
});

export const completeSend = internalMutation({
  args: {
    sendLogId: v.id("sendLog"),
    accountId: v.id("accounts"),
    draftId: v.optional(v.id("drafts")),
    replyToMessageDocId: v.optional(v.id("messages")),
    sentFolderId: v.optional(v.id("folders")),
    sentUid: v.optional(v.number()),
    messageIdHeader: v.string(),
    inReplyTo: v.optional(v.string()),
    references: v.array(v.string()),
    subject: v.string(),
    from: addressV,
    to: v.array(addressV),
    cc: v.array(addressV),
    bcc: v.array(addressV),
    text: v.string(),
    attachments: v.array(
      v.object({
        id: v.string(),
        filename: v.string(),
        contentType: v.string(),
        size: v.number(),
        inline: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const log = await ctx.db.get(args.sendLogId);
    if (!log) throw new Error("Send log not found");
    if (log.status === "sent" && log.messageId) {
      return { messageId: log.messageId, deduped: true };
    }

    const inserted = await ingestMessage(ctx, {
      userId: log.userId,
      accountId: args.accountId,
      folderId: args.sentFolderId ?? null,
      folderRole: "sent",
      uid: args.sentUid,
      messageIdHeader: args.messageIdHeader,
      inReplyTo: args.inReplyTo,
      references: args.references.slice(-30),
      subject: args.subject,
      from: args.from,
      to: args.to,
      cc: args.cc,
      bcc: args.bcc,
      replyTo: [],
      date: Date.now(),
      snippet: args.text.slice(0, 240),
      seen: true,
      flagged: false,
      answered: false,
      isOutbound: true,
      hasAttachments: args.attachments.length > 0,
      attachments: args.attachments.slice(0, 25),
    });

    if (args.replyToMessageDocId) {
      const original = await ctx.db.get(args.replyToMessageDocId);
      if (original) {
        const folder = original.folderId
          ? await ctx.db.get(original.folderId)
          : null;
        if (original.uid !== undefined && folder) {
          await enqueueOp(ctx, {
            userId: log.userId,
            accountId: original.accountId,
            kind: "flags",
            payload: {
              updates: [
                {
                  folderPath: folder.path,
                  uid: original.uid,
                  add: ["\\Answered"],
                  remove: [],
                  messageId: original._id,
                },
              ],
            },
          });
        }
      }
    }

    if (args.draftId) {
      const draft = await ctx.db.get(args.draftId);
      if (draft) {
        for (const att of draft.attachments) {
          if (att.kind === "upload") {
            await ctx.storage.delete(att.storageId).catch(() => {});
          }
        }
        if (draft.remoteUid !== undefined && draft.remoteFolderId) {
          const folder = await ctx.db.get(draft.remoteFolderId);
          if (folder) {
            await enqueueOp(ctx, {
              userId: draft.userId,
              accountId: draft.accountId,
              kind: "deleteRemoteDraft",
              payload: { folderPath: folder.path, uid: draft.remoteUid },
            });
          }
        }
        await ctx.db.delete(args.draftId);
        const counter = await ctx.db
          .query("counters")
          .withIndex("by_user_key", (q) =>
            q.eq("userId", draft.userId).eq("key", "drafts"),
          )
          .first();
        if (counter && counter.count > 0) {
          await ctx.db.patch(counter._id, { count: counter.count - 1 });
        }
      }
    }

    await ctx.db.patch(args.sendLogId, {
      status: "sent",
      messageId: inserted.messageId,
    });
    return { messageId: inserted.messageId, deduped: false };
  },
});

export const failSend = internalMutation({
  args: {
    sendLogId: v.id("sendLog"),
    draftId: v.optional(v.id("drafts")),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const log = await ctx.db.get(args.sendLogId);
    if (log && log.status === "sending") {
      await ctx.db.patch(args.sendLogId, {
        status: "failed",
        error: args.error.slice(0, 500),
      });
    }
    if (args.draftId) {
      const draft = await ctx.db.get(args.draftId);
      if (draft) {
        await ctx.db.patch(args.draftId, {
          status: "failed",
          sendError: args.error.slice(0, 500),
        });
      }
    }
  },
});

export const accountForSend = internalQuery({
  args: { accountId: v.id("accounts"), userId: v.string() },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account || account.userId !== args.userId) return null;
    return account;
  },
});

export const ownerEmailsForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return accounts.map((a) => a.email);
  },
});

interface SendOutcome {
  sendLogId: Id<"sendLog">;
  messageId: Id<"messages"> | undefined;
  deduped: boolean;
}

async function executeSend(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation" | "runAction">,
  args: {
    userId: string;
    accountId: Id<"accounts">;
    to: Address[];
    cc: Address[];
    bcc: Address[];
    subject: string;
    html?: string;
    text?: string;
    inReplyTo?: string;
    references?: string[];
    replyToMessageDocId?: Id<"messages">;
    attachments?: {
      filename?: string;
      size?: number;
      raw: unknown;
    }[];
    attachmentForHash: { filename: string; size: number }[];
    idempotencyKey?: string;
    allowDuplicate?: boolean;
    draftId?: Id<"drafts">;
    performArgs: {
      attachments?: (
        | { storageId: Id<"_storage">; filename?: string; contentType?: string }
        | { messageId: Id<"messages">; attachmentId: string }
        | { filename: string; contentType: string; contentBase64: string }
      )[];
    };
  },
): Promise<SendOutcome> {
  const text = args.text ?? (args.html ? htmlToText(args.html) : "");
  const estBytes = args.attachmentForHash.reduce((s, a) => s + a.size, 0);
  if (estBytes > ATTACHMENT_TOTAL_MAX) {
    throw new Error("Attachments exceed the 25 MB limit.");
  }
  const contentHash = await sendContentHash({
    accountId: args.accountId,
    to: args.to,
    cc: args.cc,
    bcc: args.bcc,
    subject: args.subject,
    text,
    html: args.html,
    attachments: args.attachmentForHash,
  });
  const account: Doc<"accounts"> | null = await ctx.runQuery(
    internal.send.accountForSend,
    { accountId: args.accountId, userId: args.userId },
  );
  if (!account) throw new Error("Account not found");
  if (args.draftId) {
    const draft = await ctx.runQuery(internal.send.draftForSend, { draftId: args.draftId });
    if (!draft || draft.userId !== args.userId || draft.accountId !== args.accountId) throw new Error("Draft not found");
  }
  if (args.replyToMessageDocId) {
    const original = await ctx.runQuery(internal.send.messageForCompose, { messageId: args.replyToMessageDocId });
    if (!original || original.userId !== args.userId) throw new Error("Message not found");
  }
  for (const attachment of args.performArgs.attachments ?? []) {
    if ("messageId" in attachment) {
      const message = await ctx.runQuery(internal.send.messageForCompose, { messageId: attachment.messageId });
      if (!message || message.userId !== args.userId) throw new Error("Attachment not found");
    }
  }
  const domain = account.email.split("@")[1] ?? "localhost";
  const messageIdHeader = newMessageId(domain);

  const begin:
    | { existing: Doc<"sendLog"> }
    | { sendLogId: Id<"sendLog"> } = await ctx.runMutation(
    internal.send.beginSend,
    {
      userId: args.userId,
      accountId: args.accountId,
      idempotencyKey: args.idempotencyKey,
      contentHash,
      messageIdHeader,
      allowDuplicate: args.allowDuplicate,
    },
  );
  if ("existing" in begin) {
    const existing = begin.existing;
    if (existing.status === "failed") {
      throw new Error(existing.error ?? "Previous send failed");
    }
    if (args.draftId) {
      // No SMTP attempt will complete this claim. Keep a different draft
      // editable when its caller reuses an existing idempotency key.
      await ctx.runMutation(internal.send.failClaimedDraft, {
        draftId: args.draftId,
        error: "This idempotency key is already in use. Use a new key to send this draft.",
      });
    }
    return {
      sendLogId: existing._id,
      messageId: existing.messageId,
      deduped: true,
    };
  }
  const sendLogId = begin.sendLogId;

  try {
    const res: {
      messageId: Id<"messages"> | undefined;
      deduped: boolean;
    } = await ctx.runAction(internal.node.sendOps.performSend, {
      accountId: args.accountId,
      sendLogId,
      draftId: args.draftId,
      replyToMessageDocId: args.replyToMessageDocId,
      to: args.to,
      cc: args.cc,
      bcc: args.bcc,
      subject: args.subject,
      html: args.html,
      text,
      inReplyTo: args.inReplyTo,
      references: args.references,
      messageIdHeader,
      attachments: args.performArgs.attachments,
    });
    return { sendLogId, messageId: res.messageId, deduped: res.deduped };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Send failed";
    await ctx.runMutation(internal.send.failSend, {
      sendLogId,
      draftId: args.draftId,
      error: msg,
    });
    throw new Error(msg);
  }
}

export const accountDomain = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    const a = await ctx.db.get(args.accountId);
    return a ? { email: a.email } : null;
  },
});

export const messageForCompose = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.messageId);
  },
});

export const draftForSend = internalQuery({
  args: { draftId: v.id("drafts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.draftId);
  },
});

function attachmentHashList(
  attachments:
    | ({ filename?: string; size?: number } & Record<string, unknown>)[]
    | undefined,
): { filename: string; size: number }[] {
  return (attachments ?? []).map((a) => ({
    filename: a.filename ?? "attachment",
    size:
      a.size ??
      (typeof a.contentBase64 === "string"
        ? Math.floor((a.contentBase64.length * 3) / 4)
        : 0),
  }));
}

export const sendMessage = action({
  args: {
    ...apiKeyArg,
    accountId: v.id("accounts"),
    to: v.array(addressV),
    cc: v.optional(v.array(addressV)),
    bcc: v.optional(v.array(addressV)),
    subject: v.string(),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    attachments: v.optional(v.array(sendAttachmentV)),
    replyToMessageId: v.optional(v.id("messages")),
    mode: v.optional(
      v.union(
        v.literal("new"),
        v.literal("reply"),
        v.literal("replyAll"),
        v.literal("forward"),
      ),
    ),
    idempotencyKey: v.optional(v.string()),
    allowDuplicate: v.optional(v.boolean()),
    draftId: v.optional(v.id("drafts")),
  },
  handler: async (ctx, args): Promise<SendOutcome> => {
    const userId = await requireUserId(ctx, args.apiKey);

    let inReplyTo: string | undefined;
    let references: string[] | undefined;
    if (args.replyToMessageId) {
      const original = await ctx.runQuery(internal.send.messageForCompose, {
        messageId: args.replyToMessageId,
      });
      if (original) {
        const th = threadingHeaders({
          messageIdHeader: original.messageIdHeader,
          references: original.references,
          subject: original.subject,
          from: original.from,
          to: original.to,
          cc: original.cc,
          replyTo: original.replyTo,
          date: original.date,
        });
        inReplyTo = th.inReplyTo;
        references = th.references;
      }
    }

    return await executeSend(ctx, {
      userId,
      accountId: args.accountId,
      to: args.to,
      cc: args.cc ?? [],
      bcc: args.bcc ?? [],
      subject: args.subject,
      html: args.html,
      text: args.text,
      inReplyTo,
      references,
      replyToMessageDocId: args.replyToMessageId,
      attachmentForHash: attachmentHashList(args.attachments as never),
      idempotencyKey: args.idempotencyKey,
      allowDuplicate: args.allowDuplicate,
      draftId: args.draftId,
      performArgs: { attachments: args.attachments ?? [] },
    });
  },
});

async function loadOriginal(
  ctx: Pick<ActionCtx, "runQuery" | "runAction">,
  messageId: Id<"messages">,
  userId: string,
): Promise<{ doc: Doc<"messages">; content: { html?: string; text?: string } }> {
  const doc: Doc<"messages"> | null = await ctx.runQuery(
    internal.send.messageForCompose,
    { messageId },
  );
  if (!doc || doc.userId !== userId) throw new Error("Message not found");
  let content: { html?: string; text?: string } = {};
  try {
    const c = await ctx.runAction(internal.node.content.getMessageContent, {
      messageId,
    });
    content = { html: c.html, text: c.text };
  } catch {
    // Quote gracefully degrades to headers-only when the body is unavailable.
  }
  return { doc, content };
}

export const reply = action({
  args: {
    ...apiKeyArg,
    messageId: v.id("messages"),
    replyAll: v.optional(v.boolean()),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    includeQuote: v.optional(v.boolean()),
    attachments: v.optional(v.array(sendAttachmentV)),
    idempotencyKey: v.optional(v.string()),
    allowDuplicate: v.optional(v.boolean()),
    accountId: v.optional(v.id("accounts")),
    draftId: v.optional(v.id("drafts")),
  },
  handler: async (ctx, args): Promise<SendOutcome> => {
    const userId = await requireUserId(ctx, args.apiKey);
    const { doc: original, content } = await loadOriginal(ctx, args.messageId, userId);
    const accountId = args.accountId ?? original.accountId;
    const ownerAddrs: string[] = await ctx.runQuery(
      internal.send.ownerEmailsForUser,
      { userId },
    );

    const { to, cc } = replyRecipients(
      {
        messageIdHeader: original.messageIdHeader,
        references: original.references,
        subject: original.subject,
        from: original.from,
        to: original.to,
        cc: original.cc,
        replyTo: original.replyTo,
        date: original.date,
      },
      args.replyAll ?? false,
      ownerAddrs,
    );
    const th = threadingHeaders({
      messageIdHeader: original.messageIdHeader,
      references: original.references,
      subject: original.subject,
      from: original.from,
      to: original.to,
      cc: original.cc,
      replyTo: original.replyTo,
      date: original.date,
    });
    const subject = replySubjectFor({
      messageIdHeader: original.messageIdHeader,
      references: original.references,
      subject: original.subject,
      from: original.from,
      to: original.to,
      cc: original.cc,
      replyTo: original.replyTo,
      date: original.date,
    });

    const { html, text } = args.includeQuote === false ? args :
      appendOriginalQuote(args.replyAll ? "replyAll" : "reply", original, content, args);

    return await executeSend(ctx, {
      userId,
      accountId,
      to,
      cc,
      bcc: [],
      subject,
      html,
      text,
      inReplyTo: th.inReplyTo,
      references: th.references,
      replyToMessageDocId: args.messageId,
      attachmentForHash: attachmentHashList(args.attachments as never),
      idempotencyKey: args.idempotencyKey,
      allowDuplicate: args.allowDuplicate,
      draftId: args.draftId,
      performArgs: { attachments: args.attachments ?? [] },
    });
  },
});

export const forward = action({
  args: {
    ...apiKeyArg,
    messageId: v.id("messages"),
    to: v.array(addressV),
    cc: v.optional(v.array(addressV)),
    bcc: v.optional(v.array(addressV)),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    includeAttachments: v.optional(v.boolean()),
    attachments: v.optional(v.array(sendAttachmentV)),
    idempotencyKey: v.optional(v.string()),
    allowDuplicate: v.optional(v.boolean()),
    accountId: v.optional(v.id("accounts")),
    draftId: v.optional(v.id("drafts")),
  },
  handler: async (ctx, args): Promise<SendOutcome> => {
    const userId = await requireUserId(ctx, args.apiKey);
    const { doc: original, content } = await loadOriginal(ctx, args.messageId, userId);
    const accountId = args.accountId ?? original.accountId;

    const subject = forwardSubjectFor({
      messageIdHeader: original.messageIdHeader,
      references: original.references,
      subject: original.subject,
      from: original.from,
      to: original.to,
      cc: original.cc,
      replyTo: original.replyTo,
      date: original.date,
    });
    const { html, text } = appendOriginalQuote("forward", original, content, args);

    const forwardAttachments =
      (args.includeAttachments ?? true)
        ? original.attachments.map((a) => ({
            messageId: original._id,
            attachmentId: a.id,
          }))
        : [];

    return await executeSend(ctx, {
      userId,
      accountId,
      to: args.to,
      cc: args.cc ?? [],
      bcc: args.bcc ?? [],
      subject,
      html,
      text,
      attachmentForHash: [
        ...forwardAttachments.map((a) => ({
          filename: a.attachmentId,
          size: 0,
        })),
        ...attachmentHashList(args.attachments as never),
      ],
      idempotencyKey: args.idempotencyKey,
      allowDuplicate: args.allowDuplicate,
      draftId: args.draftId,
      performArgs: {
        attachments: [...forwardAttachments, ...(args.attachments ?? [])],
      },
    });
  },
});

export const claimDraftForSend = internalMutation({
  args: { userId: v.string(), draftId: v.id("drafts"), scheduledOnly: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.userId !== args.userId) {
      if (args.scheduledOnly) return null;
      throw new Error("Draft not found");
    }
    // An already-running old job may survive cancellation and rescheduling.
    // It must not claim a newer schedule before that schedule is due.
    if (args.scheduledOnly && (draft.status !== "scheduled" || draft.scheduledAt === undefined || draft.scheduledAt > Date.now())) return null;
    if (draft.status === "sending") throw new Error("Draft is already sending");
    if (draft.to.length + draft.cc.length + draft.bcc.length === 0) throw new Error("Add at least one recipient before sending");
    if (!args.scheduledOnly && draft.scheduledJobId) await ctx.scheduler.cancel(draft.scheduledJobId).catch(() => {});
    await ctx.db.patch(draft._id, { status: "sending", scheduledAt: undefined, scheduledJobId: undefined });
    return draft;
  },
});

export const failClaimedDraft = internalMutation({
  args: { draftId: v.id("drafts"), error: v.string() },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (draft?.status === "sending") await ctx.db.patch(draft._id, { status: "failed", sendError: args.error.slice(0, 500) });
  },
});

async function runSendDraft(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation" | "runAction">,
  userId: string,
  draftId: Id<"drafts">,
  idempotencyKey?: string,
  allowDuplicate?: boolean,
  claimedDraft?: Doc<"drafts">,
): Promise<SendOutcome> {
  const draft: Doc<"drafts"> | null = claimedDraft ?? await ctx.runMutation(
    internal.send.claimDraftForSend,
    { draftId, userId },
  );
  if (!draft || draft.userId !== userId) throw new Error("Draft not found");
  if (draft.status === "sending") throw new Error("Draft is already sending");
  try {
  let inReplyTo: string | undefined;
  let references: string[] | undefined;
  let replyToMessageDocId: Id<"messages"> | undefined;
  if (draft.replyToMessageId) {
    const original: Doc<"messages"> | null = await ctx.runQuery(
      internal.send.messageForCompose,
      { messageId: draft.replyToMessageId },
    );
    if (original) {
      const th = threadingHeaders({
        messageIdHeader: original.messageIdHeader,
        references: original.references,
        subject: original.subject,
        from: original.from,
        to: original.to,
        cc: original.cc,
        replyTo: original.replyTo,
        date: original.date,
      });
      inReplyTo = th.inReplyTo;
      references = th.references;
      replyToMessageDocId = original._id;
    }
  }

  let html = draft.html || undefined;
  let text = draft.text || undefined;
  if (draft.replyToMessageId && draft.mode !== "new") {
    const { doc, content } = await loadOriginal(ctx, draft.replyToMessageId, userId);
    ({ html, text } = appendOriginalQuote(draft.mode, doc, content, { html, text }));
  }

  const performAttachments = draft.attachments.map((a) =>
    a.kind === "upload"
      ? {
          storageId: a.storageId,
          filename: a.filename,
          contentType: a.contentType,
        }
      : { messageId: a.messageId, attachmentId: a.attachmentId },
  );

  return await executeSend(ctx, {
    userId,
    accountId: draft.accountId,
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject,
    html,
    text,
    inReplyTo,
    references,
    replyToMessageDocId,
    attachmentForHash: draft.attachments.map((a) => ({
      filename: a.filename,
      size: a.size,
    })),
    idempotencyKey,
    allowDuplicate,
    draftId,
    performArgs: { attachments: performAttachments },
  });
  } catch (error) {
    await ctx.runMutation(internal.send.failClaimedDraft, { draftId, error: error instanceof Error ? error.message : "Send failed" });
    throw error;
  }
}

export const sendDraft = action({
  args: {
    ...apiKeyArg,
    draftId: v.id("drafts"),
    idempotencyKey: v.optional(v.string()),
    allowDuplicate: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<SendOutcome> => {
    const userId = await requireUserId(ctx, args.apiKey);
    return await runSendDraft(
      ctx,
      userId,
      args.draftId,
      args.idempotencyKey,
      args.allowDuplicate,
    );
  },
});

// Scheduled send: runs without caller identity, so it validates the draft
// ownership inside.
export const sendScheduledDraft = internalAction({
  args: { draftId: v.id("drafts") },
  handler: async (ctx, args): Promise<SendOutcome | undefined> => {
    const existing = await ctx.runQuery(internal.send.draftForSend, { draftId: args.draftId });
    if (!existing) return;
    const draft = await ctx.runMutation(internal.send.claimDraftForSend, { draftId: args.draftId, userId: existing.userId, scheduledOnly: true });
    if (!draft) return;
    return await runSendDraft(ctx, draft.userId, args.draftId, undefined, undefined, draft);
  },
});

export const sendLogEntry = internalQuery({
  args: { sendLogId: v.id("sendLog") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sendLogId);
  },
});
