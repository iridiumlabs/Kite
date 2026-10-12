import { expect, test } from "vitest";
import { internal } from "../../convex/_generated/api";
import { enqueueOp } from "../../convex/model/pendingOps";
import { makeT, seedAccount } from "./testUtil";
import type { Id } from "../../convex/_generated/dataModel";

const USER = "user_queue";

test("new bulk operations have independent retry records", async () => {
  const t = makeT();
  const accountId = await seedAccount(t, USER);
  await t.run(ctx => enqueueOp(ctx, {
    userId: USER, accountId, kind: "flags",
    payload: { updates: [1, 2].map(uid => ({ folderPath: "INBOX", uid, add: ["\\Seen"], remove: [] })) },
  }));
  const ops = await t.run(ctx => ctx.db.query("pendingOps").collect());
  expect(ops).toHaveLength(2);
  expect(ops.map(op => op.payload.updates.length)).toEqual([1, 1]);
});

test("legacy batch normalization retains queue order and blocks successors during backoff", async () => {
  const t = makeT();
  const accountId = await seedAccount(t, USER);
  const first = "first" as Id<"messages">;
  const second = "second" as Id<"messages">;
  await t.run(async ctx => {
    await ctx.db.insert("pendingOps", {
      userId: USER, accountId, kind: "move", attempts: 1, nextAttemptAt: 10000, createdAt: 1,
      payload: { moves: [first, second].map(messageId => ({ folderPath: "INBOX", uid: 1, messageId, targetRole: "archive" })) },
    });
    await ctx.db.insert("pendingOps", {
      userId: USER, accountId, kind: "move", attempts: 0, nextAttemptAt: 0, createdAt: 2,
      payload: { moves: [{ folderPath: "Archive", uid: 1, messageId: first, targetRole: "trash" }] },
    });
  });
  expect(await t.mutation(internal.syncStore.dueOps, { accountId, now: 5000 })).toEqual([]);
  const due = await t.mutation(internal.syncStore.dueOps, { accountId, now: 10000 });
  expect(due).toHaveLength(2);
  expect(due.every(op => op.payload.moves[0].targetRole === "archive")).toBe(true);
  await t.mutation(internal.syncStore.completeOp, { opId: due.find(op => op.payload.moves[0].messageId === first)!._id });
  const next = await t.mutation(internal.syncStore.dueOps, { accountId, now: 10000 });
  expect(next.find(op => op.payload.moves[0].messageId === first)!.payload.moves[0].targetRole).toBe("trash");
});
