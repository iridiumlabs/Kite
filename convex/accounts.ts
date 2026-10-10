import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUserId } from "./model/auth";
import { writeThread } from "./model/threads";
import { apiKeyArg } from "./validators";

const THREAD_BATCH = 25;
const ROW_BATCH = 50;

export const list = query({
  args: { ...apiKeyArg },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    return await ctx.db
      .query("accounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const remove = mutation({
  args: { ...apiKeyArg, accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const account = await ctx.db.get(args.accountId);
    if (!account || account.userId !== userId) {
      throw new Error("Account not found");
    }
    const secret = await ctx.db
      .query("accountSecrets")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();
    if (secret) await ctx.db.delete(secret._id);
    const lock = await ctx.db
      .query("syncLocks")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();
    if (lock) await ctx.db.delete(lock._id);
    const folders = await ctx.db
      .query("folders")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();
    for (const f of folders) await ctx.db.delete(f._id);
    await ctx.db.delete(args.accountId);
    await ctx.scheduler.runAfter(0, internal.accounts.purgeAccountBatch, {
      userId,
      accountId: args.accountId,
    });
  },
});

// Batched teardown of everything keyed by accountId. Threads are removed via
// writeThread so counters and join rows stay correct; batches reschedule
// until the account is fully gone.
export const purgeAccountBatch = internalMutation({
  args: { userId: v.string(), accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .take(THREAD_BATCH);
    if (threads.length > 0) {
      for (const t of threads) {
        const msgs = await ctx.db
          .query("messages")
          .withIndex("by_thread", (q) => q.eq("threadId", t._id))
          .collect();
        for (const m of msgs) await ctx.db.delete(m._id);
        await writeThread(ctx, t._id, null);
      }
      await ctx.scheduler.runAfter(
        0,
        internal.accounts.purgeAccountBatch,
        args,
      );
      return;
    }

    const drafts = await ctx.db
      .query("drafts")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .take(ROW_BATCH);
    for (const d of drafts) {
      await ctx.db.delete(d._id);
      const counter = await ctx.db
        .query("counters")
        .withIndex("by_user_key", (q) =>
          q.eq("userId", args.userId).eq("key", "drafts"),
        )
        .unique();
      if (counter && counter.count > 0) {
        await ctx.db.patch(counter._id, { count: counter.count - 1 });
      }
    }
    const ops = await ctx.db
      .query("pendingOps")
      .withIndex("by_account_next", (q) => q.eq("accountId", args.accountId))
      .take(ROW_BATCH);
    for (const op of ops) await ctx.db.delete(op._id);
    if (drafts.length === ROW_BATCH || ops.length === ROW_BATCH) {
      await ctx.scheduler.runAfter(
        0,
        internal.accounts.purgeAccountBatch,
        args,
      );
    }
  },
});
