"use node";

import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";

export class LeaseLostError extends Error {
  constructor() { super("Account lease was lost or could not be renewed"); }
}

// Renew independently of slow IMAP calls. Never overlap renewals, revive an
// expired local lease, or leave a renewal running after the owner releases it.
export function startLeaseHeartbeat(
  ctx: Pick<ActionCtx, "runMutation">,
  lease: { accountId: Id<"accounts">; owner: string; ttlMs: number; startedAt?: number },
) {
  let expiresAt = (lease.startedAt ?? Date.now()) + lease.ttlMs;
  let lost = false;
  let stopped = false;
  let pending: Promise<void> | undefined;
  const aborts = new Set<() => void>();
  const lose = () => {
    if (lost) return;
    lost = true;
    for (const abort of aborts) {
      try { abort(); } catch { /* Already disconnected. */ }
    }
  };
  const assertHeld = () => {
    if (Date.now() >= expiresAt) lose();
    if (lost) throw new LeaseLostError();
  };
  const timer = setInterval(() => {
    if (stopped || lost) return;
    const startedAt = Date.now();
    if (startedAt >= expiresAt) { lose(); return; }
    if (pending) return;
    pending = (async () => {
      try {
        const renewed = await ctx.runMutation(internal.syncStore.renewLease, {
          accountId: lease.accountId, owner: lease.owner, ttlMs: lease.ttlMs,
        });
        if (renewed === false) lose();
        else if (!lost) expiresAt = startedAt + lease.ttlMs;
      } catch { lose(); }
    })().finally(() => { pending = undefined; });
  }, Math.min(30_000, lease.ttlMs / 3));

  return {
    assertHeld,
    onLost(abort: () => void) {
      aborts.add(abort);
      if (lost) { try { abort(); } catch { /* Already disconnected. */ } }
    },
    // Action RPCs and StorePort methods are promise-returning. Guard both
    // sides so a lost lease stops subsequent queue/folder bookkeeping too.
    guard<T extends object>(target: T): T {
      return new Proxy(target, { get(object, key) {
        const value = Reflect.get(object, key);
        if (typeof value !== "function") return value;
        return (...args: unknown[]) => {
          assertHeld();
          return Promise.resolve(value.apply(object, args)).then(
            result => { assertHeld(); return result; },
            error => { assertHeld(); throw error; },
          );
        };
      } });
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await pending;
    },
  };
}
