import { afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { v } from "convex/values";
import { api, internal } from "../../convex/_generated/api";
import { internalAction } from "../../convex/_generated/server";
import schema from "../../convex/schema";
import { makeMessage, makeT, modules, seedAccount, seedFolder } from "./testUtil";

afterEach(() => vi.useRealTimers());
const noop = internalAction({ args: v.any(), handler: async () => undefined });

test.each([true, false])("known partial sends recover after action termination (draft=%s)", async hasDraft => {
  vi.useFakeTimers();
  const t = convexTest(schema, { ...modules,
    "../../convex/node/draftsOps.ts": async () => ({ pushDraftNow: noop }),
    "../../convex/node/sendOps.ts": async () => ({ retrySentAppend: noop }),
    "../../convex/node/ops.ts": async () => ({ processOps: noop }),
  });
  const accountId = await seedAccount(t, "a"); const user = t.withIdentity({ subject: "a" });
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(["attachment"])));
  const sourceStorageId = await t.run(ctx => ctx.storage.store(new Blob(["private MIME"])));
  const draftId = hasDraft ? await user.mutation(api.drafts.create, {
    accountId, to: [{ email: "ok@x.com" }], bcc: [{ email: "rejected@x.com" }],
    text: "Body", subject: "Partial", attachments: [{ kind: "upload", storageId, filename: "a.txt", contentType: "text/plain", size: 10 }],
  }) : undefined;
  const begin = await t.mutation(internal.send.beginSend, { accountId, userId: "a", draftId, contentHash: "partial", messageIdHeader: "partial@x" });
  const sendLogId = begin.sendLogId!;
  const recovery = { sendLogId, accountId, draftId, sourceStorageId, messageIdHeader: "partial@x", references: [], subject: "Partial", from: { email: "me@x" }, to: [{ email: "ok@x.com" }], cc: [], bcc: [{ email: "rejected@x.com" }], text: "Body", attachments: [] };
  await t.mutation(internal.send.markSendUncertain, { sendLogId, draftId, recovery });
  await t.mutation(internal.send.finishSmtpAttempt, { sendLogId, accepted: true, rejectedRecipients: ["rejected@x.com"] });
  // The action disappears here, with no completeSend call and no error write.
  await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
  await t.finishInProgressScheduledFunctions();
  const log = await t.query(internal.send.sendLogEntry, { sendLogId });
  expect(log).toMatchObject({ status: "sent", rejectedRecipients: ["rejected@x.com"] });
  expect(log!.recovery).toBeUndefined();
  const sent = await t.run(ctx => ctx.db.get(log!.messageId!));
  expect(sent).toMatchObject({ to: recovery.to, bcc: [], sourceStorageId, deliveryRecipientsRecorded: true });
  if (draftId) {
    expect(await user.query(api.drafts.get, { draftId })).toMatchObject({ status: "failed", to: [], bcc: recovery.bcc, text: "Body" });
    expect(await t.run(async ctx => (await ctx.storage.get(storageId))!.text())).toBe("attachment");
  }
  await t.mutation(internal.send.recoverAcceptedSend, { sendLogId });
  expect(await t.run(ctx => ctx.db.query("messages").collect())).toHaveLength(1);
});

test("recovery never assumes SMTP acceptance from a reservation alone", async () => {
  vi.useFakeTimers();
  const t = makeT(); const accountId = await seedAccount(t, "a");
  const begin = await t.mutation(internal.send.beginSend, { accountId, userId: "a", contentHash: "unknown", messageIdHeader: "unknown@x" });
  const sendLogId = begin.sendLogId!;
  await t.mutation(internal.send.markSendUncertain, { sendLogId, recovery: { sendLogId, accountId, messageIdHeader: "unknown@x", references: [], subject: "", from: { email: "me@x" }, to: [{ email: "to@x" }], cc: [], bcc: [], text: "", attachments: [] } });
  await t.mutation(internal.send.recoverAcceptedSend, { sendLogId });
  expect(await t.query(internal.send.sendLogEntry, { sendLogId })).toMatchObject({ status: "uncertain" });
  expect(await t.run(ctx => ctx.db.query("messages").collect())).toEqual([]);
});

test("Sent placeholder upgrades preserve accepted recipients despite original MIME headers", async () => {
  const t = makeT(); const accountId = await seedAccount(t, "a");
  const begin = await t.mutation(internal.send.beginSend, { accountId, userId: "a", contentHash: "partial", messageIdHeader: "partial@x" });
  const sent = await t.mutation(internal.send.completeSend, { sendLogId: begin.sendLogId!, accountId, messageIdHeader: "partial@x", references: [], subject: "Partial", from: { email: "me@x" }, to: [{ email: "ok@x" }], cc: [], bcc: [], rejectedRecipients: ["rejected@x"], text: "Body", attachments: [] });
  const folderId = await seedFolder(t, "a", accountId, "sent", "Sent");
  const upgraded = await t.mutation(internal.ingest.ingest, makeMessage("a", accountId, {
    folderId, folderRole: "sent", uid: 77, messageIdHeader: "partial@x",
    to: [{ email: "ok@x" }, { email: "rejected@x" }], cc: [{ email: "rejected@x" }], bcc: [{ email: "rejected@x" }], isOutbound: true,
  }));
  expect(upgraded.messageId).toBe(sent.messageId);
  expect(await t.run(ctx => ctx.db.get(sent.messageId!))).toMatchObject({ uid: 77, to: [{ email: "ok@x" }], cc: [], bcc: [] });
});

test("partial finalization reuses a Sent copy ingested before completion", async () => {
  const t = makeT(); const accountId = await seedAccount(t, "a");
  const folderId = await seedFolder(t, "a", accountId, "sent", "Sent");
  const synced = await t.mutation(internal.ingest.ingest, makeMessage("a", accountId, {
    folderId, folderRole: "sent", uid: 5, messageIdHeader: "racing-sent@x", isOutbound: true,
    to: [{ email: "ok@x" }, { email: "rejected@x" }],
  }));
  const begin = await t.mutation(internal.send.beginSend, { accountId, userId: "a", contentHash: "partial", messageIdHeader: "racing-sent@x" });
  const result = await t.mutation(internal.send.completeSend, {
    sendLogId: begin.sendLogId!, accountId, messageIdHeader: "racing-sent@x", references: [],
    subject: "", from: { email: "me@x" }, to: [{ email: "ok@x" }], cc: [], bcc: [],
    text: "", attachments: [], rejectedRecipients: ["rejected@x"],
  });
  expect(result.messageId).toBe(synced.messageId);
  expect(await t.run(ctx => ctx.db.query("messages").collect())).toHaveLength(1);
  expect(await t.run(ctx => ctx.db.get(result.messageId!))).toMatchObject({ to: [{ email: "ok@x" }], deliveryRecipientsRecorded: true });
});

test("storage attachment hashes use measured bytes, including untrusted size overrides", async () => {
  const perform = vi.fn();
  const t = convexTest(schema, { ...modules, "../../convex/node/sendOps.ts": async () => ({
    performSend: internalAction({ args: v.any(), handler: async (_ctx, args) => { perform(args); return { deduped: false }; } }),
  }) });
  const accountId = await seedAccount(t, "a"); const user = t.withIdentity({ subject: "a" });
  const small = await t.run(ctx => ctx.storage.store(new Blob(["a"])));
  const large = await t.run(ctx => ctx.storage.store(new Blob(["longer"])));
  const send = (storageId: typeof small, size: number) => user.action(api.send.sendMessage, {
    accountId, to: [{ email: "to@x" }], subject: "Same body", attachments: [{ storageId, filename: "same.txt", contentType: "text/plain", size }],
  });
  await send(small, 0); await send(large, 0);
  expect(perform).toHaveBeenCalledTimes(2);
  await expect(send(large, 999)).rejects.toThrow("duplicate");
  expect(perform.mock.calls[0][0].attachments[0].size).toBeUndefined();
});
