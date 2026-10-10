import { cronJobs } from "convex/server";
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc } from "./_generated/dataModel";
import { writeThread, listKeyFor } from "./model/threads";

const crons = cronJobs();

// Un-snooze threads whose time has come, in bounded batches.
crons.interval("unsnooze", { minutes: 5 }, internal.crons.unsnoozeBatch, {});

// Phase 2 will add the periodic sync cron here.

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
