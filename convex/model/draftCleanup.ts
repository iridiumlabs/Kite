import type { MutationCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";
import { enqueueOp } from "./pendingOps";

export async function removeDraft(ctx: MutationCtx, draft: Doc<"drafts">) {
  for (const att of draft.attachments) if (att.kind === "upload") await ctx.storage.delete(att.storageId).catch(() => {});
  if (draft.scheduledJobId) await ctx.scheduler.cancel(draft.scheduledJobId).catch(() => {});
  if (draft.remoteUid !== undefined && draft.remoteFolderId) {
    const folder = await ctx.db.get(draft.remoteFolderId);
    if (folder) await enqueueOp(ctx, { userId: draft.userId, accountId: draft.accountId, kind: "deleteRemoteDraft", payload: { folderPath: folder.path, uid: draft.remoteUid } });
  }
  await ctx.db.delete(draft._id);
  const counter = await ctx.db.query("counters").withIndex("by_user_key", q => q.eq("userId", draft.userId).eq("key", "drafts")).first();
  if (counter && counter.count > 0) await ctx.db.patch(counter._id, { count: counter.count - 1 });
}
