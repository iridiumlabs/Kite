import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { requireClerkUserId } from "./model/auth";
import { generateApiKey, hashApiKey } from "./lib/apiKeyFormat";

// Key management is Clerk-authenticated only: an API key must not be able to
// mint or revoke other keys.
export const create = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const userId = await requireClerkUserId(ctx);
    const { key, hash, prefix } = await generateApiKey();
    const id = await ctx.db.insert("apiKeys", {
      userId,
      name: args.name,
      prefix,
      hash,
      createdAt: Date.now(),
    });
    return { id, key, prefix };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireClerkUserId(ctx);
    const docs = await ctx.db
      .query("apiKeys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return docs.map((d) => ({
      _id: d._id,
      name: d.name,
      prefix: d.prefix,
      createdAt: d.createdAt,
      lastUsedAt: d.lastUsedAt,
      revokedAt: d.revokedAt,
    }));
  },
});

export const revoke = mutation({
  args: { apiKeyId: v.id("apiKeys") },
  handler: async (ctx, args) => {
    const userId = await requireClerkUserId(ctx);
    const doc = await ctx.db.get(args.apiKeyId);
    if (!doc || doc.userId !== userId) throw new Error("API key not found");
    if (doc.revokedAt === undefined) {
      await ctx.db.patch(args.apiKeyId, { revokedAt: Date.now() });
    }
  },
});

// Resolves a raw API key to its owner for the MCP endpoint's bearer-token
// verification. A query, so it never writes lastUsedAt; the throttled touch
// happens inside the apiKey-authorized functions themselves.
export const whoami = query({
  args: { apiKey: v.string() },
  handler: async (ctx, args) => {
    const hash = await hashApiKey(args.apiKey);
    const keyDoc = await ctx.db
      .query("apiKeys")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (!keyDoc || keyDoc.revokedAt !== undefined) return null;
    return { userId: keyDoc.userId, keyName: keyDoc.name };
  },
});

export const resolveApiKey = internalQuery({
  args: { hash: v.string() },
  handler: async (ctx, { hash }) => {
    const keyDoc = await ctx.db
      .query("apiKeys")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (!keyDoc || keyDoc.revokedAt !== undefined) return null;
    return {
      keyId: keyDoc._id,
      userId: keyDoc.userId,
      lastUsedAt: keyDoc.lastUsedAt,
    };
  },
});

export const touchApiKey = internalMutation({
  args: { keyId: v.id("apiKeys") },
  handler: async (ctx, { keyId }) => {
    await ctx.db.patch(keyId, { lastUsedAt: Date.now() });
  },
});
