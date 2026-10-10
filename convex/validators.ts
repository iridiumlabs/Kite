import { v } from "convex/values";

export const addressV = v.object({
  name: v.optional(v.string()),
  email: v.string(),
});

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
