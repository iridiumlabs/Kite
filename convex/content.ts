import { v } from "convex/values";
import { action, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUserId } from "./model/auth";
import { apiKeyArg } from "./validators";

export const messageOwner = internalQuery({
  args: { messageId: v.id("messages") },
  handler: async (ctx, args) => {
    const doc = await ctx.db.get(args.messageId);
    if (!doc) return null;
    return { userId: doc.userId, accountId: doc.accountId };
  },
});

// Fetches and sanitizes the full content of a message from IMAP.
export const getMessageContent = action({
  args: { ...apiKeyArg, messageId: v.id("messages") },
  handler: async (ctx, args): Promise<unknown> => {
    const userId = await requireUserId(ctx, args.apiKey);
    const owner = await ctx.runQuery(internal.content.messageOwner, {
      messageId: args.messageId,
    });
    if (!owner || owner.userId !== userId) {
      throw new Error("Message not found");
    }
    return await ctx.runAction(internal.node.content.getMessageContent, {
      messageId: args.messageId,
    });
  },
});

export const downloadAttachment = action({
  args: {
    ...apiKeyArg,
    messageId: v.id("messages"),
    attachmentId: v.string(),
  },
  handler: async (ctx, args): Promise<unknown> => {
    const userId = await requireUserId(ctx, args.apiKey);
    const owner = await ctx.runQuery(internal.content.messageOwner, {
      messageId: args.messageId,
    });
    if (!owner || owner.userId !== userId) {
      throw new Error("Message not found");
    }
    return await ctx.runAction(internal.node.content.downloadAttachment, {
      messageId: args.messageId,
      attachmentId: args.attachmentId,
    });
  },
});
