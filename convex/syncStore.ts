import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  MutationCtx,
} from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { ingestMessage } from "./model/ingest";
import { recomputeThread } from "./model/threads";
import { addressV } from "./validators";

const ingestMessageV = v.object({
  uid: v.optional(v.number()),
  messageIdHeader: v.string(),
  inReplyTo: v.optional(v.string()),
  references: v.optional(v.array(v.string())),
  subject: v.string(),
  from: addressV,
  to: v.array(addressV),
  cc: v.array(addressV),
  bcc: v.array(addressV),
  replyTo: v.array(addressV),
  date: v.number(),
  snippet: v.string(),
  seen: v.boolean(),
  flagged: v.boolean(),
  answered: v.boolean(),
  isOutbound: v.boolean(),
  hasAttachments: v.boolean(),
  attachments: v.optional(
    v.array(
      v.object({
        id: v.string(),
        filename: v.string(),
        contentType: v.string(),
        size: v.number(),
        cid: v.optional(v.string()),
        inline: v.boolean(),
      }),
    ),
  ),
  size: v.optional(v.number()),
  inbox: v.optional(v.union(v.literal("primary"), v.literal("other"))),
  categoryIds: v.optional(v.array(v.id("categories"))),
  classifiedBy: v.optional(
    v.union(
      v.literal("jev"),
      v.literal("heuristic"),
      v.literal("manual"),
      v.literal("inherited"),
    ),
  ),
  needsClassification: v.optional(v.boolean()),
  classificationCategories: v.optional(v.array(v.object({ id: v.id("categories"), name: v.string(), description: v.string() }))),
  classifyAttempts: v.optional(v.number()),
  bulk: v.optional(v.boolean()),
  postDraftId: v.optional(v.string()),
});

const folderStatePatchV = v.object({
  uidValidity: v.optional(v.number()),
  uidNext: v.optional(v.number()),
  highestModseq: v.optional(v.string()),
  unseen: v.optional(v.number()),
  messages: v.optional(v.number()),
  syncedUids: v.optional(v.string()),
  flags: v.optional(v.string()),
  oldestUid: v.optional(v.number()),
  backfillDone: v.optional(v.boolean()),
  lastFlagsFullAt: v.optional(v.number()),
});

export const getAccountSyncState = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) return null;
    const folders = await ctx.db
      .query("folders")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();
    return { account, folders };
  },
});

export const getAccountDoc = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.accountId);
  },
});

export const getSecret = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    const secret = await ctx.db
      .query("accountSecrets")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();
    return secret?.payload ?? null;
  },
});

export const dueSyncAccounts = internalQuery({
  args: { now: v.number(), cursor: v.optional(v.union(v.string(), v.null())) },
  handler: async (ctx, args) => {
    const page = await ctx.db.query("accounts").paginate({ numItems: 100, cursor: args.cursor ?? null });
    return {
      ids: page.page.filter(a => a.status !== "auth_error" &&
        (a.nextSyncAfter === undefined || a.nextSyncAfter <= args.now)).map(a => a._id),
      isDone: page.isDone,
      continueCursor: page.continueCursor,
    };
  },
});

export const folderByRole = internalQuery({
  args: {
    accountId: v.id("accounts"),
    role: v.union(
      v.literal("inbox"),
      v.literal("sent"),
      v.literal("drafts"),
      v.literal("archive"),
      v.literal("trash"),
      v.literal("junk"),
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("folders")
      .withIndex("by_account_role", (q) =>
        q.eq("accountId", args.accountId).eq("role", args.role),
      )
      .first();
  },
});

export const dueOps = internalQuery({
  args: { accountId: v.id("accounts"), now: v.number() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pendingOps")
      .withIndex("by_account_next", (q) =>
        q.eq("accountId", args.accountId).lte("nextAttemptAt", args.now),
      )
      .take(100);
  },
});

export const opMessageRefs = internalQuery({
  args: { ids: v.array(v.id("messages")) },
  handler: async (ctx, args) => {
    const out: Record<
      string,
      { folderId: Id<"folders"> | null; folderPath: string | null; uid?: number } | null
    > = {};
    for (const id of args.ids) {
      const m = await ctx.db.get(id);
      if (!m) {
        out[id] = null;
        continue;
      }
      const folder = m.folderId ? await ctx.db.get(m.folderId) : null;
      out[id] = {
        folderId: m.folderId,
        folderPath: folder?.path ?? null,
        uid: m.uid,
        folderRole: m.folderRole,
      } as never;
    }
    return out;
  },
});

export const messagesByUids = internalQuery({
  args: { folderId: v.id("folders"), uids: v.array(v.number()) },
  handler: async (ctx, args) => {
    const out = [];
    for (const uid of args.uids) {
      const m = await ctx.db
        .query("messages")
        .withIndex("by_folder_uid", (q) =>
          q.eq("folderId", args.folderId).eq("uid", uid),
        )
        .unique();
      if (m) {
        out.push({
          _id: m._id,
          uid: m.uid,
          messageIdHeader: m.messageIdHeader,
          folderId: m.folderId,
          folderRole: m.folderRole,
          threadId: m.threadId,
          postDraftId: m.postDraftId,
          attachments: m.attachments,
        });
      }
    }
    return out;
  },
});

export const messagesByMsgIds = internalQuery({
  args: { accountId: v.id("accounts"), msgIds: v.array(v.string()) },
  handler: async (ctx, args) => {
    const out = [];
    for (const msgId of args.msgIds) {
      const docs = await ctx.db
        .query("messages")
        .withIndex("by_account_msgid", (q) =>
          q.eq("accountId", args.accountId).eq("messageIdHeader", msgId),
        )
        .collect();
      for (const m of docs) {
        out.push({
          _id: m._id,
          uid: m.uid,
          messageIdHeader: m.messageIdHeader,
          folderId: m.folderId,
          folderRole: m.folderRole,
          threadId: m.threadId,
          postDraftId: m.postDraftId,
          attachments: m.attachments,
        });
      }
    }
    return out;
  },
});

export const categoriesForAccount = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) return [];
    const cats = await ctx.db
      .query("categories")
      .withIndex("by_user", (q) => q.eq("userId", account.userId))
      .collect();
    return cats.map((c) => ({
      id: c._id,
      name: c.name,
      description: c.description,
    }));
  },
});

export interface ThreadContextItem {
  messageIdHeader?: string;
  inReplyTo?: string;
  references?: string[];
}

export const threadContexts = internalQuery({
  args: {
    accountId: v.id("accounts"),
    items: v.array(
      v.object({
        messageIdHeader: v.optional(v.string()),
        inReplyTo: v.optional(v.string()),
        references: v.optional(v.array(v.string())),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    const ownerEmail = account?.email.toLowerCase() ?? "";
    const results = [];
    for (const item of args.items) {
      const refIds = [
        item.messageIdHeader,
        item.inReplyTo,
        ...(item.references ?? []),
      ].filter((r): r is string => !!r);
      let thread: Doc<"threads"> | null = null;
      for (const ref of refIds) {
        const row = await ctx.db
          .query("threadRefs")
          .withIndex("by_account_ref", (q) =>
            q.eq("accountId", args.accountId).eq("ref", ref),
          )
          .first();
        if (row) {
          thread = await ctx.db.get(row.threadId);
          if (thread) break;
        }
      }
      if (!thread) {
        results.push(null);
        continue;
      }
      const msgs = await ctx.db
        .query("messages")
        .withIndex("by_thread", (q) => q.eq("threadId", thread!._id))
        .collect();
      msgs.sort((a, b) => a.date - b.date);
      const directTarget = item.inReplyTo
        ? msgs.find((m) => m.messageIdHeader === item.inReplyTo)
        : undefined;
      const previous = msgs.slice(-3).map((m) => ({
        from:
          m.from.email.toLowerCase() === ownerEmail
            ? "owner"
            : m.from.name
              ? `${m.from.name} <${m.from.email}>`
              : m.from.email,
        snippet: m.snippet,
      }));
      results.push({
        threadId: thread._id,
        ownerStarted: msgs.length > 0 && msgs[0].isOutbound,
        ownerParticipated: msgs.some((m) => m.isOutbound),
        directReplyToOwner: directTarget?.isOutbound ?? false,
        messageCount: msgs.length,
        previousMessages: previous,
        inboxManual: thread.inboxManual,
        inbox: thread.inbox,
      });
    }
    return results;
  },
});

export const draftsForAccount = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("drafts")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();
  },
});

export const needsClassification = internalQuery({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const rows: Doc<"messages">[] = [];
    const limit = Math.min(args.limit ?? 40, 40);
    for (const role of ["inbox", "junk"] as const) {
      rows.push(...await ctx.db.query("messages")
        .withIndex("by_needs_classification", q => q.eq("needsClassification", true).eq("folderRole", role).lt("classifyAttempts", 3))
        .take(Math.max(0, limit - rows.length)));
    }
    const out = [];
    for (const m of rows) {
      if (m.classifiedBy !== "heuristic") continue;
      if (m.folderRole !== "inbox" && m.folderRole !== "junk") continue;
      const thread = await ctx.db.get(m.threadId);
      if (!thread || thread.inboxManual) continue;
      const folder = m.folderId ? await ctx.db.get(m.folderId) : null;
      if (m.uid === undefined || !folder) continue;
      out.push({
        _id: m._id,
        accountId: m.accountId,
        folderPath: folder.path,
        folderRole: m.folderRole,
        uid: m.uid,
        classifyAttempts: m.classifyAttempts,
        classificationCategories: m.classificationCategories ?? [],
      });
    }
    return out;
  },
});

export const messageRemoteRef = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const m = await ctx.db.get(args.messageId);
    if (!m) return null;
    const folder = m.folderId ? await ctx.db.get(m.folderId) : null;
    return {
      message: m,
      folderPath: folder?.path ?? null,
    };
  },
});

export const settingsForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const doc = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    return doc ?? null;
  },
});

export const acquireLease = internalMutation({
  args: {
    accountId: v.id("accounts"),
    owner: v.string(),
    ttlMs: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const lock = await ctx.db
      .query("syncLocks")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();
    if (!lock) {
      await ctx.db.insert("syncLocks", {
        accountId: args.accountId,
        leaseUntil: now + args.ttlMs,
        owner: args.owner,
      });
      return true;
    }
    if (lock.leaseUntil > now && lock.owner !== args.owner) {
      throw new Error("Sync already running for this account");
    }
    await ctx.db.patch(lock._id, {
      leaseUntil: now + args.ttlMs,
      owner: args.owner,
    });
    return true;
  },
});

export const renewLease = internalMutation({
  args: {
    accountId: v.id("accounts"),
    owner: v.string(),
    ttlMs: v.number(),
  },
  handler: async (ctx, args) => {
    const lock = await ctx.db
      .query("syncLocks")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();
    if (!lock || lock.owner !== args.owner) return false;
    await ctx.db.patch(lock._id, {
      leaseUntil: Date.now() + args.ttlMs,
    });
    return true;
  },
});

export const releaseLease = internalMutation({
  args: { accountId: v.id("accounts"), owner: v.string() },
  handler: async (ctx, args) => {
    const lock = await ctx.db
      .query("syncLocks")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();
    if (lock && lock.owner === args.owner) {
      await ctx.db.patch(lock._id, {
        leaseUntil: 0,
        lastRunAt: Date.now(),
      });
    }
  },
});

export const lockState = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    const lock = await ctx.db
      .query("syncLocks")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();
    return lock
      ? { leaseUntil: lock.leaseUntil, lastRunAt: lock.lastRunAt }
      : null;
  },
});

const folderRoleV = v.union(
  v.literal("inbox"),
  v.literal("sent"),
  v.literal("drafts"),
  v.literal("archive"),
  v.literal("trash"),
  v.literal("junk"),
);

export const upsertFolder = internalMutation({
  args: {
    accountId: v.id("accounts"),
    path: v.string(),
    role: folderRoleV,
    delimiter: v.optional(v.string()),
    uidValidity: v.optional(v.number()),
    uidNext: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account) throw new Error("Account not found");
    const existing = await ctx.db
      .query("folders")
      .withIndex("by_account_role", (q) =>
        q.eq("accountId", args.accountId).eq("role", args.role),
      )
      .first();
    if (existing) {
      const patch: Record<string, unknown> = {};
      if (existing.path !== args.path) patch.path = args.path;
      if (args.delimiter !== undefined && existing.delimiter !== args.delimiter) {
        patch.delimiter = args.delimiter;
      }
      if (
        args.uidValidity !== undefined &&
        existing.uidValidity !== args.uidValidity
      ) {
        patch.uidValidity = args.uidValidity;
      }
      if (args.uidNext !== undefined && existing.uidNext !== args.uidNext) {
        patch.uidNext = args.uidNext;
      }
      if (Object.keys(patch).length > 0) {
        patch.updatedAt = Date.now();
        await ctx.db.patch(existing._id, patch);
      }
      return existing._id;
    }
    // Another folder with the same path but a different role would be a
    // misdetection; check by path among the account folders.
    const all = await ctx.db
      .query("folders")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();
    const samePath = all.find((f) => f.path === args.path);
    if (samePath) {
      if (samePath.role !== args.role) {
        await ctx.db.patch(samePath._id, {
          role: args.role,
          updatedAt: Date.now(),
        });
      }
      return samePath._id;
    }
    return await ctx.db.insert("folders", {
      userId: account.userId,
      accountId: args.accountId,
      path: args.path,
      role: args.role,
      delimiter: args.delimiter,
      uidValidity: args.uidValidity,
      uidNext: args.uidNext,
      syncedUids: "",
      flags: "",
      backfillDone: false,
      updatedAt: Date.now(),
    });
  },
});

export const markFolderDiscovery = internalMutation({
  args: { accountId: v.id("accounts"), at: v.number() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.accountId, { foldersDiscoveredAt: args.at });
  },
});

// Ingests up to 50 messages and writes the folder state patch in the same
// transaction, so remote state and stored docs can never diverge.
export const ingestBatch = internalMutation({
  args: {
    userId: v.string(),
    accountId: v.id("accounts"),
    folderId: v.id("folders"),
    folderRole: folderRoleV,
    messages: v.array(ingestMessageV),
    folderPatch: folderStatePatchV,
  },
  handler: async (ctx, args) => {
    if (args.messages.length > 50) {
      throw new Error("ingestBatch accepts at most 50 messages");
    }
    const results = [];
    for (const msg of args.messages) {
      results.push(
        await ingestMessage(ctx, {
          ...msg,
          userId: args.userId,
          accountId: args.accountId,
          folderId: args.folderId,
          folderRole: args.folderRole,
        }),
      );
    }
    if (Object.keys(args.folderPatch).length > 0) {
      await ctx.db.patch(args.folderId, {
        ...args.folderPatch,
        updatedAt: Date.now(),
      });
    }
    return results;
  },
});

export const patchFolderState = internalMutation({
  args: {
    folderId: v.id("folders"),
    patch: folderStatePatchV,
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.folderId, {
      ...args.patch,
      updatedAt: Date.now(),
    });
  },
});

export const relocateMessages = internalMutation({
  args: {
    moves: v.array(
      v.object({
        messageId: v.id("messages"),
        folderId: v.id("folders"),
        folderRole: folderRoleV,
        uid: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const touched = new Set<Id<"threads">>();
    for (const mv of args.moves) {
      const m = await ctx.db.get(mv.messageId);
      if (!m) continue;
      await ctx.db.patch(mv.messageId, {
        folderId: mv.folderId,
        folderRole: mv.folderRole,
        uid: mv.uid,
      });
      touched.add(m.threadId);
    }
    for (const threadId of touched) await recomputeThread(ctx, threadId);
  },
});

export const deleteMessages = internalMutation({
  args: { ids: v.array(v.id("messages")) },
  handler: async (ctx, args) => {
    const touched = new Set<Id<"threads">>();
    for (const id of args.ids) {
      const m = await ctx.db.get(id);
      if (!m) continue;
      touched.add(m.threadId);
      await ctx.db.delete(id);
    }
    for (const threadId of touched) await recomputeThread(ctx, threadId);
  },
});

export const applyFlagChanges = internalMutation({
  args: {
    updates: v.array(
      v.object({
        folderId: v.id("folders"),
        uid: v.number(),
        seen: v.boolean(),
        flagged: v.boolean(),
        answered: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const touched = new Set<Id<"threads">>();
    let applied = 0;
    for (const u of args.updates) {
      const m = await ctx.db
        .query("messages")
        .withIndex("by_folder_uid", (q) =>
          q.eq("folderId", u.folderId).eq("uid", u.uid),
        )
        .unique();
      if (!m) continue;
      const patch: Record<string, unknown> = {};
      if (m.seen !== u.seen) patch.seen = u.seen;
      if (m.flagged !== u.flagged) patch.flagged = u.flagged;
      if (m.answered !== u.answered) patch.answered = u.answered;
      if (Object.keys(patch).length === 0) continue;
      await ctx.db.patch(m._id, patch);
      applied++;
      if ("seen" in patch || "flagged" in patch) touched.add(m.threadId);
    }
    for (const threadId of touched) await recomputeThread(ctx, threadId);
    return applied;
  },
});

export const updateAccountSync = internalMutation({
  args: {
    accountId: v.id("accounts"),
    status: v.optional(
      v.union(
        v.literal("connecting"),
        v.literal("syncing"),
        v.literal("ready"),
        v.literal("error"),
        v.literal("auth_error"),
      ),
    ),
    lastError: v.optional(v.union(v.string(), v.null())),
    lastSyncedAt: v.optional(v.number()),
    nextSyncAfter: v.optional(v.union(v.number(), v.null())),
    initialSyncDone: v.optional(v.boolean()),
    syncFailCount: v.optional(v.number()),
    foldersDiscoveredAt: v.optional(v.number()),
    capabilities: v.optional(
      v.object({
        condstore: v.boolean(),
        qresync: v.boolean(),
        move: v.boolean(),
        uidplus: v.boolean(),
        specialUse: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const { accountId, ...rest } = args;
    const current = await ctx.db.get(accountId);
    if (!current) return;
    const currentRec = current as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(rest)) {
      if (val === undefined) continue;
      const next = val === null ? undefined : val;
      if (JSON.stringify(currentRec[k] ?? null) === JSON.stringify(next ?? null)) {
        continue;
      }
      patch[k] = next;
    }
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(accountId, patch);
    }
  },
});

export const accountsWithDueOps = internalQuery({
  args: { now: v.number() },
  handler: async (ctx, args) => {
    const ops = await ctx.db.query("pendingOps")
      .withIndex("by_next", q => q.lte("nextAttemptAt", args.now))
      .take(100);
    const ids = new Set<Id<"accounts">>();
    for (const op of ops) {
      if (op.nextAttemptAt <= args.now) ids.add(op.accountId);
    }
    return [...ids];
  },
});

export const draftById = internalQuery({
  args: { draftId: v.id("drafts") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.draftId);
  },
});

export const applyMoveResults = internalMutation({
  args: {
    moves: v.array(
      v.object({
        messageId: v.id("messages"),
        folderId: v.id("folders"),
        folderRole: folderRoleV,
        uid: v.number(),
      }),
    ),
    folderPatches: v.array(
      v.object({ folderId: v.id("folders"), patch: folderStatePatchV }),
    ),
  },
  handler: async (ctx, args) => {
    const touched = new Set<Id<"threads">>();
    for (const mv of args.moves) {
      const m = await ctx.db.get(mv.messageId);
      if (!m) continue;
      await ctx.db.patch(mv.messageId, {
        folderId: mv.folderId,
        folderRole: mv.folderRole,
        uid: mv.uid,
      });
      touched.add(m.threadId);
    }
    for (const fp of args.folderPatches) {
      await ctx.db.patch(fp.folderId, {
        ...fp.patch,
        updatedAt: Date.now(),
      });
    }
    for (const threadId of touched) await recomputeThread(ctx, threadId);
  },
});

export const linkRemoteDraft = internalMutation({
  args: {
    draftId: v.id("drafts"),
    folderId: v.id("folders"),
    uid: v.number(),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || draft.remoteDirty) return;
    await ctx.db.patch(args.draftId, {
      remoteFolderId: args.folderId,
      remoteUid: args.uid,
    });
  },
});

export const markDraftPushed = internalMutation({
  args: {
    draftId: v.id("drafts"),
    folderId: v.optional(v.id("folders")),
    uid: v.optional(v.number()),
    prevRemoteUid: v.optional(v.number()),
    pushedUpdatedAt: v.optional(v.number()),
    pushedAccountId: v.optional(v.id("accounts")),
  },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft || (args.pushedAccountId && draft.accountId !== args.pushedAccountId)) return null;
    const changedDuringPush = args.pushedUpdatedAt !== undefined && draft.updatedAt !== args.pushedUpdatedAt;
    await ctx.db.patch(args.draftId, {
      remoteFolderId: args.folderId,
      remoteUid: args.uid,
      remoteDirty: changedDuringPush,
      pushScheduledAt: changedDuringPush ? Date.now() + 30_000 : undefined,
    });
    if (changedDuringPush) {
      await ctx.scheduler.runAfter(30_000, internal.node.draftsOps.pushDraftNow, { draftId: draft._id });
    }
    return { prevRemoteUid: draft.remoteUid };
  },
});

export const clearDraftSchedule = internalMutation({
  args: { draftId: v.id("drafts") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.draftId, { pushScheduledAt: undefined });
  },
});

async function bumpCounter(
  ctx: { db: MutationCtx["db"] },
  userId: string,
  key: string,
  delta: number,
) {
  const row = await ctx.db
    .query("counters")
    .withIndex("by_user_key", (q) =>
      q.eq("userId", userId).eq("key", key),
    )
    .first();
  if (!row) {
    if (delta > 0) {
      await ctx.db.insert("counters", { userId, key, count: delta });
    }
    return;
  }
  const next = row.count + delta;
  if (next < 0) {
    console.error(`counter ${key} would go negative for ${userId}`);
    await ctx.db.patch(row._id, { count: 0 });
    return;
  }
  await ctx.db.patch(row._id, { count: next });
}

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

export const importRemoteDraft = internalMutation({
  args: {
    userId: v.string(),
    accountId: v.id("accounts"),
    messageIdHeader: v.string(),
    subject: v.string(),
    to: v.array(addressV),
    cc: v.array(addressV),
    bcc: v.array(addressV),
    html: v.string(),
    text: v.string(),
    remoteFolderId: v.id("folders"),
    remoteUid: v.number(),
    attachments: v.array(draftAttachmentV),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("drafts")
      .withIndex("by_remote", q => q.eq("remoteFolderId", args.remoteFolderId).eq("remoteUid", args.remoteUid))
      .first();
    if (existing) return existing._id;
    const now = Date.now();
    const id = await ctx.db.insert("drafts", {
      userId: args.userId,
      accountId: args.accountId,
      mode: "new",
      to: args.to,
      cc: args.cc,
      bcc: args.bcc,
      subject: args.subject,
      html: args.html,
      text: args.text,
      attachments: args.attachments,
      messageIdHeader: args.messageIdHeader,
      status: "editing",
      remoteFolderId: args.remoteFolderId,
      remoteUid: args.remoteUid,
      remoteDirty: false,
      updatedAt: now,
      createdAt: now,
    });
    await bumpCounter(ctx, args.userId, "drafts", 1);
    return id;
  },
});

export const deleteDraft = internalMutation({
  args: { draftId: v.id("drafts") },
  handler: async (ctx, args) => {
    const draft = await ctx.db.get(args.draftId);
    if (!draft) return;
    await ctx.db.delete(args.draftId);
    await bumpCounter(ctx, draft.userId, "drafts", -1);
  },
});

export const completeOp = internalMutation({
  args: { opId: v.id("pendingOps") },
  handler: async (ctx, args) => {
    const op = await ctx.db.get(args.opId);
    if (op) await ctx.db.delete(args.opId);
  },
});

export const failOp = internalMutation({
  args: {
    opId: v.id("pendingOps"),
    error: v.string(),
    nextAttemptAt: v.number(),
    drop: v.boolean(),
  },
  handler: async (ctx, args) => {
    const op = await ctx.db.get(args.opId);
    if (!op) return;
    if (args.drop) {
      await ctx.db.delete(args.opId);
      await ctx.db.patch(op.accountId, {
        lastError: `Operation failed repeatedly: ${args.error}`,
      });
      return;
    }
    await ctx.db.patch(args.opId, {
      attempts: op.attempts + 1,
      lastError: args.error,
      nextAttemptAt: args.nextAttemptAt,
    });
  },
});

export const applyClassification = internalMutation({
  args: {
    updates: v.array(
      v.object({
        messageId: v.id("messages"),
        inbox: v.optional(
          v.union(v.literal("primary"), v.literal("other")),
        ),
        categoryIds: v.array(v.id("categories")),
        classifiedBy: v.union(
          v.literal("jev"),
          v.literal("heuristic"),
        ),
        needsClassification: v.boolean(),
        classifyAttempts: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const touched = new Set<Id<"threads">>();
    for (const u of args.updates) {
      const m = await ctx.db.get(u.messageId);
      if (!m || !m.needsClassification || m.classifiedBy !== "heuristic") continue;
      const thread = await ctx.db.get(m.threadId);
      if (!thread || thread.inboxManual) continue;
      if (u.needsClassification) {
        await ctx.db.patch(m._id, { classifyAttempts: u.classifyAttempts });
        continue;
      }
      const categories = [];
      for (const id of u.categoryIds) {
        const category = await ctx.db.get(id);
        if (category?.userId === m.userId) categories.push(id);
      }
      await ctx.db.patch(u.messageId, {
        inbox: u.inbox ?? m.inbox,
        categoryIds: categories,
        classificationCategories: undefined,
        classifiedBy: u.classifiedBy,
        needsClassification: u.needsClassification,
        classifyAttempts: u.classifyAttempts,
      });
      touched.add(m.threadId);
    }
    for (const threadId of touched) await recomputeThread(ctx, threadId);
  },
});
