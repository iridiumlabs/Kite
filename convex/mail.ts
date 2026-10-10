import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  action,
  internalQuery,
  mutation,
  query,
  MutationCtx,
  QueryCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { requireUserId } from "./model/auth";
import { recomputeThread, writeThread } from "./model/threads";
import {
  enqueueOp,
  type ExpungeOp,
  type FlagOp,
  type MoveOp,
} from "./model/pendingOps";
import { apiKeyArg, checkBulkIds, inboxBucketV } from "./validators";
import type { ListKey, MessageFolderRole } from "./lib/types";

async function ownedThread(
  ctx: QueryCtx,
  userId: string,
  threadId: Id<"threads">,
): Promise<Doc<"threads">> {
  const doc = await ctx.db.get(threadId);
  if (!doc || doc.userId !== userId) throw new Error("Thread not found");
  return doc;
}

async function ownedMessage(
  ctx: QueryCtx,
  userId: string,
  messageId: Id<"messages">,
): Promise<Doc<"messages">> {
  const doc = await ctx.db.get(messageId);
  if (!doc || doc.userId !== userId) throw new Error("Message not found");
  return doc;
}

async function collectTargets(
  ctx: MutationCtx,
  userId: string,
  threadIds: Id<"threads">[],
  messageIds: Id<"messages">[],
): Promise<Doc<"messages">[]> {
  const out: Doc<"messages">[] = [];
  const seen = new Set<string>();
  for (const threadId of threadIds) {
    await ownedThread(ctx, userId, threadId);
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", threadId))
      .collect();
    for (const m of msgs) {
      if (!seen.has(m._id)) {
        seen.add(m._id);
        out.push(m);
      }
    }
  }
  for (const messageId of messageIds) {
    const m = await ownedMessage(ctx, userId, messageId);
    if (!seen.has(m._id)) {
      seen.add(m._id);
      out.push(m);
    }
  }
  return out;
}

async function folderPath(
  ctx: QueryCtx,
  cache: Map<string, string>,
  folderId: Id<"folders"> | null,
): Promise<string | null> {
  if (!folderId) return null;
  const hit = cache.get(folderId);
  if (hit) return hit;
  const doc = await ctx.db.get(folderId);
  if (!doc) return null;
  cache.set(folderId, doc.path);
  return doc.path;
}

async function folderForRole(
  ctx: QueryCtx,
  accountId: Id<"accounts">,
  role: Doc<"folders">["role"],
): Promise<Doc<"folders"> | null> {
  return await ctx.db
    .query("folders")
    .withIndex("by_account_role", (q) =>
      q.eq("accountId", accountId).eq("role", role),
    )
    .first();
}

async function enqueueBatched<K extends "flags" | "move" | "expunge">(
  ctx: MutationCtx,
  userId: string,
  kind: K,
  byAccount: Map<Id<"accounts">, unknown[]>,
  wrap: (items: unknown[]) => Record<string, unknown>,
) {
  for (const [accountId, items] of byAccount) {
    if (items.length === 0) continue;
    await enqueueOp(ctx, {
      userId,
      accountId,
      kind,
      payload: wrap(items) as never,
    });
  }
}

const threadTargets = {
  threadIds: v.optional(v.array(v.id("threads"))),
  messageIds: v.optional(v.array(v.id("messages"))),
};

export const setRead = mutation({
  args: {
    ...apiKeyArg,
    ...threadTargets,
    read: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    checkBulkIds(args.threadIds, args.messageIds);
    const targets = await collectTargets(
      ctx,
      userId,
      args.threadIds ?? [],
      args.messageIds ?? [],
    );
    const paths = new Map<string, string>();
    const ops = new Map<Id<"accounts">, FlagOp[]>();
    const touched = new Set<Id<"threads">>();
    for (const m of targets) {
      if (m.seen === args.read) continue;
      await ctx.db.patch(m._id, { seen: args.read });
      touched.add(m.threadId);
      const path = await folderPath(ctx, paths, m.folderId);
      if (m.uid !== undefined && path) {
        const list = ops.get(m.accountId) ?? [];
        list.push({
          folderPath: path,
          uid: m.uid,
          add: args.read ? ["\\Seen"] : [],
          remove: args.read ? [] : ["\\Seen"],
          messageId: m._id,
        });
        ops.set(m.accountId, list);
      }
    }
    for (const threadId of touched) await recomputeThread(ctx, threadId);
    await enqueueBatched(ctx, userId, "flags", ops, (updates) => ({
      updates: updates as FlagOp[],
    }));
  },
});

export const setStarred = mutation({
  args: {
    ...apiKeyArg,
    ...threadTargets,
    starred: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    checkBulkIds(args.threadIds, args.messageIds);
    const targets = await collectTargets(
      ctx,
      userId,
      args.threadIds ?? [],
      args.messageIds ?? [],
    );
    const paths = new Map<string, string>();
    const ops = new Map<Id<"accounts">, FlagOp[]>();
    const touched = new Set<Id<"threads">>();
    for (const m of targets) {
      if (m.flagged === args.starred) continue;
      await ctx.db.patch(m._id, { flagged: args.starred });
      touched.add(m.threadId);
      const path = await folderPath(ctx, paths, m.folderId);
      if (m.uid !== undefined && path) {
        const list = ops.get(m.accountId) ?? [];
        list.push({
          folderPath: path,
          uid: m.uid,
          add: args.starred ? ["\\Flagged"] : [],
          remove: args.starred ? [] : ["\\Flagged"],
          messageId: m._id,
        });
        ops.set(m.accountId, list);
      }
    }
    for (const threadId of touched) await recomputeThread(ctx, threadId);
    await enqueueBatched(ctx, userId, "flags", ops, (updates) => ({
      updates: updates as FlagOp[],
    }));
  },
});

const INBOX_ROLES: MessageFolderRole[] = ["inbox", "junk"];
const TRASHABLE_ROLES: MessageFolderRole[] = ["inbox", "junk", "archive"];

async function moveToFolderRole(
  ctx: MutationCtx,
  userId: string,
  targets: Doc<"messages">[],
  eligible: (m: Doc<"messages">) => boolean,
  targetRole: "archive" | "trash" | "inbox",
) {
  const paths = new Map<string, string>();
  const ops = new Map<Id<"accounts">, MoveOp[]>();
  const touched = new Set<Id<"threads">>();
  const folderCache = new Map<string, Doc<"folders"> | null>();
  for (const m of targets) {
    if (!eligible(m)) continue;
    let target = folderCache.get(`${m.accountId}:${targetRole}`);
    if (target === undefined) {
      target = await folderForRole(ctx, m.accountId, targetRole);
      folderCache.set(`${m.accountId}:${targetRole}`, target);
    }
    const sourcePath = await folderPath(ctx, paths, m.folderId);
    const patch: Record<string, unknown> = { folderRole: targetRole };
    // When the target folder row does not exist yet the role still changes;
    // the pending op creates the folder remotely later.
    if (target) patch.folderId = target._id;
    await ctx.db.patch(m._id, patch);
    touched.add(m.threadId);
    if (m.uid !== undefined && sourcePath) {
      const list = ops.get(m.accountId) ?? [];
      list.push({
        folderPath: sourcePath,
        uid: m.uid,
        targetRole,
        targetPath: target?.path ?? (targetRole === "inbox" ? "INBOX" : undefined),
        messageId: m._id,
      });
      ops.set(m.accountId, list);
    }
  }
  for (const threadId of touched) await recomputeThread(ctx, threadId);
  await enqueueBatched(ctx, userId, "move", ops, (moves) => ({
    moves: moves as MoveOp[],
  }));
}

export const archive = mutation({
  args: { ...apiKeyArg, ...threadTargets },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    checkBulkIds(args.threadIds, args.messageIds);
    const targets = await collectTargets(
      ctx,
      userId,
      args.threadIds ?? [],
      args.messageIds ?? [],
    );
    await moveToFolderRole(
      ctx,
      userId,
      targets,
      (m) => INBOX_ROLES.includes(m.folderRole),
      "archive",
    );
  },
});

export const trash = mutation({
  args: { ...apiKeyArg, ...threadTargets },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    checkBulkIds(args.threadIds, args.messageIds);
    const targets = await collectTargets(
      ctx,
      userId,
      args.threadIds ?? [],
      args.messageIds ?? [],
    );
    await moveToFolderRole(
      ctx,
      userId,
      targets,
      (m) => TRASHABLE_ROLES.includes(m.folderRole),
      "trash",
    );
  },
});

export const restore = mutation({
  args: { ...apiKeyArg, ...threadTargets },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    checkBulkIds(args.threadIds, args.messageIds);
    const targets = await collectTargets(
      ctx,
      userId,
      args.threadIds ?? [],
      args.messageIds ?? [],
    );
    await moveToFolderRole(
      ctx,
      userId,
      targets,
      (m) => m.folderRole === "archive" || m.folderRole === "trash",
      "inbox",
    );
  },
});

export const moveToInbox = mutation({
  args: {
    ...apiKeyArg,
    threadIds: v.array(v.id("threads")),
    inbox: inboxBucketV,
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    checkBulkIds(args.threadIds, undefined);
    const paths = new Map<string, string>();
    const ops = new Map<Id<"accounts">, MoveOp[]>();
    for (const threadId of args.threadIds) {
      const thread = await ownedThread(ctx, userId, threadId);
      const msgs = await ctx.db
        .query("messages")
        .withIndex("by_thread", (q) => q.eq("threadId", threadId))
        .collect();
      let inboxFolder: Doc<"folders"> | null = null;
      for (const m of msgs) {
        if (m.isOutbound) continue;
        const patch: Record<string, unknown> = {};
        if (m.inbox !== args.inbox || m.classifiedBy !== "manual") {
          patch.inbox = args.inbox;
          patch.classifiedBy = "manual";
          patch.needsClassification = false;
        }
        if (m.folderRole === "junk") {
          if (inboxFolder === null) {
            inboxFolder = await folderForRole(ctx, m.accountId, "inbox");
          }
          patch.folderRole = "inbox";
          if (inboxFolder) patch.folderId = inboxFolder._id;
          const sourcePath = await folderPath(ctx, paths, m.folderId);
          if (m.uid !== undefined && sourcePath) {
            const list = ops.get(m.accountId) ?? [];
            list.push({
              folderPath: sourcePath,
              uid: m.uid,
              targetRole: "inbox",
              targetPath: inboxFolder?.path ?? "INBOX",
              messageId: m._id,
            });
            ops.set(m.accountId, list);
          }
        }
        if (Object.keys(patch).length > 0) await ctx.db.patch(m._id, patch);
      }
      await writeThread(ctx, threadId, {
        ...thread,
        inbox: args.inbox,
        inboxManual: true,
      });
      await recomputeThread(ctx, threadId);
    }
    await enqueueBatched(ctx, userId, "move", ops, (moves) => ({
      moves: moves as MoveOp[],
    }));
  },
});

export const assignCategories = mutation({
  args: {
    ...apiKeyArg,
    threadIds: v.array(v.id("threads")),
    add: v.optional(v.array(v.id("categories"))),
    remove: v.optional(v.array(v.id("categories"))),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    checkBulkIds(args.threadIds, undefined);
    for (const categoryId of [...(args.add ?? []), ...(args.remove ?? [])]) {
      const cat = await ctx.db.get(categoryId);
      if (!cat || cat.userId !== userId) throw new Error("Category not found");
    }
    for (const threadId of args.threadIds) {
      await ownedThread(ctx, userId, threadId);
      const msgs = await ctx.db
        .query("messages")
        .withIndex("by_thread", (q) => q.eq("threadId", threadId))
        .collect();
      if (args.add && args.add.length > 0) {
        const inbound = msgs
          .filter((m) => !m.isOutbound)
          .sort((a, b) => a.date - b.date);
        const latest = inbound[inbound.length - 1];
        if (latest) {
          const merged = [...latest.categoryIds];
          for (const id of args.add) {
            if (!merged.includes(id)) merged.push(id);
          }
          if (merged.length !== latest.categoryIds.length) {
            await ctx.db.patch(latest._id, {
              categoryIds: merged,
              classifiedBy: "manual",
            });
          }
        }
      }
      if (args.remove && args.remove.length > 0) {
        const drop = new Set<string>(args.remove);
        for (const m of msgs) {
          const kept = m.categoryIds.filter((id) => !drop.has(id));
          if (kept.length !== m.categoryIds.length) {
            await ctx.db.patch(m._id, { categoryIds: kept });
          }
        }
      }
      await recomputeThread(ctx, threadId);
    }
  },
});

export const snooze = mutation({
  args: {
    ...apiKeyArg,
    threadIds: v.array(v.id("threads")),
    until: v.union(v.number(), v.null()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    checkBulkIds(args.threadIds, undefined);
    const now = Date.now();
    for (const threadId of args.threadIds) {
      const thread = await ownedThread(ctx, userId, threadId);
      const snoozedUntil = args.until === null ? undefined : args.until;
      let listKey: ListKey;
      if (thread.location !== "inbox") {
        listKey = thread.location;
      } else if (snoozedUntil !== undefined && snoozedUntil > now) {
        listKey = "snoozed";
      } else {
        listKey = thread.inbox;
      }
      await writeThread(ctx, threadId, {
        ...thread,
        snoozedUntil,
        listKey,
      });
    }
  },
});

export const deleteForever = mutation({
  args: {
    ...apiKeyArg,
    threadIds: v.array(v.id("threads")),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    checkBulkIds(args.threadIds, undefined);
    const paths = new Map<string, string>();
    const ops = new Map<Id<"accounts">, ExpungeOp[]>();
    for (const threadId of args.threadIds) {
      const thread = await ownedThread(ctx, userId, threadId);
      if (thread.location !== "trash") {
        throw new Error("Only threads in trash can be deleted forever");
      }
      const msgs = await ctx.db
        .query("messages")
        .withIndex("by_thread", (q) => q.eq("threadId", threadId))
        .collect();
      for (const m of msgs) {
        const path = await folderPath(ctx, paths, m.folderId);
        if (m.uid !== undefined && path) {
          const list = ops.get(m.accountId) ?? [];
          list.push({ folderPath: path, uid: m.uid, messageId: m._id });
          ops.set(m.accountId, list);
        }
        await ctx.db.delete(m._id);
      }
      await writeThread(ctx, threadId, null);
    }
    await enqueueBatched(ctx, userId, "expunge", ops, (expunges) => ({
      expunges: expunges as ExpungeOp[],
    }));
  },
});

const LIST_VIEWS = v.union(
  v.literal("primary"),
  v.literal("other"),
  v.literal("archive"),
  v.literal("trash"),
  v.literal("snoozed"),
  v.literal("starred"),
  v.literal("account"),
  v.literal("category"),
);

async function enrichThreads(
  ctx: QueryCtx,
  userId: string,
  threads: Doc<"threads">[],
) {
  const cats = await ctx.db
    .query("categories")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  const byId = new Map(cats.map((c) => [c._id, c]));
  return threads.map((t) => ({
    ...t,
    categories: t.categoryIds
      .map((id) => byId.get(id))
      .filter((c): c is Doc<"categories"> => !!c)
      .map((c) => ({ _id: c._id, name: c.name, color: c.color })),
  }));
}

export const listThreads = query({
  args: {
    ...apiKeyArg,
    view: LIST_VIEWS,
    accountId: v.optional(v.id("accounts")),
    categoryId: v.optional(v.id("categories")),
    filter: v.optional(
      v.object({
        unread: v.optional(v.boolean()),
        starred: v.optional(v.boolean()),
        hasAttachments: v.optional(v.boolean()),
      }),
    ),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const filter = args.filter;

    if (args.view === "category") {
      if (!args.categoryId) throw new Error("categoryId required");
      const cat = await ctx.db.get(args.categoryId);
      if (!cat || cat.userId !== userId) throw new Error("Category not found");
      const rows = await ctx.db
        .query("threadCategories")
        .withIndex("by_category_inbox", (q) =>
          q.eq("categoryId", args.categoryId!).eq("inInbox", true),
        )
        .order("desc")
        .paginate(args.paginationOpts);
      const threads = (
        await Promise.all(rows.page.map((r) => ctx.db.get(r.threadId)))
      ).filter((t): t is Doc<"threads"> => t !== null);
      return {
        page: await enrichThreads(ctx, userId, threads),
        continueCursor: rows.continueCursor,
        isDone: rows.isDone,
      };
    }

    let base;
    if (args.view === "starred") {
      base = ctx.db
        .query("threads")
        .withIndex("by_user_starred", (q) =>
          q.eq("userId", userId).eq("starred", true),
        );
    } else if (args.view === "account") {
      if (!args.accountId) throw new Error("accountId required");
      const account = await ctx.db.get(args.accountId);
      if (!account || account.userId !== userId) {
        throw new Error("Account not found");
      }
      base = ctx.db
        .query("threads")
        .withIndex("by_account_location", (q) =>
          q.eq("accountId", args.accountId!).eq("location", "inbox"),
        );
    } else {
      const listKey = args.view as ListKey;
      if (filter?.unread) {
        base = ctx.db
          .query("threads")
          .withIndex("by_user_list_unread", (q) =>
            q
              .eq("userId", userId)
              .eq("listKey", listKey)
              .eq("unread", true),
          );
      } else {
        base = ctx.db
          .query("threads")
          .withIndex("by_user_list", (q) =>
            q.eq("userId", userId).eq("listKey", listKey),
          );
      }
    }

    if (
      filter?.unread &&
      (args.view === "starred" || args.view === "account")
    ) {
      base = base.filter((q) => q.eq(q.field("unread"), true));
    }
    if (filter?.starred && args.view !== "starred") {
      base = base.filter((q) => q.eq(q.field("starred"), true));
    }
    if (filter?.hasAttachments) {
      base = base.filter((q) => q.eq(q.field("hasAttachments"), true));
    }

    const result = await base.order("desc").paginate(args.paginationOpts);
    return {
      page: await enrichThreads(ctx, userId, result.page),
      continueCursor: result.continueCursor,
      isDone: result.isDone,
    };
  },
});

export const listMessagesByRole = query({
  args: {
    ...apiKeyArg,
    role: v.union(v.literal("sent"), v.literal("drafts")),
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
        .query("messages")
        .withIndex("by_account_role_date", (q) =>
          q.eq("accountId", args.accountId!).eq("folderRole", args.role),
        )
        .order("desc")
        .paginate(args.paginationOpts);
    }
    return await ctx.db
      .query("messages")
      .withIndex("by_user_role_date", (q) =>
        q.eq("userId", userId).eq("folderRole", args.role),
      )
      .order("desc")
      .paginate(args.paginationOpts);
  },
});

export const getThread = query({
  args: { ...apiKeyArg, threadId: v.id("threads") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const thread = await ownedThread(ctx, userId, args.threadId);
    const messages = await ctx.db
      .query("messages")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();
    messages.sort((a, b) => a.date - b.date);
    return { thread, messages };
  },
});

export const getMessage = query({
  args: { ...apiKeyArg, messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    return await ownedMessage(ctx, userId, args.messageId);
  },
});

export const search = query({
  args: {
    ...apiKeyArg,
    query: v.string(),
    accountId: v.optional(v.id("accounts")),
    role: v.optional(
      v.union(
        v.literal("inbox"),
        v.literal("sent"),
        v.literal("drafts"),
        v.literal("archive"),
        v.literal("trash"),
        v.literal("junk"),
        v.literal("local"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const limit = Math.min(args.limit ?? 20, 50);
    return await ctx.db
      .query("messages")
      .withSearchIndex("search", (q) => {
        let s = q.search("searchText", args.query).eq("userId", userId);
        if (args.accountId) s = s.eq("accountId", args.accountId);
        if (args.role) s = s.eq("folderRole", args.role);
        return s;
      })
      .take(limit);
  },
});

const FIND_SCAN_BUDGET = 500;
const ALL_ROLES: MessageFolderRole[] = [
  "inbox",
  "junk",
  "archive",
  "sent",
  "drafts",
  "trash",
  "local",
];

const VIEW_ROLES: Record<string, MessageFolderRole[]> = {
  primary: ["inbox", "junk"],
  other: ["inbox", "junk"],
  inbox: ["inbox"],
  junk: ["junk"],
  sent: ["sent"],
  drafts: ["drafts"],
  archive: ["archive"],
  trash: ["trash"],
  local: ["local"],
};

// Structured message search. Picks the date-ordered role index (per account
// when accountId is given, otherwise per user), puts the after/before bounds
// into the index range and applies a bounded residual scan (at most 500
// documents examined per call) using .take() so only one read pattern is
// used per query. The continuation cursor is {ri, d, skip}: the role index,
// the last examined date, and the ids already returned at that exact date.
// Pages may be short when filters drop most rows; call again with
// continueCursor until isDone. Results are date-desc within the examined
// window.
export const findMessages = query({
  args: {
    ...apiKeyArg,
    accountId: v.optional(v.id("accounts")),
    view: v.optional(
      v.union(
        v.literal("primary"),
        v.literal("other"),
        v.literal("inbox"),
        v.literal("junk"),
        v.literal("sent"),
        v.literal("drafts"),
        v.literal("archive"),
        v.literal("trash"),
        v.literal("local"),
      ),
    ),
    categoryId: v.optional(v.id("categories")),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    subject: v.optional(v.string()),
    unread: v.optional(v.boolean()),
    starred: v.optional(v.boolean()),
    hasAttachments: v.optional(v.boolean()),
    after: v.optional(v.number()),
    before: v.optional(v.number()),
    cursor: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const limit = Math.min(args.limit ?? 50, 100);
    if (args.accountId) {
      const account = await ctx.db.get(args.accountId);
      if (!account || account.userId !== userId) {
        throw new Error("Account not found");
      }
    }
    if (args.categoryId) {
      const cat = await ctx.db.get(args.categoryId);
      if (!cat || cat.userId !== userId) throw new Error("Category not found");
    }

    const roles = args.view ? VIEW_ROLES[args.view] : ALL_ROLES;

    let ri = 0;
    let cursorDate: number | undefined;
    let skipIds = new Set<string>();
    if (args.cursor) {
      try {
        const decoded = JSON.parse(args.cursor);
        ri = decoded.ri ?? 0;
        cursorDate = decoded.d;
        skipIds = new Set(decoded.skip ?? []);
      } catch {
        throw new Error("Invalid cursor");
      }
    }

    const fromNeedle = args.from?.toLowerCase();
    const toNeedle = args.to?.toLowerCase();
    const subjectNeedle = args.subject?.toLowerCase();
    const matches = (m: Doc<"messages">): boolean => {
      if (
        (args.view === "primary" || args.view === "other") &&
        m.inbox !== args.view
      ) {
        return false;
      }
      if (args.categoryId && !m.categoryIds.includes(args.categoryId)) {
        return false;
      }
      if (args.unread !== undefined && m.seen === args.unread) return false;
      if (args.starred !== undefined && m.flagged !== args.starred) {
        return false;
      }
      if (args.hasAttachments !== undefined && m.hasAttachments !== args.hasAttachments) {
        return false;
      }
      if (
        fromNeedle &&
        !m.from.email.toLowerCase().includes(fromNeedle) &&
        !(m.from.name ?? "").toLowerCase().includes(fromNeedle)
      ) {
        return false;
      }
      if (
        toNeedle &&
        ![...m.to, ...m.cc, ...m.bcc].some((a) =>
          a.email.toLowerCase().includes(toNeedle),
        )
      ) {
        return false;
      }
      if (subjectNeedle && !m.subject.toLowerCase().includes(subjectNeedle)) {
        return false;
      }
      return true;
    };

    const items: Doc<"messages">[] = [];
    let examined = 0;
    let nextCursor:
      | { ri: number; d?: number; skip?: string[] }
      | null = null;

    while (
      ri < roles.length &&
      examined < FIND_SCAN_BUDGET &&
      items.length < limit
    ) {
      const role = roles[ri];
      const budget = FIND_SCAN_BUDGET - examined;
      const docs = await ctx.db
        .query("messages")
        .withIndex(
          args.accountId ? "by_account_role_date" : "by_user_role_date",
          (q) => {
            const base = args.accountId
              ? q.eq("accountId", args.accountId!).eq("folderRole", role)
              : q.eq("userId", userId).eq("folderRole", role);
            // One upper bound call maximum: cursorDate is inclusive, so it
            // becomes an exclusive bound half a millisecond above it.
            const upper = Math.min(
              args.before ?? Number.POSITIVE_INFINITY,
              cursorDate !== undefined
                ? cursorDate + 0.5
                : Number.POSITIVE_INFINITY,
            );
            const hasUpper = upper !== Number.POSITIVE_INFINITY;
            if (args.after !== undefined && hasUpper) {
              return base.gt("date", args.after).lt("date", upper);
            }
            if (args.after !== undefined) return base.gt("date", args.after);
            if (hasUpper) return base.lt("date", upper);
            return base;
          },
        )
        .order("desc")
        .take(budget);

      examined += docs.length;
      const exhausted = docs.length < budget;
      for (const m of docs) {
        if (cursorDate !== undefined && m.date === cursorDate && skipIds.has(m._id)) {
          continue;
        }
        if (matches(m)) items.push(m);
      }

      if (exhausted) {
        ri++;
        cursorDate = undefined;
        skipIds = new Set();
        nextCursor = { ri };
      } else {
        const last = docs[docs.length - 1];
        const skip = docs
          .filter((m) => m.date === last.date)
          .filter((m) => skipIds.has(m._id) || items.some((i) => i._id === m._id))
          .map((m) => m._id as string);
        nextCursor = { ri, d: last.date, skip };
        break;
      }
    }

    items.sort((a, b) => b.date - a.date);
    const isDone = ri >= roles.length;
    return {
      items,
      continueCursor: isDone
        ? null
        : JSON.stringify(nextCursor ?? { ri }),
      isDone,
      examined,
    };
  },
});

export const counts = query({
  args: { ...apiKeyArg },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const docs = await ctx.db
      .query("counters")
      .withIndex("by_user_key", (q) => q.eq("userId", userId))
      .collect();
    const out: Record<string, number> = {};
    for (const d of docs) out[d.key] = d.count;
    return out;
  },
});

const folderRoleArg = v.union(
  v.literal("inbox"),
  v.literal("sent"),
  v.literal("drafts"),
  v.literal("archive"),
  v.literal("trash"),
  v.literal("junk"),
);

// Backfills the next window of older UIDs for the account's folders.
export const loadOlder = action({
  args: {
    ...apiKeyArg,
    accountId: v.optional(v.id("accounts")),
    role: v.optional(folderRoleArg),
  },
  handler: async (ctx, args): Promise<{ scheduled: number }> => {
    const userId = await requireUserId(ctx, args.apiKey);
    const accounts = args.accountId
      ? [await ctx.runQuery(internal.send.accountForSend, {
          accountId: args.accountId,
          userId,
        })]
      : await ctx.runQuery(internal.mail.accountsOfUser, { userId });
    let scheduled = 0;
    for (const account of accounts) {
      if (!account) continue;
      await ctx.scheduler.runAfter(
        0,
        internal.node.sync.loadOlderInternal,
        { accountId: account._id, role: args.role },
      );
      scheduled++;
    }
    return { scheduled };
  },
});

export const accountsOfUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("accounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const messageDocsByIds = internalQuery({
  args: { ids: v.array(v.id("messages")) },
  handler: async (ctx, args) => {
    const docs: Doc<"messages">[] = [];
    for (const id of args.ids) {
      const doc = await ctx.db.get(id);
      if (doc) docs.push(doc);
    }
    return docs;
  },
});

// IMAP-side search across synced folders; ingests hits not yet in the DB and
// returns full message metadata.
export const deepSearch = action({
  args: {
    ...apiKeyArg,
    query: v.string(),
    accountId: v.optional(v.id("accounts")),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<Doc<"messages">[]> => {
    const userId = await requireUserId(ctx, args.apiKey);
    const limit = Math.min(args.limit ?? 50, 50);
    const accounts = args.accountId
      ? [await ctx.runQuery(internal.send.accountForSend, {
          accountId: args.accountId,
          userId,
        })]
      : await ctx.runQuery(internal.mail.accountsOfUser, { userId });
    const messageIds: Id<"messages">[] = [];
    for (const account of accounts) {
      if (!account) continue;
      const res = await ctx.runAction(internal.node.sync.deepSearchInternal, {
        accountId: account._id,
        query: args.query,
        limit: limit - messageIds.length,
      });
      for (const id of res.messageIds ?? []) {
        messageIds.push(id as Id<"messages">);
        if (messageIds.length >= limit) break;
      }
      if (messageIds.length >= limit) break;
    }
    const docs: Doc<"messages">[] = await ctx.runQuery(
      internal.mail.messageDocsByIds,
      { ids: messageIds },
    );
    return docs.filter((d) => d.userId === userId);
  },
});
