import { cronJobs } from "convex/server";
import { internalAction, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { writeThread, listKeyFor } from "./model/threads";

const crons = cronJobs();

// Un-snooze threads whose time has come, in bounded batches.
crons.interval("unsnooze", { minutes: 5 }, internal.crons.unsnoozeBatch, {});

// Sync every account that is due (2 min cadence, per-account backoff lives
// on nextSyncAfter).
crons.interval("syncDue", { minutes: 2 }, internal.crons.syncDueTick, {});

// Retry messages that fell back to heuristic classification.
crons.interval(
  "classifyRetry",
  { minutes: 10 },
  internal.node.classify.retryBatch,
  {},
);

// Sweep pending ops that became due without a fresh mutation to kick them.
crons.interval("opsSweeper", { minutes: 5 }, internal.crons.opsDueTick, {});

export const syncDueTick = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const ids = await ctx.runQuery(internal.syncStore.dueSyncAccounts, {
      now: Date.now(),
    });
    for (const accountId of ids) {
      await ctx.scheduler.runAfter(0, internal.node.sync.syncAccount, {
        accountId,
      });
    }
    return { scheduled: ids.length };
  },
});

export const opsDueTick = internalAction({
  args: {},
  handler: async (ctx): Promise<{ scheduled: number }> => {
    const ids = await ctx.runQuery(internal.syncStore.accountsWithDueOps, {
      now: Date.now(),
    });
    if (ids.length > 0) {
      // processOps sweeps every account with a due op under its own leases.
      await ctx.scheduler.runAfter(0, internal.node.ops.processOps, {});
    }
    return { scheduled: ids.length };
  },
});

const UNSNOOZE_BATCH = 100;

export const unsnoozeBatch = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const due = await ctx.db
      .query("threads")
      .withIndex("by_snoozed", (q) => q.lte("snoozedUntil", now))
      .take(UNSNOOZE_BATCH);
    for (const thread of due) {
      await writeThread(ctx, thread._id, {
        ...(thread as Doc<"threads">),
        snoozedUntil: undefined,
        listKey: listKeyFor(
          thread.location,
          thread.inbox,
          undefined,
          now,
        ),
      });
    }
    return due.length;
  },
});

export default crons;
