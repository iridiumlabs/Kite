import { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";

// Per-kind payload shapes stored in pendingOps.payload. The node ops action
// (phase 2) interprets these against IMAP.
export type FlagOp = {
  folderPath: string;
  uid?: number;
  add: string[];
  remove: string[];
  messageId?: Id<"messages">;
};
export type MoveOp = {
  folderPath: string;
  uid?: number;
  targetRole: string;
  targetPath?: string;
  messageId?: Id<"messages">;
};
export type ExpungeOp = {
  folderPath: string;
  uid?: number;
  messageIdHeader?: string;
  messageId?: Id<"messages">;
};
export type PendingOpPayloads = {
  flags: { updates: FlagOp[] };
  move: { moves: MoveOp[] };
  expunge: { expunges: ExpungeOp[] };
  appendDraft: { draftId: Id<"drafts"> };
  deleteRemoteDraft: { folderPath: string; uid: number };
};
export type PendingOpKind = keyof PendingOpPayloads;

export async function enqueueOp<K extends PendingOpKind>(
  ctx: MutationCtx,
  args: {
    userId: string;
    accountId: Id<"accounts">;
    kind: K;
    payload: PendingOpPayloads[K];
  },
): Promise<void> {
  await ctx.db.insert("pendingOps", {
    userId: args.userId,
    accountId: args.accountId,
    kind: args.kind,
    payload: args.payload,
    attempts: 0,
    nextAttemptAt: Date.now(),
    createdAt: Date.now(),
  });
  await ctx.scheduler.runAfter(0, internal.node.ops.processOps, {});
}
