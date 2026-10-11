import { afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { v } from "convex/values";
import type { Id } from "../../convex/_generated/dataModel";
import { api, internal } from "../../convex/_generated/api";
import { internalAction } from "../../convex/_generated/server";
import schema from "../../convex/schema";
import { makeMessage, makeT, modules, seedAccount } from "./testUtil";

afterEach(() => vi.useRealTimers());

test("account connection rejects unsupported endpoints before any socket action", async () => {
  const user = makeT().withIdentity({ subject: "a" });
  const args = { email: "me@x.com", password: "test" };
  await expect(user.action(api.accounts.connect, { ...args, imapHost: "127.0.0.1" })).rejects.toThrow("Unsupported mail server");
  await expect(user.action(api.accounts.connect, { ...args, smtpHost: "169.254.169.254" })).rejects.toThrow("Unsupported mail server");
  await expect(user.action(api.accounts.connect, { ...args, imapPort: 80 })).rejects.toThrow("Unsupported mail port");
});

test("recipient suggestions reject foreign accounts, even for an empty prefix", async () => {
  const t = makeT();
  const own = await seedAccount(t, "a");
  const foreign = await seedAccount(t, "b", "b@x.com");
  await t.mutation(internal.ingest.ingest, makeMessage("a", own, { from: { email: "own@x.com" } }));
  await t.mutation(internal.ingest.ingest, makeMessage("b", foreign, { from: { email: "secret@x.com" } }));
  const user = t.withIdentity({ subject: "a" });
  for (const prefix of ["secret", ""]) {
    await expect(user.query(api.mail.suggestRecipients, { accountId: foreign, prefix })).rejects.toThrow("Account not found");
  }
  expect(await user.query(api.mail.suggestRecipients, { accountId: own, prefix: "own" })).toEqual([{ email: "own@x.com" }]);
  expect(await user.query(api.mail.suggestRecipients, { prefix: "secret" })).toEqual([]);
});

test("structured search honors limits and preserves tied-date and cross-role matches", async () => {
  const t = makeT();
  const accountId = await seedAccount(t, "a");
  for (let i = 0; i < 37; i++) {
    await t.mutation(internal.ingest.ingest, makeMessage("a", accountId, {
      date: 100, subject: i % 3 ? "Match" : "Excluded",
      folderRole: i < 25 ? "inbox" : "sent",
    }));
  }
  const user = t.withIdentity({ subject: "a" });
  const ids: string[] = [];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 20; pageNumber++) {
    const page = await user.query(api.mail.findMessages, { accountId, subject: "Match", limit: 4, cursor });
    expect(page.items.length).toBeLessThanOrEqual(4);
    ids.push(...page.items.map(m => m._id));
    if (page.isDone) break;
    expect(page.continueCursor).not.toBeNull();
    cursor = page.continueCursor!;
    if (pageNumber === 19) throw new Error("Pagination did not terminate");
  }
  expect(ids).toHaveLength(24);
  expect(new Set(ids).size).toBe(ids.length);
});

test("structured search advances past a full scan budget of nonmatches", async () => {
  const t = makeT();
  const accountId = await seedAccount(t, "a");
  for (let i = 0; i < 505; i++) {
    await t.mutation(internal.ingest.ingest, makeMessage("a", accountId, { date: 100, subject: i < 5 ? "Match" : "Excluded" }));
  }
  const user = t.withIdentity({ subject: "a" });
  let cursor: string | undefined;
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) {
    const page = await user.query(api.mail.findMessages, { view: "inbox", subject: "Match", limit: 100, cursor });
    expect(page.items.length).toBeLessThanOrEqual(100);
    expect(page.examined).toBeLessThanOrEqual(500);
    ids.push(...page.items.map(m => m._id));
    if (page.isDone) break;
    cursor = page.continueCursor!;
    if (i === 9) throw new Error("Pagination did not terminate");
  }
  expect(ids).toHaveLength(5);
  expect(new Set(ids).size).toBe(5);
}, 15000);

test("post-acceptance failures preserve the reservation and block normal retries", async () => {
  vi.useFakeTimers();
  const performSend = vi.fn();
  const t = convexTest(schema, {
    ...modules,
    "../../convex/node/sendOps.ts": async () => ({
      performSend: internalAction({
        args: v.any(),
        handler: async (ctx, args: { sendLogId: Id<"sendLog">; draftId: Id<"drafts"> }) => {
          performSend();
          await ctx.runMutation(internal.send.markSendUncertain, { sendLogId: args.sendLogId, draftId: args.draftId });
          throw new Error("Local finalization failed after SMTP acceptance");
        },
      }),
    }),
  });
  const accountId = await seedAccount(t, "a");
  const user = t.withIdentity({ subject: "a" });
  const draftId = await user.mutation(api.drafts.create, { accountId, subject: "Test", text: "Body", to: [{ email: "r@x.com" }] });
  await expect(user.action(api.send.sendDraft, { draftId, idempotencyKey: "original" })).rejects.toThrow("Local finalization failed");
  const logs = await t.run(ctx => ctx.db.query("sendLog").collect());
  expect(logs).toHaveLength(1);
  expect(logs[0].status).toBe("uncertain");
  expect((await user.query(api.drafts.get, { draftId }))?.status).toBe("uncertain");
  await expect(user.action(api.send.sendDraft, { draftId, idempotencyKey: "new-key" })).rejects.toThrow("Delivery is uncertain");
  vi.advanceTimersByTime(11 * 60 * 1000);
  await expect(t.mutation(internal.send.beginSend, {
    userId: "a", accountId, contentHash: logs[0].contentHash, messageIdHeader: "retry@x",
  })).rejects.toThrow("Possible duplicate send");
  expect(performSend).toHaveBeenCalledTimes(1);
  // Reconciliation completes the already-delivered message, without another SMTP call.
  await t.mutation(internal.send.completeSend, {
    sendLogId: logs[0]._id, draftId, accountId, messageIdHeader: logs[0].messageIdHeader,
    references: [], subject: "Test", from: { email: "me@x.com" }, to: [{ email: "r@x.com" }],
    cc: [], bcc: [], text: "Body", attachments: [],
  });
  expect((await t.query(internal.send.sendLogEntry, { sendLogId: logs[0]._id }))?.status).toBe("sent");
  expect(await user.query(api.drafts.get, { draftId })).toBeNull();
  expect(performSend).toHaveBeenCalledTimes(1);
});

test("definite SMTP rejections release uncertain reservations, ambiguous errors do not", async () => {
  const t = makeT();
  const accountId = await seedAccount(t, "a");
  const reservation = await t.mutation(internal.send.beginSend, { userId: "a", accountId, contentHash: "hash", messageIdHeader: "m@x" });
  const sendLogId = reservation.sendLogId!;
  await t.mutation(internal.send.markSendUncertain, { sendLogId });
  await t.mutation(internal.send.failSend, { sendLogId, error: "Connection lost" });
  expect((await t.query(internal.send.sendLogEntry, { sendLogId }))?.status).toBe("uncertain");
  await t.mutation(internal.send.failSend, { sendLogId, error: "550 rejected", definiteRejection: true });
  expect((await t.query(internal.send.sendLogEntry, { sendLogId }))?.status).toBe("failed");
  expect((await t.mutation(internal.send.beginSend, { userId: "a", accountId, contentHash: "hash", messageIdHeader: "retry@x" })).sendLogId).toBeDefined();
});
