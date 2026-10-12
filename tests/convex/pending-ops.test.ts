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

test("account backoff does not consume message retries or hide healthy accounts", async () => {
  const t = makeT();
  const bad = await seedAccount(t, USER);
  const good = await seedAccount(t, USER, "other@x.com");
  for (const accountId of [bad, good]) await t.run(ctx => enqueueOp(ctx, {
    userId: USER, accountId, kind: "flags",
    payload: { updates: [{ folderPath: "INBOX", uid: 1, add: ["\\Seen"], remove: [] }] },
  }));
  const now = Date.now();
  await t.mutation(internal.syncStore.backoffAccountOps, { accountId: bad, error: "Offline", now });
  expect(await t.mutation(internal.syncStore.accountsWithDueOps, { now })).toEqual([good]);
  expect(await t.mutation(internal.syncStore.dueOps, { accountId: bad, now })).toEqual([]);
  expect((await t.run(ctx => ctx.db.query("pendingOps").collect())).every(op => op.attempts === 0)).toBe(true);
  expect(await t.mutation(internal.syncStore.accountsWithDueOps, { now: now + 30_000 })).toContain(bad);
  await t.mutation(internal.syncStore.clearOpsBackoff, { accountId: bad });
  expect(await t.mutation(internal.syncStore.accountsWithDueOps, { now })).toContain(bad);
});

test("a large superseding backlog cannot starve an unrelated runnable head", async () => {
  const t = makeT();
  const accountId = await seedAccount(t, USER);
  await t.run(async ctx => {
    let first!: Id<"pendingOps">;
    for (let i = 0; i < 1200; i++) {
      const id = await ctx.db.insert("pendingOps", {
        userId: USER, accountId, kind: "flags", attempts: 0, createdAt: 0,
        targetKey: "message:blocked", queueOrder: i, nextAttemptAt: i === 0 ? 10000 : 0,
        payload: { updates: [{ folderPath: "INBOX", uid: 1, messageId: "blocked", add: ["\\Seen"], remove: [] }] },
      });
      if (i === 0) first = id;
    }
    await ctx.db.insert("opQueues", { userId: USER, accountId, targetKey: "message:blocked", headOpId: first, nextAttemptAt: 10000 });
  });
  await t.run(ctx => enqueueOp(ctx, { userId: USER, accountId, kind: "flags", payload: {
    updates: [{ folderPath: "INBOX", uid: 2, add: ["\\Seen"], remove: [] }],
  } }));
  const due = await t.mutation(internal.syncStore.dueOps, { accountId, now: Date.now() });
  // Use a future deadline for the blocked head relative to the selector's now.
  await t.mutation(internal.syncStore.failOp, { opId: due.find(op => op.targetKey === "message:blocked")!._id, error: "Missing", waiting: true, drop: false, nextAttemptAt: Date.now() + 60000 });
  const runnable = await t.mutation(internal.syncStore.dueOps, { accountId, now: Date.now() });
  expect(runnable).toHaveLength(1);
  expect(runnable[0].payload.updates[0].uid).toBe(2);
}, 30000);

test("global migration does not replace IDs held by an active legacy worker", async () => {
  const t = makeT();
  const accountId = await seedAccount(t, USER);
  const opId = await t.run(ctx => ctx.db.insert("pendingOps", {
    userId: USER, accountId, kind: "flags", attempts: 0, nextAttemptAt: 0, createdAt: 0,
    payload: { updates: [{ folderPath: "INBOX", uid: 1, add: ["\\Seen"], remove: [] }] },
  }));
  await t.mutation(internal.syncStore.acquireLease, { accountId, owner: "old-worker", ttlMs: 60000 });
  expect(await t.mutation(internal.syncStore.accountsWithDueOps, { now: Date.now() })).toEqual([]);
  expect(await t.run(ctx => ctx.db.get(opId))).not.toBeNull();
  await t.mutation(internal.syncStore.releaseLease, { accountId, owner: "old-worker" });
  expect(await t.mutation(internal.syncStore.accountsWithDueOps, { now: Date.now() })).toEqual([accountId]);
  expect(await t.run(ctx => ctx.db.get(opId))).toBeNull();
});

test("large legacy batches migrate incrementally before any predecessor runs", async () => {
  const t = makeT();
  const accountId = await seedAccount(t, USER);
  await t.run(ctx => ctx.db.insert("pendingOps", {
    userId: USER, accountId, kind: "flags", attempts: 0, nextAttemptAt: 0, createdAt: 0,
    payload: { updates: Array.from({ length: 350 }, (_, i) => ({ folderPath: "INBOX", uid: i + 1, add: ["\\Seen"], remove: [] })) },
  }));
  for (let i = 0; i < 3; i++) {
    expect(await t.mutation(internal.syncStore.dueOps, { accountId, now: Date.now() })).toEqual([]);
  }
  const due = await t.mutation(internal.syncStore.dueOps, { accountId, now: Date.now() });
  expect(due).toHaveLength(100);
  const queues = await t.run(ctx => ctx.db.query("opQueues").collect());
  expect(queues).toHaveLength(350);
  expect((await t.run(ctx => ctx.db.query("pendingOps").collect())).every(op => op.targetKey !== undefined)).toBe(true);
}, 30000);

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
