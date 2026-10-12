// @vitest-environment node
import { expect, test, vi } from "vitest";
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
