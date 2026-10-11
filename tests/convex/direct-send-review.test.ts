import { afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { v } from "convex/values";
import { api, internal } from "../../convex/_generated/api";
import { internalAction } from "../../convex/_generated/server";
import schema from "../../convex/schema";
import { makeT, modules, seedAccount } from "./testUtil";
import { UNCERTAIN_STALE_MS } from "../../convex/lib/uncertainSend";

afterEach(() => vi.useRealTimers());
test.each(["delivered", "notDelivered"] as const)("draftless uncertain sends can be settled as %s without sending", async outcome => {
  const t = makeT(); const accountId = await seedAccount(t, "a");
  const user = t.withIdentity({ subject: "a" }); const other = t.withIdentity({ subject: "b" });
  const begin = await t.mutation(internal.send.beginSend, { accountId, userId: "a", contentHash: "direct", messageIdHeader: "direct@x", idempotencyKey: "old" });
  const sendLogId = begin.sendLogId!;
  await t.mutation(internal.send.markSendUncertain, { sendLogId });
  const args = { sendLogId, outcome, confirmed: true as const };
  await expect(user.mutation(api.send.resolveUncertainSend, args)).rejects.toThrow("still active");
  await expect(other.query(api.send.uncertainAccountAttempts, { accountId })).rejects.toThrow("Account not found");
  await expect(other.mutation(api.send.resolveUncertainSend, args)).rejects.toThrow("Send attempt not found");
  await expect(user.mutation(api.send.resolveUncertainSend, { ...args, confirmed: false as never })).rejects.toThrow();
  await t.mutation(internal.send.finishSmtpAttempt, { sendLogId, accepted: false });
  await t.mutation(internal.send.failSend, { sendLogId, error: "Socket lost" });
  expect(await user.query(api.send.uncertainAccountAttempts, { accountId })).toMatchObject([{ sendLogId, canConfirmNotDelivered: true }]);
  await user.mutation(api.send.resolveUncertainSend, args);
  expect(await user.query(api.send.uncertainAccountAttempts, { accountId })).toEqual([]);
  expect(await t.query(internal.send.sendLogEntry, { sendLogId })).toMatchObject({ resolution: outcome, status: outcome === "delivered" ? "sent" : "failed" });
  const retry = () => t.mutation(internal.send.beginSend, { accountId, userId: "a", contentHash: "direct", messageIdHeader: "new@x", idempotencyKey: "new" });
  if (outcome === "delivered") await expect(retry()).rejects.toThrow("duplicate");
  else expect((await retry()).sendLogId).toBeDefined();
  expect(await t.run(ctx => ctx.db.query("messages").collect())).toEqual([]);
});

test("direct resolution obeys known acceptance and crashed-attempt deadlines", async () => {
  vi.useFakeTimers();
  const t = makeT(); const accountId = await seedAccount(t, "a"); const user = t.withIdentity({ subject: "a" });
  const begin = await t.mutation(internal.send.beginSend, { accountId, userId: "a", contentHash: "hash", messageIdHeader: "x" });
  const sendLogId = begin.sendLogId!;
  await t.mutation(internal.send.markSendUncertain, { sendLogId });
  vi.setSystemTime(Date.now() + UNCERTAIN_STALE_MS + 1);
  expect(await user.query(api.send.uncertainAccountAttempts, { accountId })).toMatchObject([{ canConfirmNotDelivered: true }]);
  await t.mutation(internal.send.finishSmtpAttempt, { sendLogId, accepted: true });
  await expect(user.mutation(api.send.resolveUncertainSend, { sendLogId, outcome: "notDelivered", confirmed: true })).rejects.toThrow("known delivery");
});

test("4 MiB direct inline attachments reach Node as storage references, not large arguments", async () => {
  vi.useFakeTimers();
  const perform = vi.fn();
  const t = convexTest(schema, { ...modules, "../../convex/node/sendOps.ts": async () => ({
    performSend: internalAction({ args: v.any(), handler: async (ctx, args) => {
      perform(args);
      const blob = await ctx.storage.get(args.attachments[0].storageId);
      expect(blob!.size).toBe(4 * 1024 * 1024);
      return { deduped: false };
    } }),
  }) });
  const accountId = await seedAccount(t, "a");
  await t.withIdentity({ subject: "a" }).action(api.send.sendMessage, {
    accountId, to: [{ email: "to@x.com" }], subject: "File",
    attachments: [{ filename: "large.bin", contentType: "application/octet-stream", contentBase64: btoa("x".repeat(4 * 1024 * 1024)) }],
  });
  expect(JSON.stringify(perform.mock.calls[0][0]).length).toBeLessThan(2000);
  expect(perform.mock.calls[0][0].attachments[0].contentBase64).toBeUndefined();
});
