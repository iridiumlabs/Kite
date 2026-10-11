import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { requireUserId } from "./model/auth";
import { enqueueOp } from "./model/pendingOps";
import { addressV } from "./validators";
import { newMessageId } from "./lib/compose";
import type { MutationCtx } from "./_generated/server";

const PUSH_THROTTLE_MS = 30 * 1000;
const apiKeyArg = { apiKey: v.optional(v.string()) };

const draftAttachmentV = v.union(
  v.object({
    kind: v.literal("upload"),
    storageId: v.id("_storage"),
    filename: v.string(),
    contentType: v.string(),
    size: v.number(),
  }),
  v.object({
    kind: v.literal("forward"),
    messageId: v.id("messages"),
    attachmentId: v.string(),
    filename: v.string(),
    contentType: v.string(),
    size: v.number(),
  }),
);

async function validateAttachment(ctx: MutationCtx, userId: string, attachment: Doc<"drafts">["attachments"][number]) {
  if (attachment.kind === "forward") {
    const message = await ctx.db.get(attachment.messageId);
    if (!message || message.userId !== userId || !message.attachments.some(a => a.id === attachment.attachmentId)) throw new Error("Attachment not found");
  }
}

async function bumpDraftsCounter(
  ctx: MutationCtx,
  userId: string,
  delta: number,
) {
  const row = await ctx.db
    .query("counters")
    .withIndex("by_user_key", (q) =>
      q.eq("userId", userId).eq("key", "drafts"),
    )
    .first();
  if (!row) {
    if (delta > 0) {
      await ctx.db.insert("counters", { userId, key: "drafts", count: delta });
    }
    return;
  }
  const next = row.count + delta;
  if (next < 0) {
    console.error("drafts counter would go negative");
    await ctx.db.patch(row._id, { count: 0 });
    return;
  }
  await ctx.db.patch(row._id, { count: next });
}

async function ownedDraft(
  ctx: MutationCtx,
  userId: string,
  draftId: Id<"drafts">,
): Promise<Doc<"drafts">> {
  const draft = await ctx.db.get(draftId);
  if (!draft || draft.userId !== userId) throw new Error("Draft not found");
  if (draft.status === "sending") throw new Error("Draft is already sending");
  return draft;
}

// Schedules a remote push of the draft. At most one push is outstanding per
// draft per 30 second window; pushDraftNow clears pushScheduledAt.
async function schedulePush(
  ctx: MutationCtx,
  draft: Doc<"drafts">,
): Promise<void> {
  if (draft.pushScheduledAt !== undefined && draft.pushScheduledAt > Date.now()) {
    return;
  }
  await ctx.db.patch(draft._id, { pushScheduledAt: Date.now() + PUSH_THROTTLE_MS });
  await ctx.scheduler.runAfter(
    PUSH_THROTTLE_MS,
    internal.node.draftsOps.pushDraftNow,
    { draftId: draft._id },
  );
}

export const generateUploadUrl = mutation({
  args: apiKeyArg,
  handler: async (ctx, args) => {
    await requireUserId(ctx, args.apiKey);
    return await ctx.storage.generateUploadUrl();
  },
});

export const list = query({
  args: {
    ...apiKeyArg,
    accountId: v.optional(v.id("accounts")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    if (args.accountId) {
      const account = await ctx.db.get(args.accountId);
      if (!account || account.userId !== userId) {
        throw new Error("Account not found");
      }
      return await ctx.db
        .query("drafts")
        .withIndex("by_account", (q) => q.eq("accountId", args.accountId!))
        .order("desc")
        .paginate(args.paginationOpts);
    }
    const result = await ctx.db
      .query("drafts")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .paginate(args.paginationOpts);
    return result;
  },
});

export const get = query({
  args: { ...apiKeyArg, draftId: v.id("drafts") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.userId !== userId) return null;
    return draft;
  },
});

export const create = mutation({
  args: {
    ...apiKeyArg,
    accountId: v.id("accounts"),
    to: v.optional(v.array(addressV)),
    cc: v.optional(v.array(addressV)),
    bcc: v.optional(v.array(addressV)),
    subject: v.optional(v.string()),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
    mode: v.optional(
      v.union(
        v.literal("new"),
        v.literal("reply"),
        v.literal("replyAll"),
        v.literal("forward"),
      ),
    ),
    threadId: v.optional(v.id("threads")),
    replyToMessageId: v.optional(v.id("messages")),
    attachments: v.optional(v.array(draftAttachmentV)),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const account = await ctx.db.get(args.accountId);
    if (!account || account.userId !== userId) {
      throw new Error("Account not found");
    }
    if (args.threadId) {
      const thread = await ctx.db.get(args.threadId);
      if (!thread || thread.userId !== userId) throw new Error("Thread not found");
    }
    if (args.replyToMessageId) {
      const message = await ctx.db.get(args.replyToMessageId);
      if (!message || message.userId !== userId) throw new Error("Message not found");
    }
    for (const attachment of args.attachments ?? []) await validateAttachment(ctx, userId, attachment);
    const domain = account.email.split("@")[1] ?? "localhost";
    const now = Date.now();
    const draftId = await ctx.db.insert("drafts", {
      userId,
      accountId: args.accountId,
      threadId: args.threadId,
      replyToMessageId: args.replyToMessageId,
      mode: args.mode ?? "new",
      to: args.to ?? [],
      cc: args.cc ?? [],
      bcc: args.bcc ?? [],
      subject: args.subject ?? "",
      html: args.html ?? "",
      text: args.text ?? "",
      attachments: args.attachments ?? [],
      messageIdHeader: newMessageId(domain),
      status: "editing",
      remoteDirty: true,
      updatedAt: now,
      createdAt: now,
    });
    await bumpDraftsCounter(ctx, userId, 1);
    const draft = await ctx.db.get(draftId);
    await schedulePush(ctx, draft!);
    return draftId;
  },
});

export const update = mutation({
  args: {
    ...apiKeyArg,
    draftId: v.id("drafts"),
    accountId: v.optional(v.id("accounts")),
    to: v.optional(v.array(addressV)),
    cc: v.optional(v.array(addressV)),
    bcc: v.optional(v.array(addressV)),
    subject: v.optional(v.string()),
    html: v.optional(v.string()),
    text: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const draft = await ownedDraft(ctx, userId, args.draftId);
    const patch: Record<string, unknown> = {};
    if (args.accountId && args.accountId !== draft.accountId) {
      const account = await ctx.db.get(args.accountId);
      if (!account || account.userId !== userId) throw new Error("Account not found");
      if (draft.remoteUid !== undefined && draft.remoteFolderId) {
        const folder = await ctx.db.get(draft.remoteFolderId);
        if (folder) await enqueueOp(ctx, { userId, accountId: draft.accountId, kind: "deleteRemoteDraft", payload: { folderPath: folder.path, uid: draft.remoteUid } });
      }
      patch.accountId = args.accountId;
      patch.remoteUid = undefined;
      patch.remoteFolderId = undefined;
    }
    for (const key of ["to", "cc", "bcc", "subject", "html", "text"] as const) {
      if (args[key] !== undefined && JSON.stringify(args[key]) !== JSON.stringify(draft[key])) patch[key] = args[key];
    }
    if (Object.keys(patch).length === 0) return;
    patch.remoteDirty = true;
    patch.updatedAt = Date.now();
    await ctx.db.patch(args.draftId, patch);
    await schedulePush(ctx, (await ctx.db.get(args.draftId))!);
  },
});

export const addAttachment = mutation({
  args: {
    ...apiKeyArg,
    draftId: v.id("drafts"),
    attachment: draftAttachmentV,
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const draft = await ownedDraft(ctx, userId, args.draftId);
    await validateAttachment(ctx, userId, args.attachment);
    await ctx.db.patch(args.draftId, {
      attachments: [...draft.attachments, args.attachment],
      remoteDirty: true,
      updatedAt: Date.now(),
    });
    await schedulePush(ctx, draft);
  },
});

export const removeAttachment = mutation({
  args: {
    ...apiKeyArg,
    draftId: v.id("drafts"),
    index: v.number(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const draft = await ownedDraft(ctx, userId, args.draftId);
    const att = draft.attachments[args.index];
    if (!att) return;
    if (att.kind === "upload") {
      await ctx.storage.delete(att.storageId);
    }
    const next = draft.attachments.filter((_, i) => i !== args.index);
    await ctx.db.patch(args.draftId, {
      attachments: next,
      remoteDirty: true,
      updatedAt: Date.now(),
    });
    await schedulePush(ctx, draft);
  },
});

export const discard = mutation({
  args: { ...apiKeyArg, draftId: v.id("drafts") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const draft = await ownedDraft(ctx, userId, args.draftId);
    for (const att of draft.attachments) {
      if (att.kind === "upload") {
        await ctx.storage.delete(att.storageId).catch(() => {});
      }
    }
    if (draft.scheduledJobId) {
      await ctx.scheduler.cancel(draft.scheduledJobId).catch(() => {});
    }
    if (draft.remoteUid !== undefined && draft.remoteFolderId) {
      const folder = await ctx.db.get(draft.remoteFolderId);
      if (folder) {
        await enqueueOp(ctx, {
          userId,
          accountId: draft.accountId,
          kind: "deleteRemoteDraft",
          payload: { folderPath: folder.path, uid: draft.remoteUid },
        });
      }
    }
    await ctx.db.delete(args.draftId);
    await bumpDraftsCounter(ctx, userId, -1);
  },
});

export const scheduleSend = mutation({
  args: { ...apiKeyArg, draftId: v.id("drafts"), at: v.number() },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const draft = await ownedDraft(ctx, userId, args.draftId);
    if (draft.to.length === 0) {
      throw new Error("Add at least one recipient before scheduling");
    }
    if (draft.scheduledJobId) {
      await ctx.scheduler.cancel(draft.scheduledJobId).catch(() => {});
    }
    const jobId = await ctx.scheduler.runAt(
      args.at,
      internal.send.sendScheduledDraft,
      { draftId: args.draftId },
    );
    await ctx.db.patch(args.draftId, {
      scheduledAt: args.at,
      scheduledJobId: jobId,
      status: "scheduled",
      updatedAt: Date.now(),
    });
  },
});

export const cancelScheduledSend = mutation({
  args: { ...apiKeyArg, draftId: v.id("drafts") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const draft = await ownedDraft(ctx, userId, args.draftId);
    if (draft.scheduledJobId) {
      await ctx.scheduler.cancel(draft.scheduledJobId).catch(() => {});
    }
    await ctx.db.patch(args.draftId, {
      scheduledAt: undefined,
      scheduledJobId: undefined,
      status: "editing",
      updatedAt: Date.now(),
    });
  },
});

export { addressV };
