import { v } from "convex/values";

export const addressV = v.object({
  name: v.optional(v.string()),
  email: v.string(),
});

// Shared by the live finalizer and the durable, SMTP-free recovery path.
export const sendCompletionArgs = {
  sendLogId: v.id("sendLog"),
  accountId: v.id("accounts"),
  draftId: v.optional(v.id("drafts")),
  replyToMessageDocId: v.optional(v.id("messages")),
  sentFolderId: v.optional(v.id("folders")),
  sentUid: v.optional(v.number()),
  messageIdHeader: v.string(),
  inReplyTo: v.optional(v.string()),
  references: v.array(v.string()),
  subject: v.string(),
  from: addressV,
  to: v.array(addressV),
  cc: v.array(addressV),
  bcc: v.array(addressV),
  rejectedRecipients: v.optional(v.array(v.string())),
  text: v.string(),
  attachments: v.array(
    v.object({
      id: v.string(),
      filename: v.string(),
      contentType: v.string(),
      size: v.number(),
      cid: v.optional(v.string()),
      inline: v.boolean(),
    }),
  ),
  sourceStorageId: v.optional(v.id("_storage")),
};
export const sendCompletionV = v.object(sendCompletionArgs);

export const apiKeyArg = { apiKey: v.optional(v.string()) };

export const inboxBucketV = v.union(
  v.literal("primary"),
  v.literal("other"),
);

export const MAX_BULK_IDS = 100;

export function checkBulkIds(
  threadIds: unknown[] | undefined,
  messageIds: unknown[] | undefined,
) {
  if (
    (threadIds && threadIds.length > MAX_BULK_IDS) ||
    (messageIds && messageIds.length > MAX_BULK_IDS)
  ) {
    throw new Error(`At most ${MAX_BULK_IDS} ids per call`);
  }
  if (
    (!threadIds || threadIds.length === 0) &&
    (!messageIds || messageIds.length === 0)
  ) {
    throw new Error("No targets given");
  }
}
