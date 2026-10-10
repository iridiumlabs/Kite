import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { requireUserId } from "./model/auth";
import { writeThread } from "./model/threads";
import { apiKeyArg } from "./validators";
import { normalizeEmail } from "./lib/addresses";
import { Id } from "./_generated/dataModel";

interface AccountCapabilities {
  condstore: boolean;
  qresync: boolean;
  move: boolean;
  uidplus: boolean;
  specialUse: boolean;
}

const THREAD_BATCH = 25;
const ROW_BATCH = 50;

export const list = query({
  args: { ...apiKeyArg },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    return await ctx.db
      .query("accounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const remove = mutation({
  args: { ...apiKeyArg, accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const account = await ctx.db.get(args.accountId);
    if (!account || account.userId !== userId) {
      throw new Error("Account not found");
    }
    const secret = await ctx.db
      .query("accountSecrets")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();
    if (secret) await ctx.db.delete(secret._id);
    const lock = await ctx.db
      .query("syncLocks")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();
    if (lock) await ctx.db.delete(lock._id);
    const folders = await ctx.db
      .query("folders")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .collect();
    for (const f of folders) await ctx.db.delete(f._id);
    await ctx.db.delete(args.accountId);
    await ctx.scheduler.runAfter(0, internal.accounts.purgeAccountBatch, {
      userId,
      accountId: args.accountId,
    });
  },
});

// Batched teardown of everything keyed by accountId. Threads are removed via
// writeThread so counters and join rows stay correct; batches reschedule
// until the account is fully gone.
export const purgeAccountBatch = internalMutation({
  args: { userId: v.string(), accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    const threads = await ctx.db
      .query("threads")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .take(THREAD_BATCH);
    if (threads.length > 0) {
      for (const t of threads) {
        const msgs = await ctx.db
          .query("messages")
          .withIndex("by_thread", (q) => q.eq("threadId", t._id))
          .collect();
        for (const m of msgs) await ctx.db.delete(m._id);
        await writeThread(ctx, t._id, null);
      }
      await ctx.scheduler.runAfter(
        0,
        internal.accounts.purgeAccountBatch,
        args,
      );
      return;
    }

    const drafts = await ctx.db
      .query("drafts")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .take(ROW_BATCH);
    for (const d of drafts) {
      await ctx.db.delete(d._id);
      const counter = await ctx.db
        .query("counters")
        .withIndex("by_user_key", (q) =>
          q.eq("userId", args.userId).eq("key", "drafts"),
        )
        .unique();
      if (counter && counter.count > 0) {
        await ctx.db.patch(counter._id, { count: counter.count - 1 });
      }
    }
    const ops = await ctx.db
      .query("pendingOps")
      .withIndex("by_account_next", (q) => q.eq("accountId", args.accountId))
      .take(ROW_BATCH);
    for (const op of ops) await ctx.db.delete(op._id);
    const sendLogs = (await ctx.db.query("sendLog").collect())
      .filter((row) => row.accountId === args.accountId)
      .slice(0, ROW_BATCH);
    for (const row of sendLogs) await ctx.db.delete(row._id);
    if (
      drafts.length === ROW_BATCH ||
      ops.length === ROW_BATCH ||
      sendLogs.length === ROW_BATCH
    ) {
      await ctx.scheduler.runAfter(
        0,
        internal.accounts.purgeAccountBatch,
        args,
      );
      return;
    }
    const accountCounter = await ctx.db
      .query("counters")
      .withIndex("by_user_key", (q) =>
        q
          .eq("userId", args.userId)
          .eq("key", `unread:acct:${args.accountId}`),
      )
      .first();
    if (accountCounter) await ctx.db.delete(accountCounter._id);
  },
});

export const accountByEmail = internalQuery({
  args: { userId: v.string(), email: v.string() },
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return (
      accounts.find(
        (a) => normalizeEmail(a.email) === normalizeEmail(args.email),
      ) ?? null
    );
  },
});

export const accountSortOrderMax = internalQuery({
  args: { userId: v.string() },
  handler: async (ctx, args) => {
    const accounts = await ctx.db
      .query("accounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return accounts.reduce((max, a) => Math.max(max, a.sortOrder), 0);
  },
});

export const insertAccount = internalMutation({
  args: {
    userId: v.string(),
    email: v.string(),
    displayName: v.string(),
    imapHost: v.string(),
    imapPort: v.number(),
    imapSecure: v.boolean(),
    smtpHost: v.string(),
    smtpPort: v.number(),
    smtpSecure: v.boolean(),
    username: v.string(),
    capabilities: v.object({
      condstore: v.boolean(),
      qresync: v.boolean(),
      move: v.boolean(),
      uidplus: v.boolean(),
      specialUse: v.boolean(),
    }),
    secretPayload: v.string(),
    sortOrder: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const accountId = await ctx.db.insert("accounts", {
      userId: args.userId,
      email: args.email,
      displayName: args.displayName,
      imapHost: args.imapHost,
      imapPort: args.imapPort,
      imapSecure: args.imapSecure,
      smtpHost: args.smtpHost,
      smtpPort: args.smtpPort,
      smtpSecure: args.smtpSecure,
      username: args.username,
      status: "connecting",
      initialSyncDone: false,
      capabilities: args.capabilities,
      sortOrder: args.sortOrder,
      createdAt: now,
    });
    await ctx.db.insert("accountSecrets", {
      accountId,
      userId: args.userId,
      payload: args.secretPayload,
    });
    return accountId;
  },
});

export const replaceSecret = internalMutation({
  args: {
    accountId: v.id("accounts"),
    userId: v.string(),
    username: v.string(),
    secretPayload: v.string(),
  },
  handler: async (ctx, args) => {
    const account = await ctx.db.get(args.accountId);
    if (!account || account.userId !== args.userId) {
      throw new Error("Account not found");
    }
    const secret = await ctx.db
      .query("accountSecrets")
      .withIndex("by_account", (q) => q.eq("accountId", args.accountId))
      .first();
    if (secret) {
      await ctx.db.patch(secret._id, { payload: args.secretPayload });
    } else {
      await ctx.db.insert("accountSecrets", {
        accountId: args.accountId,
        userId: args.userId,
        payload: args.secretPayload,
      });
    }
    await ctx.db.patch(args.accountId, {
      username: args.username,
      status: "connecting",
      lastError: undefined,
      nextSyncAfter: undefined,
      syncFailCount: 0,
    });
  },
});

const DEFAULT_IMAP_HOST = "mail.spacemail.com";
const DEFAULT_SMTP_HOST = "mail.spacemail.com";

// Connect a Spacemail mailbox: validates IMAP login and SMTP verify before
// anything is stored. Clerk-only; API keys cannot manage credentials.
export const connect = action({
  args: {
    apiKey: v.optional(v.string()),
    email: v.string(),
    password: v.string(),
    displayName: v.optional(v.string()),
    username: v.optional(v.string()),
    imapHost: v.optional(v.string()),
    imapPort: v.optional(v.number()),
    imapSecure: v.optional(v.boolean()),
    smtpHost: v.optional(v.string()),
    smtpPort: v.optional(v.number()),
    smtpSecure: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<{ accountId: Id<"accounts"> }> => {
    if (args.apiKey) {
      throw new Error("API keys cannot connect accounts");
    }
    const userId = await requireUserId(ctx);
    const email = normalizeEmail(args.email);
    const username = args.username ?? email;

    const dup = await ctx.runQuery(internal.accounts.accountByEmail, {
      userId,
      email,
    });
    if (dup) throw new Error("This mailbox is already connected");

    const imapHost = args.imapHost ?? DEFAULT_IMAP_HOST;
    const imapPort = args.imapPort ?? 993;
    const imapSecure = args.imapSecure ?? imapPort === 993;
    const smtpHost = args.smtpHost ?? DEFAULT_SMTP_HOST;
    const smtpPort = args.smtpPort ?? 465;
    const smtpSecure = args.smtpSecure ?? smtpPort === 465;

    const { capabilities }: { capabilities: AccountCapabilities } =
      await ctx.runAction(internal.node.accountsOps.testConnectionNow, {
        imapHost,
        imapPort,
        imapSecure,
        smtpHost,
        smtpPort,
        smtpSecure,
        username,
        password: args.password,
      });
    const { payload }: { payload: string } = await ctx.runAction(
      internal.node.accountsOps.encrypt,
      { username, password: args.password },
    );
    const sortOrder: number =
      (await ctx.runQuery(internal.accounts.accountSortOrderMax, { userId })) +
      1;
    const accountId = await ctx.runMutation(internal.accounts.insertAccount, {
      userId,
      email,
      displayName: args.displayName ?? email.split("@")[0] ?? email,
      imapHost,
      imapPort,
      imapSecure,
      smtpHost,
      smtpPort,
      smtpSecure,
      username,
      capabilities,
      secretPayload: payload,
      sortOrder,
    });
    await ctx.scheduler.runAfter(0, internal.node.sync.syncAccount, {
      accountId,
    });
    return { accountId };
  },
});

export const updateCredentials = action({
  args: {
    apiKey: v.optional(v.string()),
    accountId: v.id("accounts"),
    password: v.string(),
    username: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    if (args.apiKey) {
      throw new Error("API keys cannot change credentials");
    }
    const userId = await requireUserId(ctx);
    const account = await ctx.runQuery(internal.send.accountForSend, {
      accountId: args.accountId,
      userId,
    });
    if (!account) throw new Error("Account not found");
    const username = args.username ?? account.username;
    const { capabilities }: { capabilities: AccountCapabilities } =
      await ctx.runAction(internal.node.accountsOps.testConnectionNow, {
        imapHost: account.imapHost,
        imapPort: account.imapPort,
        imapSecure: account.imapSecure,
        smtpHost: account.smtpHost,
        smtpPort: account.smtpPort,
        smtpSecure: account.smtpSecure,
        username,
        password: args.password,
      });
    const { payload }: { payload: string } = await ctx.runAction(
      internal.node.accountsOps.encrypt,
      { username, password: args.password },
    );
    await ctx.runMutation(internal.accounts.replaceSecret, {
      accountId: args.accountId,
      userId,
      username,
      secretPayload: payload,
    });
    await ctx.runMutation(internal.syncStore.updateAccountSync, {
      accountId: args.accountId,
      capabilities,
    });
    await ctx.scheduler.runAfter(0, internal.node.sync.syncAccount, {
      accountId: args.accountId,
    });
    return { ok: true };
  },
});

export const update = mutation({
  args: {
    ...apiKeyArg,
    accountId: v.id("accounts"),
    displayName: v.optional(v.string()),
    signatureHtml: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx, args.apiKey);
    const account = await ctx.db.get(args.accountId);
    if (!account || account.userId !== userId) {
      throw new Error("Account not found");
    }
    const patch: Record<string, unknown> = {};
    if (args.displayName !== undefined) patch.displayName = args.displayName;
    if (args.signatureHtml !== undefined) {
      patch.signatureHtml = args.signatureHtml;
    }
    if (args.sortOrder !== undefined) patch.sortOrder = args.sortOrder;
    if (Object.keys(patch).length > 0) await ctx.db.patch(args.accountId, patch);
  },
});

export const testConnection = action({
  args: { ...apiKeyArg, accountId: v.id("accounts") },
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const userId = await requireUserId(ctx, args.apiKey);
    const account = await ctx.runQuery(internal.send.accountForSend, {
      accountId: args.accountId,
      userId,
    });
    if (!account) throw new Error("Account not found");
    await ctx.runAction(internal.node.accountsOps.testSavedConnection, {
      accountId: args.accountId,
    });
    await ctx.runMutation(internal.syncStore.updateAccountSync, {
      accountId: args.accountId,
      lastError: null,
      status: account.status === "auth_error" ? "ready" : undefined,
      nextSyncAfter: null,
    });
    return { ok: true };
  },
});

// Schedules a sync unless one is already running or ran very recently.
export const syncNow = mutation({
  args: { ...apiKeyArg, accountId: v.optional(v.id("accounts")) },
  handler: async (ctx, args): Promise<{ scheduled: number }> => {
    const userId = await requireUserId(ctx, args.apiKey);
    const accounts = args.accountId
      ? [await ctx.db.get(args.accountId)]
      : await ctx.db
          .query("accounts")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect();
    const now = Date.now();
    let scheduled = 0;
    for (const account of accounts) {
      if (!account || account.userId !== userId) continue;
      if (account.status === "auth_error") continue;
      const lock = await ctx.db
        .query("syncLocks")
        .withIndex("by_account", (q) => q.eq("accountId", account._id))
        .first();
      if (lock && lock.leaseUntil > now) continue;
      if (lock?.lastRunAt && now - lock.lastRunAt < 30_000) continue;
      await ctx.scheduler.runAfter(0, internal.node.sync.syncAccount, {
        accountId: account._id,
      });
      scheduled++;
    }
    return { scheduled };
  },
});
