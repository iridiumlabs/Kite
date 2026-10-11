import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { makeMessage, makeT, seedAccount, seedFolders } from "./testUtil";
afterEach(() => vi.useRealTimers());

test("unchanged draft saves do not update timestamps or schedule another remote push", async () => {
  vi.useFakeTimers();
  const t = makeT();
  const accountId = await seedAccount(t, "a");
  const user = t.withIdentity({ subject: "a" });
  const draftId = await user.mutation(api.drafts.create, { accountId, text: "Body" });
  const before = await user.query(api.drafts.get, { draftId });
  vi.advanceTimersByTime(1000);
  await user.mutation(api.drafts.update, { draftId, text: "Body" });
  expect(await user.query(api.drafts.get, { draftId })).toEqual(before);
});

test("changing the draft sender account clears the old remote location and queues cleanup on the old account", async () => {
  vi.useFakeTimers();
  const t = makeT();
  const a = await seedAccount(t, "a");
  const b = await seedAccount(t, "a", "second@x.com");
  const folders = await seedFolders(t, "a", a);
  const user = t.withIdentity({ subject: "a" });
  const draftId = await user.mutation(api.drafts.create, { accountId: a });
  await t.mutation(internal.syncStore.markDraftPushed, { draftId, folderId: folders.drafts, uid: 10 });
  await user.mutation(api.drafts.update, { draftId, accountId: b });
  const draft = await user.query(api.drafts.get, { draftId });
  expect(draft?.accountId).toBe(b);
  expect(draft?.remoteUid).toBeUndefined();
  const ops = await t.query(internal.syncStore.dueOps, { accountId: a, now: Date.now() });
  expect(ops.some(op => op.kind === "deleteRemoteDraft" && op.payload.uid === 10)).toBe(true);
  expect(await t.mutation(internal.syncStore.markDraftPushed, { draftId, folderId: folders.drafts, uid: 11, pushedAccountId: a })).toBeNull();
});

test("a remote push cannot mark newer edits clean or resurrect a discarded draft", async () => {
  vi.useFakeTimers();
  const t = makeT();
  const accountId = await seedAccount(t, "a");
  const user = t.withIdentity({ subject: "a" });
  const draftId = await user.mutation(api.drafts.create, { accountId, text: "Old version" });
  const before = await user.query(api.drafts.get, { draftId });
  vi.advanceTimersByTime(1000);
  await user.mutation(api.drafts.update, { draftId, text: "New version" });
  await t.mutation(internal.syncStore.markDraftPushed, { draftId, uid: 1, pushedUpdatedAt: before!.updatedAt });
  expect((await user.query(api.drafts.get, { draftId }))?.remoteDirty).toBe(true);
  await user.mutation(api.drafts.discard, { draftId });
  expect(await t.mutation(internal.syncStore.markDraftPushed, { draftId, uid: 2, pushedUpdatedAt: before!.updatedAt })).toBeNull();
});

test("cancellation prevents scheduled claims and an atomic send claim prevents duplicate sends or editing", async () => {
  vi.useFakeTimers();
  const t = makeT();
  const accountId = await seedAccount(t, "a");
  const user = t.withIdentity({ subject: "a" });
  const draftId = await user.mutation(api.drafts.create, { accountId, to: [{ email: "recipient@x.com" }] });
  await user.mutation(api.drafts.scheduleSend, { draftId, at: Date.now() + 60_000 });
  await user.mutation(api.drafts.cancelScheduledSend, { draftId });
  expect(await t.mutation(internal.send.claimDraftForSend, { userId: "a", draftId, scheduledOnly: true })).toBeNull();
  await t.mutation(internal.send.claimDraftForSend, { userId: "a", draftId });
  await expect(t.mutation(internal.send.claimDraftForSend, { userId: "a", draftId })).rejects.toThrow("already sending");
  await expect(user.mutation(api.drafts.cancelScheduledSend, { draftId })).rejects.toThrow("already sending");
  await expect(user.mutation(api.drafts.update, { draftId, text: "Late change" })).rejects.toThrow("already sending");
});

test("an old scheduled job cannot claim a rescheduled draft early", async () => {
  vi.useFakeTimers();
  const t = makeT();
  const accountId = await seedAccount(t, "a");
  const user = t.withIdentity({ subject: "a" });
  const draftId = await user.mutation(api.drafts.create, { accountId, to: [{ email: "recipient@x.com" }] });
  const originalDue = Date.now() + 60_000;
  await user.mutation(api.drafts.scheduleSend, { draftId, at: originalDue });
  await user.mutation(api.drafts.cancelScheduledSend, { draftId });
  await user.mutation(api.drafts.scheduleSend, { draftId, at: originalDue + 60_000 });
  vi.setSystemTime(originalDue);
  expect(await t.mutation(internal.send.claimDraftForSend, { userId: "a", draftId, scheduledOnly: true })).toBeNull();
  expect((await user.query(api.drafts.get, { draftId }))?.status).toBe("scheduled");
  vi.setSystemTime(originalDue + 60_000);
  expect(await t.mutation(internal.send.claimDraftForSend, { userId: "a", draftId, scheduledOnly: true })).not.toBeNull();
  expect((await user.query(api.drafts.get, { draftId }))?.status).toBe("sending");
});

test("draft creation and attachment updates reject foreign message references before a remote push", async () => {
  vi.useFakeTimers();
  const t = makeT();
  const a = await seedAccount(t, "a");
  const b = await seedAccount(t, "b", "foreign@x.com");
  const foreign = await t.mutation(internal.ingest.ingest, makeMessage("b", b));
  const user = t.withIdentity({ subject: "a" });
  await expect(user.mutation(api.drafts.create, { accountId: a, replyToMessageId: foreign.messageId })).rejects.toThrow("Message not found");
  await expect(user.mutation(api.drafts.create, { accountId: a, threadId: foreign.threadId })).rejects.toThrow("Thread not found");
  const draftId = await user.mutation(api.drafts.create, { accountId: a });
  await expect(user.mutation(api.drafts.addAttachment, { draftId, attachment: { kind: "forward", messageId: foreign.messageId, attachmentId: "x", filename: "x", contentType: "text/plain", size: 1 } })).rejects.toThrow("Attachment not found");
});
