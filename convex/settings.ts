import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireUserId } from "./model/auth";
import { apiKeyArg } from "./validators";
import type { Doc } from "./_generated/dataModel";

const DEFAULTS: Pick<Doc<"userSettings">, "theme" | "loadRemoteImages" | "undoSendSeconds"> = {
  theme: "system",
  loadRemoteImages: false,
  undoSendSeconds: 5,
};

export const get = query({
  args: { ...apiKeyArg },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const doc = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return doc ?? { userId, ...DEFAULTS };
  },
});

export const update = mutation({
  args: {
    ...apiKeyArg,
    theme: v.optional(
      v.union(v.literal("system"), v.literal("light"), v.literal("dark")),
    ),
    loadRemoteImages: v.optional(v.boolean()),
    undoSendSeconds: v.optional(v.number()),
    defaultAccountId: v.optional(v.union(v.id("accounts"), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const existing = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const patch: Record<string, unknown> = {};
    if (args.theme !== undefined) patch.theme = args.theme;
    if (args.loadRemoteImages !== undefined) {
      patch.loadRemoteImages = args.loadRemoteImages;
    }
    if (args.undoSendSeconds !== undefined) {
      patch.undoSendSeconds = args.undoSendSeconds;
    }
    if (args.defaultAccountId === null) patch.defaultAccountId = undefined;
    else if (args.defaultAccountId !== undefined) {
      const account = await ctx.db.get(args.defaultAccountId);
      if (!account || account.userId !== userId) {
        throw new Error("Account not found");
      }
      patch.defaultAccountId = args.defaultAccountId;
    }
    if (Object.keys(patch).length === 0) return;
    if (existing) {
      await ctx.db.patch(existing._id, patch);
    } else {
      await ctx.db.insert("userSettings", {
        userId,
        ...DEFAULTS,
        ...(patch as typeof DEFAULTS),
      });
    }
  },
});
