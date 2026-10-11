// @vitest-environment node
import { beforeEach, expect, test, vi } from "vitest";
import { getFunctionName, type FunctionArgs } from "convex/server";
import type { ActionCtx } from "../../convex/_generated/server";
import { internal } from "../../convex/_generated/api";
import { performSend } from "../../convex/node/sendOps";
import type { Id } from "../../convex/_generated/dataModel";

const h = vi.hoisted(() => ({ sendMail: vi.fn(), close: vi.fn(), mutation: vi.fn() }));
vi.mock("../../convex/_generated/server", () => ({ internalAction: (definition: unknown) => definition }));
vi.mock("../../convex/node/accountsOps", () => ({ smtpTransport: () => ({ sendMail: h.sendMail, close: h.close }) }));
vi.mock("../../convex/node/crypto", () => ({ decryptCredentials: () => ({ username: "me@x.com", password: "secret" }) }));
vi.mock("../../convex/node/imap", () => ({ connectImap: vi.fn(), FlowPort: vi.fn(), accountToImapConfig: vi.fn() }));

beforeEach(() => { h.sendMail.mockReset(); h.close.mockReset(); h.mutation.mockReset().mockResolvedValue(undefined); });
test.each([
  [{ code: "ESOCKET", command: "CONN", syscall: "connect" }, true],
  [{ code: "ETIMEDOUT", command: "CONN", message: "Connection timeout" }, true],
  [{ code: "ECONNECTION", command: "CONN", message: "Connection closed unexpectedly" }, false],
  [{ code: "ETIMEDOUT", command: "CONN", message: "Socket timeout" }, false],
] as const)("performSend releases only proven non-delivery: %j", async (error, definite) => {
  h.sendMail.mockRejectedValue(Object.assign(new Error("SMTP failure"), error));
  const ctx = {
    runQuery: vi.fn(async ref => getFunctionName(ref) === "syncStore:getAccountDoc"
      ? { email: "me@x.com", displayName: "Me" } : {}),
    runMutation: h.mutation,
  } as unknown as ActionCtx;
  const args: FunctionArgs<typeof internal.node.sendOps.performSend> = {
    accountId: "account" as Id<"accounts">, sendLogId: "log" as Id<"sendLog">, draftId: "draft" as Id<"drafts">,
    to: [{ email: "to@x.com" }], subject: "Hello", text: "Message", messageIdHeader: "m@x.com",
  };
  const handler = (performSend as unknown as { handler: (ctx: ActionCtx, input: FunctionArgs<typeof internal.node.sendOps.performSend>) => Promise<unknown> }).handler;
  await expect(handler(ctx, args)).rejects.toThrow();
  expect(h.mutation).toHaveBeenCalledWith(internal.send.markSendUncertain, { sendLogId: args.sendLogId, draftId: args.draftId });
  const calls = h.mutation.mock.calls.filter(([ref]) => getFunctionName(ref) === "send:failSend");
  expect(calls).toHaveLength(definite ? 1 : 0);
  if (definite) expect(calls[0][1]).toMatchObject({ definiteRejection: true, draftId: args.draftId });
  expect(h.close).toHaveBeenCalledOnce();
});
