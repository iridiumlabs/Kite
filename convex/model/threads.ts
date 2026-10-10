import { WithoutSystemFields } from "convex/server";
import { MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { diffCounters } from "../lib/counters";
import { summarizeThread } from "../lib/threadSummary";
import type { ListKey } from "../lib/types";

export type ThreadFields = WithoutSystemFields<Doc<"threads">>;

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
  );
}

async function applyCounterDiffs(
  ctx: MutationCtx,
  userId: string,
  deltas: Map<string, number>,
) {
  for (const [key, delta] of deltas) {
    const doc = await ctx.db
      .query("counters")
      .withIndex("by_user_key", (q) =>
        q.eq("userId", userId).eq("key", key),
      )
      .unique();
    if (!doc) {
      if (delta > 0) {
        await ctx.db.insert("counters", { userId, key, count: delta });
      } else {
        console.warn(`counter ${key} went negative for ${userId}`);
      }
      continue;
    }
    const next = doc.count + delta;
    if (next < 0) {
      console.warn(`counter ${key} clamped to 0 for ${userId}`);
      await ctx.db.patch(doc._id, { count: 0 });
    } else {
      await ctx.db.patch(doc._id, { count: next });
    }
  }
}

async function syncThreadCategories(
  ctx: MutationCtx,
  threadId: Id<"threads">,
  next: ThreadFields,
  existing: Doc<"threadCategories">[],
) {
  const wanted = new Set<string>(next.categoryIds);
  const inInbox = next.listKey === "primary" || next.listKey === "other";
  const have = new Set<string>();
  for (const row of existing) {
    if (!wanted.has(row.categoryId)) {
      await ctx.db.delete(row._id);
      continue;
    }
    have.add(row.categoryId);
    const patch: Record<string, unknown> = {};
    if (row.inInbox !== inInbox) patch.inInbox = inInbox;
    if (row.lastMessageAt !== next.lastMessageAt)
      patch.lastMessageAt = next.lastMessageAt;
    if (row.unread !== next.unread) patch.unread = next.unread;
    if (Object.keys(patch).length > 0) await ctx.db.patch(row._id, patch);
  }
  for (const categoryId of wanted) {
    if (have.has(categoryId)) continue;
    await ctx.db.insert("threadCategories", {
      userId: next.userId,
      categoryId: categoryId as Id<"categories">,
      threadId,
      lastMessageAt: next.lastMessageAt,
      inInbox,
      unread: next.unread,
    });
  }
}

// The single choke point for creating, patching and deleting thread docs.
// Maintains counters and threadCategories join rows; skips no-op writes.
export async function writeThread(
  ctx: MutationCtx,
  threadId: Id<"threads"> | null,
  next: ThreadFields | null,
): Promise<Id<"threads"> | null> {
  const before = threadId ? await ctx.db.get(threadId) : null;

  if (next === null) {
    if (!before) return null;
    const joinRows = await ctx.db
      .query("threadCategories")
      .withIndex("by_thread", (q) => q.eq("threadId", before._id))
      .collect();
    for (const row of joinRows) await ctx.db.delete(row._id);
    const refs = await ctx.db
      .query("threadRefs")
      .withIndex("by_thread", (q) => q.eq("threadId", before._id))
      .collect();
    for (const ref of refs) await ctx.db.delete(ref._id);
    await applyCounterDiffs(ctx, before.userId, diffCounters(before, null));
    await ctx.db.delete(before._id);
    return null;
  }

  if (!before) {
    const id = await ctx.db.insert("threads", next);
    await applyCounterDiffs(ctx, next.userId, diffCounters(null, next));
    await syncThreadCategories(ctx, id, next, []);
    return id;
  }

  const patch: Record<string, unknown> = {};
  const beforeRec = before as unknown as Record<string, unknown>;
  const nextRec = next as unknown as Record<string, unknown>;
  for (const key of Object.keys(nextRec)) {
    if (!deepEqual(beforeRec[key], nextRec[key])) patch[key] = nextRec[key];
  }
  for (const key of Object.keys(beforeRec)) {
    if (key === "_id" || key === "_creationTime") continue;
    if (!(key in nextRec)) patch[key] = undefined;
  }
  if (Object.keys(patch).length > 0) await ctx.db.patch(before._id, patch);
  await applyCounterDiffs(ctx, next.userId, diffCounters(before, next));
  const joinRows = await ctx.db
    .query("threadCategories")
    .withIndex("by_thread", (q) => q.eq("threadId", before._id))
    .collect();
  await syncThreadCategories(ctx, before._id, next, joinRows);
  return before._id;
}

// Rebuilds the thread summary from its messages. Deletes the thread (and its
// refs and join rows, via writeThread) when no messages remain.
export async function recomputeThread(
  ctx: MutationCtx,
  threadId: Id<"threads">,
): Promise<void> {
  const existing = await ctx.db.get(threadId);
  const messages = await ctx.db
    .query("messages")
    .withIndex("by_thread", (q) => q.eq("threadId", threadId))
    .collect();

  if (messages.length === 0) {
    await writeThread(ctx, threadId, null);
    return;
  }

  const accountId = messages[0].accountId;
  const account = await ctx.db.get(accountId);
  const ownerEmails = account ? [account.email] : [];

  const summary = summarizeThread(
    messages,
    {
      inboxManual: existing?.inboxManual ?? false,
      inbox: existing?.inbox,
      snoozedUntil: existing?.snoozedUntil,
    },
    ownerEmails,
    Date.now(),
  );

  await writeThread(ctx, threadId, {
    userId: messages[0].userId,
    accountId,
    subject: summary.subject,
    participants: summary.participants,
    messageCount: summary.messageCount,
    unreadCount: summary.unreadCount,
    unread: summary.unread,
    starred: summary.starred,
    hasAttachments: summary.hasAttachments,
    hasDraft: summary.hasDraft,
    hasSent: summary.hasSent,
    snippet: summary.snippet,
    lastMessageAt: summary.lastMessageAt,
    location: summary.location,
    inbox: summary.inbox,
    inboxManual: existing?.inboxManual ?? false,
    categoryIds: summary.categoryIds as Id<"categories">[],
    snoozedUntil: existing?.snoozedUntil,
    listKey: summary.listKey,
  });
}

export function listKeyFor(
  location: string,
  inbox: "primary" | "other",
  snoozedUntil: number | undefined,
  now: number,
): ListKey {
  if (location !== "inbox") return location as ListKey;
  if (snoozedUntil !== undefined && snoozedUntil > now) return "snoozed";
  return inbox;
}
