import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { ingestMessage } from "./model/ingest";
import { addressV } from "./validators";

// Used by the sync action (phase 2) and by local Sent inserts. Not
// client-callable.
export const ingest = internalMutation({
  args: {
    userId: v.string(),
    accountId: v.id("accounts"),
    folderId: v.union(v.id("folders"), v.null()),
    folderRole: v.union(
      v.literal("inbox"),
      v.literal("sent"),
      v.literal("drafts"),
      v.literal("archive"),
      v.literal("trash"),
      v.literal("junk"),
      v.literal("local"),
    ),
    uid: v.optional(v.number()),
    messageIdHeader: v.string(),
    inReplyTo: v.optional(v.string()),
    references: v.optional(v.array(v.string())),
    subject: v.string(),
    from: addressV,
    to: v.array(addressV),
    cc: v.array(addressV),
    bcc: v.array(addressV),
    replyTo: v.array(addressV),
    date: v.number(),
    snippet: v.string(),
    seen: v.boolean(),
    flagged: v.boolean(),
    answered: v.boolean(),
    isOutbound: v.boolean(),
    hasAttachments: v.boolean(),
    attachments: v.optional(
      v.array(
        v.object({
          id: v.string(),
          filename: v.string(),
          contentType: v.string(),
          size: v.number(),
          cid: v.optional(v.string()),
          inline: v.boolean(),
        }),
      ),
    ),
    size: v.optional(v.number()),
    inbox: v.optional(v.union(v.literal("primary"), v.literal("other"))),
    categoryIds: v.optional(v.array(v.id("categories"))),
    classifiedBy: v.optional(
      v.union(
        v.literal("jev"),
        v.literal("heuristic"),
        v.literal("manual"),
        v.literal("inherited"),
      ),
    ),
    needsClassification: v.optional(v.boolean()),
  classificationCategories: v.optional(v.array(v.object({ id: v.id("categories"), name: v.string(), description: v.string() }))),
    classifyAttempts: v.optional(v.number()),
    bulk: v.optional(v.boolean()),
    postDraftId: v.optional(v.string()),
    sourceStorageId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, args) => {
    return await ingestMessage(ctx, args);
  },
});
