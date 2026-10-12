// @vitest-environment node
import { afterEach, expect, test, vi } from "vitest";
import { getFunctionName } from "convex/server";
import type { ActionCtx } from "../../convex/_generated/server";
import { internal } from "../../convex/_generated/api";
const h = vi.hoisted(() => ({ connect: vi.fn(), run: vi.fn(), logout: vi.fn() }));
vi.mock("../../convex/_generated/server", () => ({ internalAction: (d: unknown) => d }));
vi.mock("../../convex/node/crypto", () => ({ decryptCredentials: () => ({ username: "u", password: "p" }) }));
vi.mock("../../convex/node/imap", () => ({ connectImap: h.connect, accountToImapConfig: () => ({}), FlowPort: class {} }));
vi.mock("../../convex/node/mailParser", () => ({ MailParserPort: class {} }));
vi.mock("../../convex/lib/syncEngine", () => ({ runPendingOps: h.run }));
import { processOps } from "../../convex/node/ops";

afterEach(() => vi.useRealTimers());

test("connection failure backs off just the broken account and still drains later accounts", async () => {
  h.connect.mockReset().mockRejectedValueOnce(new Error("Expired credentials")).mockResolvedValueOnce({ logout: h.logout });
  h.logout.mockResolvedValue(undefined); h.run.mockResolvedValue(2);
  const mutation = vi.fn(async ref => getFunctionName(ref) === "syncStore:accountsWithDueOps" ? ["bad", "good"] : undefined);
  const ctx = {
    runMutation: mutation,
    runQuery: vi.fn(async ref => getFunctionName(ref) === "syncStore:getSecret" ? {} : { account: {} }),
  } as unknown as ActionCtx;
  const handler = (processOps as unknown as { handler: (ctx: ActionCtx) => Promise<unknown> }).handler;
  expect(await handler(ctx)).toEqual({ processed: 2 });
  expect(mutation).toHaveBeenCalledWith(internal.syncStore.backoffAccountOps, expect.objectContaining({ accountId: "bad", error: "Expired credentials" }));
  expect(mutation).toHaveBeenCalledWith(internal.syncStore.releaseLease, { accountId: "bad", owner: expect.any(String) });
  expect(mutation).toHaveBeenCalledWith(internal.syncStore.releaseLease, { accountId: "good", owner: expect.any(String) });
  expect(h.run).toHaveBeenCalledOnce();
  expect(h.logout).toHaveBeenCalledOnce();
});

test("a long sweep renews throughout remote work and stops its heartbeat before release", async () => {
  vi.useFakeTimers();
  h.connect.mockReset().mockResolvedValue({ logout: h.logout, close: vi.fn() });
  h.logout.mockResolvedValue(undefined);
  h.run.mockReset().mockImplementation(async (deps: { store: { completeOp(id: string): Promise<void> } }) => {
    await new Promise(resolve => setTimeout(resolve, 180000));
    await deps.store.completeOp("op");
    return 1;
  });
  const mutation = vi.fn(async ref => {
    const name = getFunctionName(ref);
    return name === "syncStore:accountsWithDueOps" ? ["account"] : name === "syncStore:renewLease" ? true : undefined;
  });
  const ctx = { runMutation: mutation, runQuery: vi.fn(async ref => getFunctionName(ref) === "syncStore:getSecret" ? {} : { account: {} }) } as unknown as ActionCtx;
  const handler = (processOps as unknown as { handler: (ctx: ActionCtx) => Promise<unknown> }).handler;
  const running = handler(ctx);
  await vi.advanceTimersByTimeAsync(180100);
  expect(await running).toEqual({ processed: 1 });
  const renewals = () => mutation.mock.calls.filter(([ref]) => getFunctionName(ref) === "syncStore:renewLease").length;
  expect(renewals()).toBeGreaterThanOrEqual(5);
  const count = renewals();
  await vi.advanceTimersByTimeAsync(120000);
  expect(renewals()).toBe(count);
  expect(mutation).toHaveBeenCalledWith(internal.syncStore.releaseLease, expect.objectContaining({ accountId: "account" }));
});

test.each(["taken", "unreachable"])("a %s lease aborts remote work without stale queue writes", async reason => {
  vi.useFakeTimers();
  const close = vi.fn();
  h.connect.mockReset().mockResolvedValue({ logout: h.logout, close });
  h.logout.mockResolvedValue(undefined);
  h.run.mockReset().mockImplementation(async (deps: { store: { completeOp(id: string): Promise<void> } }) => {
    await new Promise(resolve => setTimeout(resolve, 60000));
    await deps.store.completeOp("op");
    return 1;
  });
  const mutation = vi.fn(async ref => {
    const name = getFunctionName(ref);
    if (name === "syncStore:accountsWithDueOps") return ["account"];
    if (name === "syncStore:renewLease") {
      if (reason === "unreachable") throw new Error("backend offline");
      return false;
    }
  });
  const ctx = { runMutation: mutation, runQuery: vi.fn(async ref => getFunctionName(ref) === "syncStore:getSecret" ? {} : { account: {} }) } as unknown as ActionCtx;
  const handler = (processOps as unknown as { handler: (ctx: ActionCtx) => Promise<unknown> }).handler;
  const running = handler(ctx);
  await vi.advanceTimersByTimeAsync(60100);
  expect(await running).toEqual({ processed: 0 });
  expect(close).toHaveBeenCalledOnce();
  const calls = mutation.mock.calls.map(([ref]) => getFunctionName(ref));
  expect(calls).not.toContain("syncStore:completeOp");
  expect(calls).not.toContain("syncStore:backoffAccountOps");
  expect(calls).toContain("syncStore:releaseLease");
});
