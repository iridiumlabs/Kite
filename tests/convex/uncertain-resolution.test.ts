import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { makeT, seedAccount, seedFolder } from "./testUtil";
import { UNCERTAIN_STALE_MS } from "../../convex/lib/uncertainSend";

afterEach(() => vi.useRealTimers());
async function setup(finished = true) {
  vi.useFakeTimers();
  const t = makeT(); const accountId = await seedAccount(t, "a");
  const user = t.withIdentity({ subject: "a" });
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(["bytes"])));
  const draftId = await user.mutation(api.drafts.create, { accountId, to: [{ email: "to@x.com" }], subject: "Ambiguous", text: "Body", attachments: [{ kind: "upload", storageId, filename: "a.txt", contentType: "text/plain", size: 5 }] });
  const folderId = await seedFolder(t, "a", accountId, "drafts", "Drafts");
  await t.run(ctx => ctx.db.patch(draftId, { remoteFolderId: folderId, remoteUid: 1 }));
  const claim = await t.mutation(internal.send.claimDraftForSend, { draftId, userId: "a" });
  const r = await t.mutation(internal.send.beginSend, { draftId, draftClaimId: claim!.sendClaimId, accountId, userId: "a", contentHash: "hash", messageIdHeader: "sent@x", idempotencyKey: "original" });
  const sendLogId = r.sendLogId!;
  await t.mutation(internal.send.markSendUncertain, { draftId, sendLogId });
  if (finished) {
    await t.mutation(internal.send.finishSmtpAttempt, { sendLogId, accepted: false });
    await t.mutation(internal.send.failSend, { sendLogId, draftId, error: "Socket timeout" });
  }
  const resolution = { draftId, sendLogId, outcome: "notDelivered" as const, confirmed: true as const };
  const completion = { sendLogId, draftId, accountId, messageIdHeader: "sent@x", references: [], subject: "Ambiguous", from: { email: "me@x.com" }, to: [{ email: "to@x.com" }], cc: [], bcc: [], text: "Body", attachments: [] };
  return { t, user, accountId, draftId, sendLogId, storageId, resolution, completion };
}

test("ordinary edits, deletion, and retries stay blocked until an explicit owner confirmation", async () => {
  const { t, user, draftId, accountId, resolution } = await setup();
  await expect(user.mutation(api.drafts.update, { draftId, text: "edited" })).rejects.toThrow("Delivery is uncertain");
  await expect(user.mutation(api.drafts.discard, { draftId })).rejects.toThrow("Delivery is uncertain");
  await expect(user.mutation(api.drafts.cancelScheduledSend, { draftId })).rejects.toThrow("Delivery is uncertain");
  await expect(user.action(api.send.sendDraft, { draftId })).rejects.toThrow("Delivery is uncertain");
  await expect(user.action(api.send.sendMessage, { draftId, accountId, to: [{ email: "to@x.com" }], subject: "Changed", allowDuplicate: true })).rejects.toThrow("Resolve the uncertain");
  await expect(user.mutation(api.send.resolveUncertainDraft, { ...resolution, confirmed: false as never })).rejects.toThrow();
  await expect(t.withIdentity({ subject: "b" }).mutation(api.send.resolveUncertainDraft, resolution)).rejects.toThrow("Draft not found");
  await expect(t.withIdentity({ subject: "b" }).query(api.send.uncertainDraftAttempts, { draftId })).rejects.toThrow("Draft not found");
  expect((await user.query(api.drafts.get, { draftId }))!.status).toBe("uncertain");
});

test("confirmed non-delivery settles the reservation and unlocks the intact draft, never sending automatically", async () => {
  const { t, user, accountId, draftId, sendLogId, storageId, resolution, completion } = await setup();
  const before = (await user.query(api.drafts.get, { draftId }))!;
  expect(await user.query(api.send.uncertainDraftAttempts, { draftId })).toMatchObject([{ sendLogId, canConfirmDelivered: true, canConfirmNotDelivered: true }]);
  await user.mutation(api.send.resolveUncertainDraft, resolution);
  expect(await t.query(internal.send.sendLogEntry, { sendLogId })).toMatchObject({ status: "failed", resolution: "notDelivered" });
  const retained = (await user.query(api.drafts.get, { draftId }))!;
  expect(retained).toMatchObject({ status: "editing", text: "Body", attachments: before.attachments });
  expect(retained.messageIdHeader).not.toBe(before.messageIdHeader);
  expect(retained.sendError).toBeUndefined(); expect(retained.sendLogId).toBeUndefined();
  await expect(user.mutation(api.drafts.update, { draftId, expectedDeliveryVersion: 0, text: "stale autosave" })).rejects.toThrow("Draft delivery changed");
  expect(await t.run(async ctx => (await ctx.storage.get(storageId))!.text())).toBe("bytes");
  const claim = await t.mutation(internal.send.claimDraftForSend, { draftId, userId: "a" });
  // A stale pre-reservation failure cannot unlock a newly claimed attempt.
  await t.mutation(internal.send.failClaimedDraft, { draftId, claimId: before.sendClaimId!, error: "late claim failure" });
  expect((await user.query(api.drafts.get, { draftId }))!.status).toBe("sending");
  const retry = await t.mutation(internal.send.beginSend, { draftId, draftClaimId: claim!.sendClaimId, accountId, userId: "a", contentHash: "hash", messageIdHeader: "retry@x", idempotencyKey: "new" });
  expect(retry.sendLogId).not.toBe(sendLogId);
  // Old callbacks cannot fail or delete a new attempt's draft.
  await t.mutation(internal.send.failSend, { sendLogId, draftId, error: "late error" });
  await expect(t.mutation(internal.send.completeSend, completion)).rejects.toThrow("resolved as not delivered");
  expect(await user.query(api.drafts.get, { draftId })).toMatchObject({ status: "sending", sendLogId: retry.sendLogId });
});

test("confirmed delivery removes the stale draft and files, settles the log, and ignores late completion", async () => {
  const { t, user, accountId, draftId, sendLogId, storageId, resolution, completion } = await setup();
  await user.mutation(api.send.resolveUncertainDraft, { ...resolution, outcome: "delivered" });
  expect(await user.query(api.drafts.get, { draftId })).toBeNull();
  expect(await t.query(internal.send.sendLogEntry, { sendLogId })).toMatchObject({ status: "sent", resolution: "delivered" });
  expect(await t.run(async ctx => (await ctx.storage.get(storageId)) !== null)).toBe(false);
  const counter = await t.run(ctx => ctx.db.query("counters").withIndex("by_user_key", q => q.eq("userId", "a").eq("key", "drafts")).first());
  expect(counter!.count).toBe(0);
  expect(await t.run(ctx => ctx.db.query("pendingOps").collect())).toMatchObject([{ kind: "deleteRemoteDraft" }]);
  expect(await t.mutation(internal.send.completeSend, completion)).toMatchObject({ deduped: true });
  expect(await t.run(ctx => ctx.db.query("messages").collect())).toHaveLength(0);
  expect(await user.action(api.send.sendMessage, { accountId, to: completion.to, subject: "Ambiguous", text: "Body", idempotencyKey: "original" })).toMatchObject({ deduped: true });
});

test("active attempts cannot be resolved, while crashed reservations become recoverable after the action deadline", async () => {
  const { t, user, draftId, sendLogId, resolution } = await setup(false);
  // Queue/preflight delays do not age out a newly started SMTP attempt.
  await t.run(ctx => ctx.db.patch(sendLogId, { createdAt: Date.now() - 2 * UNCERTAIN_STALE_MS }));
  expect(await user.query(api.send.uncertainDraftAttempts, { draftId, refreshAt: Date.now() + 9999999 })).toMatchObject([{ canConfirmDelivered: false, canConfirmNotDelivered: false }]);
  await expect(user.mutation(api.send.resolveUncertainDraft, resolution)).rejects.toThrow("still active");
  vi.setSystemTime(Date.now() + UNCERTAIN_STALE_MS + 1);
  expect(await user.query(api.send.uncertainDraftAttempts, { draftId })).toMatchObject([{ canConfirmDelivered: true, canConfirmNotDelivered: true }]);
  await user.mutation(api.send.resolveUncertainDraft, resolution);
});

test("known SMTP acceptance cannot be overridden as non-delivery", async () => {
  const { t, user, draftId, sendLogId, resolution } = await setup();
  await t.mutation(internal.send.finishSmtpAttempt, { sendLogId, accepted: true, rejectedRecipients: [] });
  expect(await user.query(api.send.uncertainDraftAttempts, { draftId })).toMatchObject([{ canConfirmDelivered: true, canConfirmNotDelivered: false }]);
  await expect(user.mutation(api.send.resolveUncertainDraft, resolution)).rejects.toThrow("known delivery");
  // Known partial acceptance needs its rejected-recipient finalization, not deletion of the whole draft.
  await t.mutation(internal.send.finishSmtpAttempt, { sendLogId, accepted: true, rejectedRecipients: ["rejected@x.com"] });
  await expect(user.mutation(api.send.resolveUncertainDraft, { ...resolution, outcome: "delivered" })).rejects.toThrow("known delivery");
});

test("legacy unlinked reservations require explicit selection and reject a different draft's attempt", async () => {
  const { t, user, accountId, draftId, sendLogId, resolution } = await setup();
  const other = await user.mutation(api.drafts.create, { accountId });
  const otherLog = await t.mutation(internal.send.beginSend, { draftId: other, userId: "a", accountId, contentHash: "other", messageIdHeader: "other@x" });
  await t.mutation(internal.send.markSendUncertain, { draftId: other, sendLogId: otherLog.sendLogId! });
  await t.run(async ctx => { await ctx.db.patch(draftId, { sendLogId: undefined }); await ctx.db.patch(sendLogId, { draftId: undefined }); });
  expect(await user.query(api.send.uncertainDraftAttempts, { draftId })).toMatchObject([{ sendLogId }]);
  await expect(user.mutation(api.send.resolveUncertainDraft, { ...resolution, sendLogId: otherLog.sendLogId! })).rejects.toThrow("Send attempt not found");
  await user.mutation(api.send.resolveUncertainDraft, resolution);
});
