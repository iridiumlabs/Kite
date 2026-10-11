"use node";

import type { ActionCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

// Remote message rows are transient, especially imported drafts that are
// replaced by APPEND + EXPUNGE. Own the bytes before replacing any remote copy.
export async function materializeDraftAttachments(ctx: Pick<ActionCtx, "runAction" | "runMutation" | "storage">, initial: Doc<"drafts">): Promise<Doc<"drafts"> | null> {
  let draft = initial;
  for (let attempt = 0; attempt < 3; attempt++) {
    const refs = new Map(draft.attachments.filter(a => a.kind === "forward").map(a => [`${a.messageId}/${a.attachmentId}`, a]));
    if (!refs.size) return draft;
    const uploads: { messageId: Id<"messages">; attachmentId: string; storageId: Id<"_storage">; size: number }[] = [];
    let submitted = false;
    try {
      for (const att of refs.values()) {
        const data = await ctx.runAction(internal.node.content.fetchAttachmentData, { messageId: att.messageId, attachmentId: att.attachmentId });
        const storageId = await ctx.storage.store(new Blob([data], { type: att.contentType }));
        uploads.push({ messageId: att.messageId, attachmentId: att.attachmentId, storageId, size: data.byteLength });
      }
      submitted = true;
      const updated: Doc<"drafts"> | null = await ctx.runMutation(internal.syncStore.materializeDraftAttachments, { draftId: draft._id, accountId: initial.accountId, uploads });
      if (!updated) return null;
      draft = updated;
    } catch (error) {
      // A lost mutation response may hide committed references. Never delete
      // their files on that ambiguous path; pre-mutation failures are safe.
      if (!submitted) for (const upload of uploads) await ctx.storage.delete(upload.storageId);
      throw error;
    }
  }
  if (draft.attachments.some(a => a.kind === "forward")) throw new Error("Draft attachments changed during push. Try again.");
  return draft;
}
