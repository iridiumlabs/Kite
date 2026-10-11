"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import {
  runAccountSync,
  buildIngestArgs,
  type EngineDeps,
} from "../lib/syncEngine";
import { parseUidSet, addUids, formatUidSet } from "../lib/uidset";
import type { ActionCtx } from "../_generated/server";
import { connectImap, FlowPort, accountToImapConfig } from "./imap";
import { MailParserPort } from "./mailParser";
import { makeStorePort } from "./store";
import { decryptCredentials } from "./crypto";
import { classifierOrNull } from "./classify";

const LEASE_TTL_MS = 4 * 60 * 1000;
const BACKOFF_BASE_MS = 60 * 1000;
const BACKOFF_MAX_MS = 30 * 60 * 1000;
const BACKFILL_COUNT = 200;

function isAuthError(err: unknown): boolean {
  const e = err as { authenticationFailed?: boolean; message?: string };
  if (e?.authenticationFailed) return true;
  const msg = String(e?.message ?? "");
  return /AUTHENTICATIONFAILED|invalid credentials|authentication failed/i.test(
    msg,
  );
}

async function openImap(
  ctx: Pick<ActionCtx, "runQuery">,
  accountId: Id<"accounts">,
): Promise<FlowPort | null> {
  const secret = await ctx.runQuery(internal.syncStore.getSecret, {
    accountId,
  });
  const state = await ctx.runQuery(internal.syncStore.getAccountSyncState, {
    accountId,
  });
  if (!secret || !state) return null;
  const { username, password } = decryptCredentials(secret);
  const cfg = accountToImapConfig(state.account);
  const client = await connectImap({ ...cfg, username, password });
  return new FlowPort(client);
}

export function makeEngineDeps(
  ctx: ActionCtx,
  accountId: Id<"accounts">,
  imap: FlowPort,
): EngineDeps {
  return {
    accountId: accountId as string,
    imap,
    store: makeStorePort(ctx, accountId),
    parser: new MailParserPort(),
    classify: classifierOrNull(),
    now: () => Date.now(),
    log: (msg) => console.log(`[sync ${accountId}] ${msg}`),
    pushDraftRemote: async (draftId) => {
      const res = await ctx.runAction(internal.node.draftsOps.pushDraftUnderLease, {
        draftId: draftId as Id<"drafts">,
      });
      return { uid: res.uid };
    },
  };
}

export const syncAccount = internalAction({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, args) => {
    const owner = crypto.randomUUID();
    try {
      await ctx.runMutation(internal.syncStore.acquireLease, {
        accountId: args.accountId,
        owner,
        ttlMs: LEASE_TTL_MS,
      });
    } catch {
      return { skipped: "locked" };
    }

    try {
      const imap = await openImap(ctx, args.accountId);
      if (!imap) return { skipped: "no-account" };
      try {
        const deps = makeEngineDeps(ctx, args.accountId, imap);
        const outcome = await runAccountSync(deps);
        // lastSyncedAt/initialSyncDone are owned by the engine: it writes
        // them only when the run changed something or the timestamp is
        // stale, so an unchanged sync produces zero account writes.
        await ctx.runMutation(internal.syncStore.updateAccountSync, {
          accountId: args.accountId,
          status: "ready",
          lastError: null,
          nextSyncAfter: null,
          syncFailCount: 0,
        });
        return { synced: true, ...outcome };
      } finally {
        await imap.close();
      }
    } catch (err) {
      const failCount =
        ((await ctx.runQuery(internal.syncStore.getAccountSyncState, {
          accountId: args.accountId,
        }))?.account.syncFailCount ?? 0) + 1;
      const delay = Math.min(
        BACKOFF_BASE_MS * Math.pow(2, failCount - 1),
        BACKOFF_MAX_MS,
      );
      const auth = isAuthError(err);
      await ctx.runMutation(internal.syncStore.updateAccountSync, {
        accountId: args.accountId,
        status: auth ? "auth_error" : "error",
        lastError: auth
          ? "Authentication failed. Check the mailbox password."
          : err instanceof Error
            ? err.message.slice(0, 300)
            : "Sync failed",
        syncFailCount: failCount,
        nextSyncAfter: auth ? null : Date.now() + delay,
      });
      return { error: auth ? "auth_error" : "sync_error" };
    } finally {
      await ctx.runMutation(internal.syncStore.releaseLease, {
        accountId: args.accountId,
        owner,
      });
    }
  },
});

const folderRoleV = v.union(
  v.literal("inbox"),
  v.literal("sent"),
  v.literal("drafts"),
  v.literal("archive"),
  v.literal("trash"),
  v.literal("junk"),
);

export const loadOlderInternal = internalAction({
  args: {
    accountId: v.id("accounts"),
    role: v.optional(folderRoleV),
    includeJunk: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const owner = crypto.randomUUID();
    try {
      await ctx.runMutation(internal.syncStore.acquireLease, {
        accountId: args.accountId,
        owner,
        ttlMs: LEASE_TTL_MS,
      });
    } catch {
      return { skipped: "locked" };
    }
    try {
      const snapshot = await ctx.runQuery(internal.syncStore.getAccountSyncState, { accountId: args.accountId });
      if (!snapshot) return { skipped: "no-account" };
      if (!snapshot.folders.some((f) => !f.backfillDone && (!args.role || f.role === args.role || (args.includeJunk && f.role === "junk")))) {
        return { loaded: 0 };
      }
      const imap = await openImap(ctx, args.accountId);
      if (!imap) return { skipped: "no-account" };
      try {
        const deps = makeEngineDeps(ctx, args.accountId, imap);
        const state = await deps.store.getAccountState();
        if (!state) return { skipped: "no-account" };
        const folders = state.folders.filter(
          (f) => !args.role || f.role === args.role || (args.includeJunk && f.role === "junk"),
        );
        const categories = await deps.store.categories();
        let loaded = 0;
        for (const folder of folders) {
          if (folder.backfillDone) continue;
          const oldest = folder.oldestUid;
          if (oldest === undefined || oldest <= 1) {
            await deps.store.patchFolderState(folder._id, {
              backfillDone: true,
            });
            continue;
          }
          const serverUids = await imap.searchUids(folder.path, {
            maxUid: oldest - 1,
          });
          if (serverUids.length === 0) {
            await deps.store.patchFolderState(folder._id, {
              backfillDone: true,
            });
            continue;
          }
          serverUids.sort((a, b) => b - a);
          const batch = serverUids.slice(0, BACKFILL_COUNT).reverse();
          const metas = [];
          for await (const m of imap.fetchMeta(folder.path, batch)) {
            metas.push(m);
          }
          metas.sort((a, b) => a.uid - b.uid);
          const argsList = await buildIngestArgs(
            deps,
            { _id: folder._id, path: folder.path, role: folder.role },
            metas,
            { name: state.account.displayName, addresses: [state.account.email] },
            [state.account.email],
            categories,
          );
          for (let i = 0; i < argsList.length; i += 50) {
            await deps.store.ingestBatch(
              folder._id,
              folder.role,
              argsList.slice(i, i + 50),
              {},
            );
          }
          // Register the backfilled UIDs in syncedUids/flags so flag diffs
          // and vanished detection treat them as known messages.
          const masks = new Map<number, number>();
          {
            let i = 0;
            for (const [a, b] of parseUidSet(folder.syncedUids)) {
              for (let u = a; u <= b; u++) {
                masks.set(u, folder.flags.charCodeAt(i) - 48);
                i++;
              }
            }
          }
          for (const m of metas) {
            masks.set(
              m.uid,
              (m.flags.seen ? 1 : 0) |
                (m.flags.flagged ? 2 : 0) |
                (m.flags.answered ? 4 : 0),
            );
          }
          let syncedRanges = parseUidSet(folder.syncedUids);
          syncedRanges = addUids(
            syncedRanges,
            metas.map((m) => m.uid),
          );
          const ordered: number[] = [];
          for (const [a, b] of syncedRanges) {
            for (let u = a; u <= b; u++) ordered.push(u);
          }
          const reached = serverUids.length <= BACKFILL_COUNT;
          const newOldest = metas.length
            ? Math.min(...metas.map((m) => m.uid), oldest)
            : oldest;
          await deps.store.patchFolderState(folder._id, {
            syncedUids: formatUidSet(syncedRanges),
            flags: ordered.map((u) => String(masks.get(u) ?? 0)).join(""),
            oldestUid: newOldest,
            backfillDone: reached,
          });
          loaded += argsList.length;
        }
        return { loaded };
      } finally {
        await imap.close();
      }
    } finally {
      await ctx.runMutation(internal.syncStore.releaseLease, {
        accountId: args.accountId,
        owner,
      });
    }
  },
});

export const deepSearchInternal = internalAction({
  args: {
    accountId: v.id("accounts"),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 50);
    const owner = crypto.randomUUID();
    try {
      await ctx.runMutation(internal.syncStore.acquireLease, {
        accountId: args.accountId,
        owner,
        ttlMs: LEASE_TTL_MS,
      });
    } catch {
      return { skipped: "locked", messageIds: [] };
    }
    try {
      const imap = await openImap(ctx, args.accountId);
      if (!imap) return { messageIds: [] };
      try {
        const deps = makeEngineDeps(ctx, args.accountId, imap);
        const state = await deps.store.getAccountState();
        if (!state) return { messageIds: [] };
        const categories = await deps.store.categories();
        const found: { folder: (typeof state.folders)[number]; uid: number }[] =
          [];
        const alreadySynced: { folderId: string; uids: number[] }[] = [];
        for (const folder of state.folders) {
          if (found.length >= limit) break;
          const synced = new Set<number>();
          for (const [a, b] of parseUidSet(folder.syncedUids)) {
            for (let u = a; u <= b; u++) synced.add(u);
          }
          let uids: number[] = [];
          try {
            uids = await imap.searchText(folder.path, args.query);
          } catch {
            continue;
          }
          for (const uid of uids.sort((x, y) => y - x)) {
            if (found.length >= limit) break;
            if (synced.has(uid)) {
              alreadySynced.push({ folderId: folder._id, uids: [uid] });
              continue;
            }
            found.push({ folder, uid });
          }
        }
        const messageIds: string[] = [];
        for (const s of alreadySynced) {
          const refs = await deps.store.messagesByUids(s.folderId, s.uids);
          for (const r of refs) messageIds.push(r._id);
        }
        const byFolder = new Map<
          string,
          { folder: (typeof state.folders)[number]; uids: number[] }
        >();
        for (const f of found) {
          const g = byFolder.get(f.folder._id) ?? { folder: f.folder, uids: [] };
          g.uids.push(f.uid);
          byFolder.set(f.folder._id, g);
        }
        for (const { folder, uids } of byFolder.values()) {
          const metas = [];
          for await (const m of imap.fetchMeta(folder.path, uids)) {
            metas.push(m);
          }
          const argsList = await buildIngestArgs(
            deps,
            { _id: folder._id, path: folder.path, role: folder.role },
            metas,
            { name: state.account.displayName, addresses: [state.account.email] },
            [state.account.email],
            categories,
          );
          for (let i = 0; i < argsList.length; i += 50) {
            const res = await deps.store.ingestBatch(
              folder._id,
              folder.role,
              argsList.slice(i, i + 50),
              {},
            );
            for (const r of res as { messageId: string }[]) {
              messageIds.push(r.messageId);
            }
          }
        }
        return { messageIds };
      } finally {
        await imap.close();
      }
    } finally {
      await ctx.runMutation(internal.syncStore.releaseLease, {
        accountId: args.accountId,
        owner,
      });
    }
  },
});
