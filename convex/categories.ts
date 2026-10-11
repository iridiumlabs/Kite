import { v } from "convex/values";
import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { requireUserId } from "./model/auth";
import { recomputeThread } from "./model/threads";
import { apiKeyArg } from "./validators";

const PURGE_BATCH = 50;

export const list = query({
  args: { ...apiKeyArg },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    return await ctx.db
      .query("categories")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const create = mutation({
  args: {
    ...apiKeyArg,
    name: v.string(),
    description: v.string(),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const existing = await ctx.db
      .query("categories")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const name = args.name.trim();
    if (!name) throw new Error("Category name cannot be empty.");
    if (
      existing.some((c) => c.name.trim().toLowerCase() === name.toLowerCase())
    ) {
      throw new Error("A category with this name already exists.");
    }
    const sortOrder =
      existing.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1;
    return await ctx.db.insert("categories", {
      userId,
      name,
      description: args.description,
      color: args.color ?? "#0a84ff",
      sortOrder,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    ...apiKeyArg,
    categoryId: v.id("categories"),
    name: v.optional(v.string()),
    description: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const cat = await ctx.db.get(args.categoryId);
    if (!cat || cat.userId !== userId) throw new Error("Category not found");
    const patch: Record<string, unknown> = {};
    if (args.name !== undefined) {
      const name = args.name.trim();
      if (!name) throw new Error("Category name cannot be empty.");
      const siblings = await ctx.db
        .query("categories")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      if (
        siblings.some(
          (c) =>
            c._id !== args.categoryId &&
            c.name.trim().toLowerCase() === name.toLowerCase(),
        )
      ) {
        throw new Error("A category with this name already exists.");
      }
      patch.name = name;
    }
    if (args.description !== undefined) patch.description = args.description;
    if (args.color !== undefined) patch.color = args.color;
    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(args.categoryId, patch);
    }
  },
});

// Deletion is batched: the category row goes away immediately, then
// purgeCategoryBatch walks threadCategories.by_category in small batches so
// no full scan ever happens. Message categoryIds are patched per thread and
// recomputeThread drops the join rows and fixes counters.
export const remove = mutation({
  args: { ...apiKeyArg, categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const cat = await ctx.db.get(args.categoryId);
    if (!cat || cat.userId !== userId) throw new Error("Category not found");
    await ctx.db.delete(args.categoryId);
    await ctx.scheduler.runAfter(
      0,
      internal.categories.purgeCategoryBatch,
      { userId, categoryId: args.categoryId },
    );
  },
});

export const purgeCategoryBatch = internalMutation({
  args: { userId: v.string(), categoryId: v.id("categories") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("threadCategories")
      .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
      .take(PURGE_BATCH);
    for (const row of rows) {
      const msgs = await ctx.db
        .query("messages")
        .withIndex("by_thread", (q) => q.eq("threadId", row.threadId))
        .collect();
      for (const m of msgs) {
        if (m.categoryIds.includes(args.categoryId)) {
          await ctx.db.patch(m._id, {
            categoryIds: m.categoryIds.filter(
              (id) => id !== args.categoryId,
            ),
          });
        }
      }
      await recomputeThread(ctx, row.threadId);
    }
    const remaining = await ctx.db
      .query("threadCategories")
      .withIndex("by_category", (q) => q.eq("categoryId", args.categoryId))
      .first();
    if (remaining) {
      await ctx.scheduler.runAfter(
        0,
        internal.categories.purgeCategoryBatch,
        args,
      );
    }
  },
});

export const reorder = mutation({
  args: { ...apiKeyArg, categoryIds: v.array(v.id("categories")) },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    for (let i = 0; i < args.categoryIds.length; i++) {
      const cat = await ctx.db.get(args.categoryIds[i] as Id<"categories">);
      if (!cat || cat.userId !== userId) throw new Error("Category not found");
      if (cat.sortOrder !== i) {
        await ctx.db.patch(cat._id, { sortOrder: i });
      }
    }
  },
});
