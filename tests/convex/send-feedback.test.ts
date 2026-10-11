import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { makeT, seedAccount } from "./testUtil";
import { isDefiniteSmtpFailure } from "../../convex/lib/smtpFailure";

afterEach(() => vi.useRealTimers());

test("definite connection failures unlock the draft and report failures only to its owner", async () => {
  vi.useFakeTimers();
  const t = makeT();
  const accountId = await seedAccount(t, "a");
  const user = t.withIdentity({ subject: "a" });
  const draftId = await user.mutation(api.drafts.create, { accountId, to: [{ email: "to@x.com" }], subject: "Failed message" });
  await t.mutation(internal.send.claimDraftForSend, { draftId, userId: "a" });
  const reservation = await t.mutation(internal.send.beginSend, { userId: "a", accountId, contentHash: "hash", messageIdHeader: "m@x" });
  const sendLogId = reservation.sendLogId!;
  await t.mutation(internal.send.markSendUncertain, { sendLogId, draftId });
  expect(await user.query(api.drafts.sendProblems, {})).toEqual([]);
  await t.mutation(internal.send.failSend, {
    sendLogId, draftId, error: "Connection timeout",
    definiteRejection: isDefiniteSmtpFailure({ code: "ETIMEDOUT", command: "CONN", message: "Connection timeout" }),
  });
  expect(await user.query(api.drafts.sendProblems, {})).toMatchObject([{ draftId, status: "failed", sendError: "Connection timeout", subject: "Failed message" }]);
  expect(await t.withIdentity({ subject: "b" }).query(api.drafts.sendProblems, {})).toEqual([]);
  const failureTime = (await user.query(api.drafts.sendProblems, {}))[0].updatedAt;
  vi.advanceTimersByTime(1000);
  await user.mutation(api.drafts.update, { draftId, subject: "Retry" });
  expect((await user.query(api.drafts.sendProblems, {}))[0].updatedAt).toBe(failureTime);
  // Failure remains visible after editing until a send is queued again.
  expect((await user.query(api.drafts.get, { draftId }))?.sendError).toBe("Connection timeout");
  await user.mutation(api.drafts.scheduleSend, { draftId, at: Date.now() + 10000 });
  expect(await user.query(api.drafts.sendProblems, {})).toEqual([]);
  await t.mutation(internal.send.claimDraftForSend, { draftId, userId: "a" });
  expect((await user.query(api.drafts.get, { draftId }))?.sendError).toBeUndefined();
});

test("ambiguous failures are observable without releasing the delivery reservation", async () => {
  vi.useFakeTimers();
  const t = makeT();
  const accountId = await seedAccount(t, "a");
  const user = t.withIdentity({ subject: "a" });
  const draftId = await user.mutation(api.drafts.create, { accountId, to: [{ email: "to@x.com" }] });
  await t.mutation(internal.send.claimDraftForSend, { draftId, userId: "a" });
  const reservation = await t.mutation(internal.send.beginSend, { userId: "a", accountId, contentHash: "ambiguous", messageIdHeader: "m@x" });
  const sendLogId = reservation.sendLogId!;
  await t.mutation(internal.send.markSendUncertain, { sendLogId, draftId });
  await t.mutation(internal.send.failSend, { sendLogId, draftId, error: "Socket timeout" });
  expect(await user.query(api.drafts.sendProblems, {})).toMatchObject([{ draftId, status: "uncertain", sendError: "Socket timeout" }]);
  expect((await t.query(internal.send.sendLogEntry, { sendLogId }))?.status).toBe("uncertain");
  await expect(user.mutation(api.drafts.update, { draftId, subject: "retry" })).rejects.toThrow("Delivery is uncertain");
  await expect(user.mutation(api.drafts.scheduleSend, { draftId, at: Date.now() })).rejects.toThrow("Delivery is uncertain");
});

test("failures before SMTP are included in the global feedback subscription", async () => {
  vi.useFakeTimers();
  const t = makeT(); const accountId = await seedAccount(t, "a");
  const user = t.withIdentity({ subject: "a" });
  const draftId = await user.mutation(api.drafts.create, { accountId, to: [{ email: "to@x.com" }] });
  const claimed = await t.mutation(internal.send.claimDraftForSend, { draftId, userId: "a" });
  await t.mutation(internal.send.failClaimedDraft, { draftId, claimId: claimed!.sendClaimId!, error: "Attachment upload not found" });
  const result = await user.query(api.drafts.sendProblems, {});
  expect(result).toMatchObject([{ draftId, status: "failed", sendError: "Attachment upload not found" }]);
  expect(result[0]).not.toHaveProperty("attachments");
  expect(result[0]).not.toHaveProperty("html");
});
