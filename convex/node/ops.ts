"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { runPendingOps } from "../lib/syncEngine";
import { connectImap, FlowPort, accountToImapConfig } from "./imap";
import { MailParserPort } from "./mailParser";
import { makeStorePort } from "./store";
import { decryptCredentials } from "./crypto";

const LEASE_TTL_MS = 2 * 60 * 1000;

// Sweeper for due pendingOps. Runs under the same account lease as sync so
// remote mutations never race.
export const processOps = internalAction({
  args: {},
  handler: async (ctx) => {
    const accountIds = await ctx.runMutation(
      internal.syncStore.accountsWithDueOps,
      { now: Date.now() },
    );
    let processed = 0;
    for (const accountId of accountIds as Id<"accounts">[]) {
      const owner = crypto.randomUUID();
      try {
        await ctx.runMutation(internal.syncStore.acquireLease, {
          accountId,
          owner,
          ttlMs: LEASE_TTL_MS,
        });
      } catch {
        continue;
      }
      try {
        const secret = await ctx.runQuery(internal.syncStore.getSecret, {
          accountId,
        });
        const state = await ctx.runQuery(
          internal.syncStore.getAccountSyncState,
          { accountId },
        );
        if (!secret || !state) throw new Error("Account credentials are unavailable");
        const { username, password } = decryptCredentials(secret);
        const cfg = accountToImapConfig(state.account);
        const client = await connectImap({ ...cfg, username, password });
        try {
          await ctx.runMutation(internal.syncStore.clearOpsBackoff, { accountId });
          const imap = new FlowPort(client);
          const deps = {
            accountId: accountId as string,
            imap,
            store: makeStorePort(ctx, accountId),
            parser: new MailParserPort(),
            classify: null,
            now: () => Date.now(),
            log: (msg: string) => console.log(`[ops ${accountId}] ${msg}`),
            pushDraftRemote: async (draftId: string) => {
              const res = await ctx.runAction(
                internal.node.draftsOps.pushDraftNow,
                { draftId: draftId as Id<"drafts"> },
              );
              return { uid: res.uid };
            },
          };
          processed += await runPendingOps(deps);
        } finally {
          await client.logout().catch(() => client.close());
        }
      } catch (error) {
        // A bad connection must not abort the sweep or consume each message's
        // retry budget. Account-level backoff also removes it from discovery.
        await ctx.runMutation(internal.syncStore.backoffAccountOps, {
          accountId, now: Date.now(),
          error: error instanceof Error ? error.message : "IMAP connection failed",
        }).catch(err => console.error(`[ops ${accountId}] could not persist backoff`, err));
      } finally {
        await ctx.runMutation(internal.syncStore.releaseLease, {
          accountId,
          owner,
        }).catch(err => console.error(`[ops ${accountId}] could not release lease`, err));
      }
    }
    return { processed };
  },
});
