// @vitest-environment node
import { afterEach, beforeEach, expect, test, vi } from "vitest";
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
afterEach(() => vi.useRealTimers());
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

test("performSend finalizes partial acceptance with only accepted Sent recipients", async () => {
  vi.useFakeTimers();
  h.sendMail.mockResolvedValue({ accepted: ["to@x.com", "cc@x.com"], rejected: ["bcc@x.com"] });
  h.mutation.mockImplementation(async (ref, args) => getFunctionName(ref) === "send:completeSend" ? { messageId: "sent", deduped: false, rejectedRecipients: args.rejectedRecipients } : undefined);
  const ctx = {
    runQuery: vi.fn(async ref => getFunctionName(ref) === "syncStore:getAccountDoc" ? { email: "me@x.com", displayName: "Me" } : {}),
    runMutation: h.mutation,
  } as unknown as ActionCtx;
  const args: FunctionArgs<typeof internal.node.sendOps.performSend> = {
    accountId: "account" as Id<"accounts">, sendLogId: "log" as Id<"sendLog">,
    to: [{ email: "to@x.com" }], cc: [{ email: "cc@x.com" }], bcc: [{ email: "bcc@x.com" }],
    subject: "Partial", text: "Body", messageIdHeader: "partial@x",
  };
  const handler = (performSend as unknown as { handler: (ctx: ActionCtx, input: typeof args) => Promise<unknown> }).handler;
  const pending = handler(ctx, args);
  await vi.waitFor(() => expect(h.sendMail).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(2000);
  expect(await pending).toMatchObject({ rejectedRecipients: ["bcc@x.com"] });
  expect(h.mutation.mock.calls.find(([ref]) => getFunctionName(ref) === "send:completeSend")?.[1]).toMatchObject({ to: args.to, cc: args.cc, bcc: [], rejectedRecipients: ["bcc@x.com"] });
  expect(h.sendMail).toHaveBeenCalledOnce();
});

test("draft sends own forwarded bytes before SMTP so partial retries survive remote cleanup", async () => {
  vi.useFakeTimers();
  const data = new TextEncoder().encode("attachment").buffer;
  const store = vi.fn().mockResolvedValue("stored");
  h.sendMail.mockResolvedValue({ accepted: ["to@x.com"], rejected: ["bcc@x.com"] });
  h.mutation.mockImplementation(async (ref, args) => {
    const name = getFunctionName(ref);
    if (name === "syncStore:materializeDraftAttachments") return { _id: "draft" };
    if (name === "send:completeSend") return { messageId: "sent", deduped: false, rejectedRecipients: args.rejectedRecipients };
  });
  const ctx = {
    runAction: vi.fn().mockResolvedValue(data),
    runQuery: vi.fn(async ref => {
      if (getFunctionName(ref) === "syncStore:getAccountDoc") return { email: "me@x.com", displayName: "Me" };
      if (getFunctionName(ref) === "syncStore:messageRemoteRef") return { message: { attachments: [{ id: "a0", filename: "a.txt", contentType: "text/plain" }] } };
      return {};
    }),
    runMutation: h.mutation, storage: { store, delete: vi.fn() },
  } as unknown as ActionCtx;
  const args: FunctionArgs<typeof internal.node.sendOps.performSend> = {
    accountId: "account" as Id<"accounts">, draftId: "draft" as Id<"drafts">, sendLogId: "log" as Id<"sendLog">,
    to: [{ email: "to@x.com" }], bcc: [{ email: "bcc@x.com" }], subject: "Partial", text: "Body", messageIdHeader: "partial-files@x",
    attachments: [{ messageId: "remote" as Id<"messages">, attachmentId: "a0" }],
  };
  const handler = (performSend as unknown as { handler: (ctx: ActionCtx, input: typeof args) => Promise<unknown> }).handler;
  const pending = handler(ctx, args);
  await vi.waitFor(() => expect(h.sendMail).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(2000); await pending;
  const preserved = h.mutation.mock.calls.find(([ref]) => getFunctionName(ref) === "syncStore:materializeDraftAttachments")![1];
  expect(preserved).toMatchObject({ draftId: "draft", allowSending: true, uploads: [{ messageId: "remote", attachmentId: "a0", storageId: "stored", size: 10 }] });
  expect(store.mock.invocationCallOrder[0]).toBeLessThan(h.sendMail.mock.invocationCallOrder[0]);
});
