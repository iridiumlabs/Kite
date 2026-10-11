"use node";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { ActionCtx } from "../_generated/server";
import type {
  FlagBits,
  FolderPatch,
  IngestMessageArg,
  StorePort,
} from "../lib/ports";
import type { FolderRole } from "../lib/types";

type Ctx = Pick<ActionCtx, "runQuery" | "runMutation">;

export function makeStorePort(ctx: Ctx, accountId: Id<"accounts">): StorePort {
  return {
    async getAccountState() {
      const state = await ctx.runQuery(internal.syncStore.getAccountSyncState, {
        accountId,
      });
      if (!state) return null;
      return { account: state.account as never, folders: state.folders as never };
    },
    async upsertFolder(f) {
      return await ctx.runMutation(internal.syncStore.upsertFolder, {
        accountId,
        path: f.path,
        role: f.role as never,
        delimiter: f.delimiter,
        uidValidity: f.uidValidity,
        uidNext: f.uidNext,
      });
    },
    async markDiscovery(at) {
      await ctx.runMutation(internal.syncStore.markFolderDiscovery, {
        accountId,
        at,
      });
    },
    async ingestBatch(
      folderId: string,
      folderRole: FolderRole,
      messages: IngestMessageArg[],
      folderPatch: FolderPatch,
    ) {
      const state = await ctx.runQuery(
        internal.syncStore.getAccountSyncState,
        { accountId },
      );
      return await ctx.runMutation(internal.syncStore.ingestBatch, {
        userId: state!.account.userId,
        accountId,
        folderId: folderId as Id<"folders">,
        folderRole: folderRole as never,
        messages: messages as never,
        folderPatch,
      });
    },
    async patchFolderState(folderId, patch) {
      await ctx.runMutation(internal.syncStore.patchFolderState, {
        folderId: folderId as Id<"folders">,
        patch,
      });
    },
    async messagesByUids(folderId, uids) {
      return (await ctx.runQuery(internal.syncStore.messagesByUids, {
        folderId: folderId as Id<"folders">,
        uids,
      })) as never;
    },
    async messagesByMsgIds(account, msgIds) {
      return (await ctx.runQuery(internal.syncStore.messagesByMsgIds, {
        accountId: account as Id<"accounts">,
        msgIds,
      })) as never;
    },
    async relocateMessages(moves) {
      await ctx.runMutation(internal.syncStore.relocateMessages, {
        moves: moves.map((m) => ({
          messageId: m.messageId as Id<"messages">,
          folderId: m.folderId as Id<"folders">,
          folderRole: m.folderRole as never,
          uid: m.uid,
        })),
      });
    },
    async deleteMessages(ids) {
      await ctx.runMutation(internal.syncStore.deleteMessages, {
        ids: ids as Id<"messages">[],
      });
    },
    async applyFlagChanges(updates: ({ folderId: string; uid: number } & FlagBits)[]) {
      await ctx.runMutation(internal.syncStore.applyFlagChanges, {
        updates: updates.map((u) => ({
          folderId: u.folderId as Id<"folders">,
          uid: u.uid,
          seen: u.seen,
          flagged: u.flagged,
          answered: u.answered,
        })),
      });
    },
    async applyMoveResults(moves, folderPatches) {
      await ctx.runMutation(internal.syncStore.applyMoveResults, {
        moves: moves.map((m) => ({
          messageId: m.messageId as Id<"messages">,
          folderId: m.folderId as Id<"folders">,
          folderRole: m.folderRole as never,
          uid: m.uid,
        })),
        folderPatches: folderPatches.map((fp) => ({
          folderId: fp.folderId as Id<"folders">,
          patch: fp.patch,
        })),
      });
    },
    async updateAccount(patch) {
      await ctx.runMutation(
        internal.syncStore.updateAccountSync,
        { accountId, ...patch } as never,
      );
    },
    async dueOps(now) {
      return (await ctx.runQuery(internal.syncStore.dueOps, {
        accountId,
        now,
      })) as never;
    },
    async opMessageRefs(ids) {
      return (await ctx.runQuery(internal.syncStore.opMessageRefs, {
        ids: ids as Id<"messages">[],
      })) as never;
    },
    async completeOp(opId) {
      await ctx.runMutation(internal.syncStore.completeOp, {
        opId: opId as Id<"pendingOps">,
      });
    },
    async failOp(opId, error, nextAttemptAt, drop, waiting) {
      await ctx.runMutation(internal.syncStore.failOp, {
        opId: opId as Id<"pendingOps">,
        error,
        nextAttemptAt,
        drop,
        waiting,
      });
    },
    async threadContexts(items) {
      return (await ctx.runQuery(internal.syncStore.threadContexts, {
        accountId,
        items,
      })) as never;
    },
    async categories() {
      return (await ctx.runQuery(internal.syncStore.categoriesForAccount, {
        accountId,
      })) as never;
    },
    async draftsForAccount() {
      return (await ctx.runQuery(internal.syncStore.draftsForAccount, {
        accountId,
      })) as never;
    },
    async linkRemoteDraft(draftId, folderId, uid) {
      await ctx.runMutation(internal.syncStore.linkRemoteDraft, {
        draftId: draftId as Id<"drafts">,
        folderId: folderId as Id<"folders">,
        uid,
      });
    },
    async importRemoteDraft(fields) {
      const state = await ctx.runQuery(
        internal.syncStore.getAccountSyncState,
        { accountId },
      );
      return await ctx.runMutation(internal.syncStore.importRemoteDraft, {
        userId: state!.account.userId,
        accountId,
        messageIdHeader: fields.messageIdHeader,
        subject: fields.subject,
        to: fields.to as never,
        cc: fields.cc as never,
        bcc: fields.bcc as never,
        html: fields.html,
        text: fields.text,
        remoteFolderId: fields.remoteFolderId as Id<"folders">,
        remoteUid: fields.remoteUid,
        attachments: fields.attachments as never,
      });
    },
    async deleteDraft(draftId) {
      await ctx.runMutation(internal.syncStore.deleteDraft, {
        draftId: draftId as Id<"drafts">,
      });
    },
  };
}
