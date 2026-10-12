"use node";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import { runPendingOps } from "../lib/syncEngine";
import { connectImap, FlowPort, accountToImapConfig } from "./imap";
import { MailParserPort } from "./mailParser";
import { makeStorePort } from "./store";
import { decryptCredentials } from "./crypto";
import { LeaseLostError, startLeaseHeartbeat } from "./lease";

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
      const startedAt = Date.now();
      try {
        await ctx.runMutation(internal.syncStore.acquireLease, {
          accountId,
          owner,
          ttlMs: LEASE_TTL_MS,
        });
      } catch {
        continue;
      }
      const lease = startLeaseHeartbeat(ctx, { accountId, owner, ttlMs: LEASE_TTL_MS, startedAt });
      const leasedCtx = lease.guard(ctx);
      try {
        const secret = await leasedCtx.runQuery(internal.syncStore.getSecret, {
          accountId,
        });
        const state = await leasedCtx.runQuery(
          internal.syncStore.getAccountSyncState,
          { accountId },
        );
        if (!secret || !state) throw new Error("Account credentials are unavailable");
        const { username, password } = decryptCredentials(secret);
        const cfg = accountToImapConfig(state.account);
        const client = await connectImap({ ...cfg, username, password });
        lease.onLost(() => client.close());
        try {
          lease.assertHeld();
          await leasedCtx.runMutation(internal.syncStore.clearOpsBackoff, { accountId });
          const imap = new FlowPort(client);
          const deps = {
            accountId: accountId as string,
            imap,
            store: makeStorePort(leasedCtx, accountId),
            parser: new MailParserPort(),
            classify: null,
            now: () => Date.now(),
            log: (msg: string) => console.log(`[ops ${accountId}] ${msg}`),
            pushDraftRemote: async (draftId: string) => {
              const res = await leasedCtx.runAction(
                internal.node.draftsOps.pushDraftUnderLease,
                { draftId: draftId as Id<"drafts">, leaseOwner: owner, leaseTtlMs: LEASE_TTL_MS },
              );
              return { uid: res.uid };
            },
          };
          const count = await runPendingOps(deps);
          lease.assertHeld();
          processed += count;
        } finally {
          await client.logout().catch(() => client.close());
        }
      } catch (error) {
        // A bad connection must not abort the sweep or consume each message's
        // retry budget. Account-level backoff also removes it from discovery.
        if (!(error instanceof LeaseLostError)) await ctx.runMutation(internal.syncStore.backoffAccountOps, {
          accountId, now: Date.now(),
          error: error instanceof Error ? error.message : "IMAP connection failed",
        }).catch(err => console.error(`[ops ${accountId}] could not persist backoff`, err));
      } finally {
        await lease.stop();
        await ctx.runMutation(internal.syncStore.releaseLease, {
          accountId,
          owner,
        }).catch(err => console.error(`[ops ${accountId}] could not release lease`, err));
      }
    }
    return { processed };
  },
});
