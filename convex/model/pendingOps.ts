import { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Doc, Id } from "../_generated/dataModel";
import type { PendingOpDoc, PendingOpPayload } from "../lib/ports";

export function splitOpPayload(kind: PendingOpDoc["kind"], payload: PendingOpPayload): PendingOpPayload[] {
  if (kind === "flags") return (payload.updates ?? []).map(item => ({ updates: [item] }));
  if (kind === "move") return (payload.moves ?? []).map(item => ({ moves: [item] }));
  if (kind === "expunge") return (payload.expunges ?? []).map(item => ({ expunges: [item] }));
  return [payload];
}

export function opTargetKey(kind: PendingOpDoc["kind"], payload: PendingOpPayload): string {
  const item = payload.updates?.[0] ?? payload.moves?.[0] ?? payload.expunges?.[0];
  if (item?.messageId) return `message:${item.messageId}`;
  if (item) return `remote:${JSON.stringify([item.folderPath, item.uid])}`;
  if (payload.draftId) return `draft:${payload.draftId}`;
  return `${kind}:${JSON.stringify([payload.folderPath, payload.uid])}`;
}

export async function refreshAccountOps(ctx: MutationCtx, accountId: Id<"accounts">) {
  const account = await ctx.db.get(accountId);
  if (!account) return;
  const head = await ctx.db.query("opQueues").withIndex("by_account_next", q => q.eq("accountId", accountId)).first();
  const legacy = await ctx.db.query("pendingOps").withIndex("by_account_target_next", q => q.eq("accountId", accountId).eq("targetKey", undefined)).first();
  const next = legacy ? 0 : head?.nextAttemptAt;
  await ctx.db.patch(accountId, {
    opsNextAttemptAt: next === undefined ? undefined : Math.max(next, account.opsBackoffUntil ?? 0),
  });
}

// Recompute just one queue's predecessor, not the account's operation list.
export async function refreshTargetQueue(ctx: MutationCtx, accountId: Id<"accounts">, targetKey: string) {
  const queue = await ctx.db.query("opQueues").withIndex("by_account_target", q => q.eq("accountId", accountId).eq("targetKey", targetKey)).first();
  const head = await ctx.db.query("pendingOps").withIndex("by_account_target_order", q => q.eq("accountId", accountId).eq("targetKey", targetKey)).first();
  if (!head) {
    if (queue) await ctx.db.delete(queue._id);
    return;
  }
  const fields = { userId: head.userId, accountId, targetKey, headOpId: head._id, nextAttemptAt: head.nextAttemptAt };
  if (queue) await ctx.db.patch(queue._id, fields);
  else await ctx.db.insert("opQueues", fields);
}

async function insertQueuedOp(ctx: MutationCtx, fields: Omit<Doc<"pendingOps">, "_id" | "_creationTime">) {
  const targetKey = opTargetKey(fields.kind, fields.payload);
  const id = await ctx.db.insert("pendingOps", { ...fields, targetKey });
  if (fields.queueOrder === undefined) {
    await ctx.db.patch(id, { queueOrder: (await ctx.db.get(id))!._creationTime });
  }
  await refreshTargetQueue(ctx, fields.accountId, targetKey);
}

// Bounded rolling migration for already-persisted bulk operations. Even a
// single large batch is split incrementally, with its original queue order.
export async function migrateOps(ctx: MutationCtx, ops: Doc<"pendingOps">[], budget = 100) {
  const touched = new Set<Id<"accounts">>();
  for (const op of ops) {
    if (budget <= 0) break;
    const payloads = splitOpPayload(op.kind, op.payload);
    const selected = payloads.slice(0, budget);
    const { _id, _creationTime, ...fields } = op;
    for (const payload of selected) {
      await insertQueuedOp(ctx, { ...fields, payload, queueOrder: op.queueOrder ?? _creationTime });
    }
    budget -= Math.max(selected.length, 1);
    const rest = payloads.slice(selected.length);
    if (!rest.length) await ctx.db.delete(_id);
    else {
      const payload = { ...op.payload };
      const key = op.kind === "flags" ? "updates" : op.kind === "move" ? "moves" : "expunges";
      payload[key] = op.payload[key].slice(selected.length);
      await ctx.db.patch(_id, { payload });
    }
    touched.add(op.accountId);
  }
  for (const accountId of touched) await refreshAccountOps(ctx, accountId);
}

export type FlagOp = {
  folderPath: string; uid?: number; add: string[]; remove: string[]; messageId?: Id<"messages">;
};
export type MoveOp = {
  folderPath: string; uid?: number; targetRole: string; targetPath?: string; messageId?: Id<"messages">;
};
export type ExpungeOp = {
  folderPath: string; uid?: number; messageIdHeader?: string; messageId?: Id<"messages">;
};
export type PendingOpPayloads = {
  flags: { updates: FlagOp[] };
  move: { moves: MoveOp[] };
  expunge: { expunges: ExpungeOp[] };
  appendDraft: { draftId: Id<"drafts"> };
  deleteRemoteDraft: { folderPath: string; uid: number };
};
export type PendingOpKind = keyof PendingOpPayloads;

export async function enqueueOp<K extends PendingOpKind>(ctx: MutationCtx, args: {
  userId: string; accountId: Id<"accounts">; kind: K; payload: PendingOpPayloads[K];
}): Promise<void> {
  for (const payload of splitOpPayload(args.kind, args.payload as PendingOpPayload)) {
    await insertQueuedOp(ctx, {
      userId: args.userId, accountId: args.accountId, kind: args.kind, payload,
      attempts: 0, nextAttemptAt: Date.now(), createdAt: Date.now(),
    });
  }
  await refreshAccountOps(ctx, args.accountId);
  await ctx.scheduler.runAfter(0, internal.node.ops.processOps, {});
}
