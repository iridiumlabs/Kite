import { MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { writeThread, type ThreadFields } from "./threads";

function emptyThread(userId: string, accountId: Id<"accounts">): ThreadFields {
  return {
    userId,
    accountId,
    subject: "",
    participants: [],
    messageCount: 0,
    unreadCount: 0,
    unread: false,
    starred: false,
    hasAttachments: false,
    hasDraft: false,
    hasSent: false,
    snippet: "",
    lastMessageAt: 0,
    location: "none",
    inbox: "primary",
    inboxManual: false,
    categoryIds: [],
    listKey: "none",
  };
}

// Per-account threading via threadRefs: every normalized message-id (own id,
// In-Reply-To and References) maps to a thread. None found -> new thread;
// several found -> merge into the oldest; missing refs are registered.
export async function resolveThread(
  ctx: MutationCtx,
  userId: string,
  accountId: Id<"accounts">,
  refs: { messageIdHeader?: string; inReplyTo?: string; references?: string[] },
): Promise<Id<"threads">> {
  const ids = [
    refs.messageIdHeader,
    refs.inReplyTo,
    ...(refs.references ?? []),
  ].filter((r): r is string => !!r);

  const found = new Map<Id<"threads">, Doc<"threads">>();
  for (const ref of ids) {
    const row = await ctx.db
      .query("threadRefs")
      .withIndex("by_account_ref", (q) =>
        q.eq("accountId", accountId).eq("ref", ref),
      )
      .unique();
    if (!row) continue;
    if (!found.has(row.threadId)) {
      const doc = await ctx.db.get(row.threadId);
      if (doc) found.set(row.threadId, doc);
    }
  }

  let threadId: Id<"threads">;
  if (found.size === 0) {
    threadId = (await writeThread(
      ctx,
      null,
      emptyThread(userId, accountId),
    ))!;
  } else {
    const threads = [...found.values()].sort(
      (a, b) => a._creationTime - b._creationTime,
    );
    const winner = threads[0];
    threadId = winner._id;
    for (const loser of threads.slice(1)) {
      const preserved: Record<string, unknown> = {};
      if (!winner.inboxManual && loser.inboxManual) {
        preserved.inboxManual = true;
        preserved.inbox = loser.inbox;
        winner.inboxManual = true;
        winner.inbox = loser.inbox;
      }
      if (
        winner.snoozedUntil === undefined &&
        loser.snoozedUntil !== undefined
      ) {
        preserved.snoozedUntil = loser.snoozedUntil;
        winner.snoozedUntil = loser.snoozedUntil;
      }
      if (Object.keys(preserved).length > 0) {
        await ctx.db.patch(threadId, preserved);
      }
      const refs = await ctx.db
        .query("threadRefs")
        .withIndex("by_thread", (q) => q.eq("threadId", loser._id))
        .collect();
      for (const ref of refs) {
        await ctx.db.patch(ref._id, { threadId });
      }
      const msgs = await ctx.db
        .query("messages")
        .withIndex("by_thread", (q) => q.eq("threadId", loser._id))
        .collect();
      for (const m of msgs) {
        await ctx.db.patch(m._id, { threadId });
      }
      await writeThread(ctx, loser._id, null);
    }
  }

  for (const ref of ids) {
    const existing = await ctx.db
      .query("threadRefs")
      .withIndex("by_account_ref", (q) =>
        q.eq("accountId", accountId).eq("ref", ref),
      )
      .unique();
    if (existing) {
      if (existing.threadId !== threadId) {
        await ctx.db.patch(existing._id, { threadId });
      }
      continue;
    }
    await ctx.db.insert("threadRefs", { accountId, ref, threadId });
  }

  // The caller recomputes the thread after writing its message; recomputing
  // here would delete the just-created empty skeleton.
  return threadId;
}
