// Internal read helpers used by scripts/live-e2e.ts and for debugging the
// local deployment. Not user-facing.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { generateApiKey } from "./lib/apiKeyFormat";

// Mints a real API key for a fixed user id (no Clerk session in scripts).
export const mintApiKey = internalMutation({
  args: { userId: v.string(), name: v.string() },
  handler: async (ctx, args) => {
    const { key, hash, prefix } = await generateApiKey();
    const id = await ctx.db.insert("apiKeys", {
      userId: args.userId,
      name: args.name,
      prefix,
      hash,
      createdAt: Date.now(),
    });
    return { id, key };
  },
});

export const foldersForAccount = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("folders")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();
  },
});

export const messagesForAccount = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    const folders = await ctx.db
      .query("folders")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();
    const folderIds = new Set(folders.map((f) => f._id));
    const out = [];
    for (const f of folders) {
      const msgs = await ctx.db
        .query("messages")
        .withIndex("by_folder_uid", (q) => q.eq("folderId", f._id))
        .collect();
      out.push(...msgs);
    }
    const local = await ctx.db
      .query("messages")
      .withIndex("by_account_msgid", (q) => q.eq("accountId", args.accountId))
      .collect();
    for (const m of local) {
      if (m.folderId === null || !folderIds.has(m.folderId)) out.push(m);
    }
    const seen = new Set<string>();
    return out.filter((m) => !seen.has(m._id) && seen.add(m._id));
  },
});

export const threadsForAccount = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("threads")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();
  },
});

export const opsForAccount = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("pendingOps")
      .withIndex("by_account_next", (q) => q.eq("accountId", args.accountId))
      .collect();
  },
});

export const sendLogForAccount = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    const all = await ctx.db.query("sendLog").collect();
    return all.filter((r) => r.accountId === args.accountId);
  },
});

export const draftsForAccount = internalQuery({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("drafts")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();
  },
});

export const countersForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("counters")
      .withIndex("by_user_key", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const docsForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const threads = await ctx.db.query("threads").collect();
    const messages = await ctx.db.query("messages").collect();
    const drafts = await ctx.db.query("drafts").collect();
    const counters = await ctx.db.query("counters").collect();
    const ops = await ctx.db.query("pendingOps").collect();
    const sendLog = await ctx.db.query("sendLog").collect();
    const folders = await ctx.db.query("folders").collect();
    return {
      accounts: accounts.length,
      folders: folders.filter((f) => f.userId === args.userId).length,
      threads: threads.filter((t) => t.userId === args.userId).length,
      messages: messages.filter((m) => m.userId === args.userId).length,
      drafts: drafts.filter((d) => d.userId === args.userId).length,
      counters: counters.filter((c) => c.userId === args.userId).length,
      pendingOps: ops.filter((o) => o.userId === args.userId).length,
      sendLog: sendLog.filter((s) => s.userId === args.userId).length,
    };
  },
});

export const accountForUser = internalQuery({
  args: { userId: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return accounts.find((a) => a.email === args.email) ?? null;
  },
});

// Full document snapshot of every user-scoped table. Used by the live E2E
// to prove a no-change sync writes nothing (syncLocks excluded there since
// lease acquire/release always writes it).
export const snapshotForUser = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const accountIds = new Set(accounts.map((a) => a._id));
    const out: Record<string, unknown[]> = { accounts };
    for (const table of [
      "folders",
      "messages",
      "threads",
      "drafts",
      "counters",
      "pendingOps",
      "sendLog",
      "accountSecrets",
    ] as const) {
      const rows = await ctx.db.query(table).collect();
      out[table] = rows.filter(
        (r) => (r as { userId?: string }).userId === args.userId,
      );
    }
    const locks = await ctx.db.query("syncLocks").collect();
    out.syncLocks = locks.filter((l) => accountIds.has(l.accountId));
    return out;
  },
});

// Hard-deletes every row owned by the user across all tables, including
// orphans (sendLog/counters left behind by older code paths). Debug/test
// only; the script's clean-slate step uses it.
export const purgeForUser = internalMutation({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    let n = 0;
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const accountIds = new Set<string>(
      accounts.map((a) => a._id as string),
    );
    for (const table of [
      "accounts",
      "folders",
      "messages",
      "threads",
      "threadRefs",
      "threadCategories",
      "drafts",
      "counters",
      "pendingOps",
      "sendLog",
      "accountSecrets",
      "syncLocks",
      "apiKeys",
      "categories",
      "userSettings",
    ] as const) {
      const rows = await ctx.db.query(table).collect();
      for (const r of rows) {
        const rec = r as { userId?: string; accountId?: string };
        if (
          rec.userId === args.userId ||
          (table === "syncLocks" &&
            rec.accountId !== undefined &&
            accountIds.has(rec.accountId))
        ) {
          await ctx.db.delete(r._id);
          n++;
        }
      }
    }
    return { deleted: n };
  },
});
