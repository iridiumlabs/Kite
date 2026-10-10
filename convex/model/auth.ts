import { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { hashApiKey } from "../lib/apiKeyFormat";

const LAST_USED_WRITE_INTERVAL_MS = 60 * 60 * 1000;

type AnyCtx = QueryCtx | MutationCtx | ActionCtx;

async function clerkSubject(ctx: AnyCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}

// Resolves the caller to a userId: a valid, unrevoked API key or a Clerk
// identity. Works in queries, mutations and actions; in actions the key
// lookup goes through an internal query since there is no ctx.db.
export async function requireUserId(
  ctx: AnyCtx,
  apiKey?: string,
): Promise<string> {
  if (apiKey) {
    const hash = await hashApiKey(apiKey);
    if ("db" in ctx && ctx.db) {
      const keyDoc = await ctx.db
        .query("apiKeys")
        .withIndex("by_hash", (q) => q.eq("hash", hash))
        .unique();
      if (!keyDoc || keyDoc.revokedAt !== undefined) {
        throw new Error("Invalid API key");
      }
      if ("patch" in ctx.db) {
        const now = Date.now();
        if (
          keyDoc.lastUsedAt === undefined ||
          now - keyDoc.lastUsedAt > LAST_USED_WRITE_INTERVAL_MS
        ) {
          await ctx.db.patch(keyDoc._id, { lastUsedAt: now });
        }
      }
      return keyDoc.userId;
    }
    const resolved = await (ctx as ActionCtx).runQuery(
      internal.apiKeys.resolveApiKey,
      { hash },
    );
    if (!resolved) throw new Error("Invalid API key");
    const now = Date.now();
    if (
      resolved.lastUsedAt === undefined ||
      now - resolved.lastUsedAt > LAST_USED_WRITE_INTERVAL_MS
    ) {
      await (ctx as ActionCtx).scheduler.runAfter(
        0,
        internal.apiKeys.touchApiKey,
        { keyId: resolved.keyId },
      );
    }
    return resolved.userId;
  }

  const subject = await clerkSubject(ctx);
  if (!subject) throw new Error("Unauthenticated");
  return subject;
}

// Clerk identity only; API keys must not mint or manage API keys.
export async function requireClerkUserId(ctx: AnyCtx): Promise<string> {
  const subject = await clerkSubject(ctx);
  if (!subject) throw new Error("Unauthenticated");
  return subject;
}

