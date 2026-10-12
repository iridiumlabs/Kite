// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import type { ActionCtx } from "../../convex/_generated/server";
import type { Id } from "../../convex/_generated/dataModel";
import { LeaseLostError, startLeaseHeartbeat } from "../../convex/node/lease";

afterEach(() => vi.useRealTimers());

const args = { accountId: "account" as Id<"accounts">, owner: "owner", ttlMs: 120000 };

test("renewals never overlap and shutdown waits for the last renewal", async () => {
  vi.useFakeTimers();
  let resolve!: (value: boolean) => void;
  const mutation = vi.fn(() => new Promise<boolean>(r => { resolve = r; }));
  const lease = startLeaseHeartbeat({ runMutation: mutation } as unknown as ActionCtx, args);
  await vi.advanceTimersByTimeAsync(90000);
  expect(mutation).toHaveBeenCalledOnce();
  let stopped = false;
  const stopping = lease.stop().then(() => { stopped = true; });
  await Promise.resolve(); expect(stopped).toBe(false);
  resolve(true); await stopping;
  await vi.advanceTimersByTimeAsync(120000);
  expect(mutation).toHaveBeenCalledOnce();
});

test("a stalled renewal closes the connection when the conservative TTL expires", async () => {
  vi.useFakeTimers();
  let resolve!: (value: boolean) => void;
  const lease = startLeaseHeartbeat({ runMutation: vi.fn(() => new Promise<boolean>(r => { resolve = r; })) } as unknown as ActionCtx, args);
  const abort = vi.fn(); lease.onLost(abort);
  await vi.advanceTimersByTimeAsync(120000);
  expect(abort).toHaveBeenCalledOnce();
  expect(() => lease.assertHeld()).toThrow(LeaseLostError);
  resolve(true); await lease.stop();
});

test("expiry is checked before RPCs even if the heartbeat timer has not run", async () => {
  vi.useFakeTimers();
  const lease = startLeaseHeartbeat({ runMutation: vi.fn() } as unknown as ActionCtx, { ...args, startedAt: Date.now() - args.ttlMs });
  const method = vi.fn();
  expect(() => lease.guard({ method }).method()).toThrow(LeaseLostError);
  expect(method).not.toHaveBeenCalled();
  await lease.stop();
});
