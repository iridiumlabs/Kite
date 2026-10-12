import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { makeT, seedAccount } from "./testUtil";

afterEach(() => vi.useRealTimers());
test("partial completion retains only rejected recipients, preserves files, and deduplicates safely", async () => {
  vi.useFakeTimers();
  const t = makeT(); const accountId = await seedAccount(t, "a");
  const user = t.withIdentity({ subject: "a" });
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(["attachment"])));
  const draftId = await user.mutation(api.drafts.create, {
    accountId, to: [{ email: "ok@x.com" }], cc: [{ email: "ok-cc@x.com" }], bcc: [{ email: "rejected@x.com" }],
    subject: "Partial", text: "Body", attachments: [{ kind: "upload", storageId, filename: "a.txt", contentType: "text/plain", size: 10 }],
  });
  const draft = await user.query(api.drafts.get, { draftId });
  await t.mutation(internal.send.claimDraftForSend, { userId: "a", draftId });
  const reserved = await t.mutation(internal.send.beginSend, { userId: "a", accountId, contentHash: "partial", idempotencyKey: "original", messageIdHeader: draft!.messageIdHeader });
  const sendLogId = reserved.sendLogId!;
  await t.mutation(internal.send.markSendUncertain, { sendLogId, draftId });
  const completion = {
    sendLogId, draftId, accountId, messageIdHeader: draft!.messageIdHeader, references: [], subject: "Partial",
    from: { email: "me@x.com" }, to: [{ email: "ok@x.com" }], cc: [{ email: "ok-cc@x.com" }], bcc: [],
    text: "Body", attachments: [], rejectedRecipients: ["rejected@x.com"],
  };
  const result = await t.mutation(internal.send.completeSend, completion);
  expect(result.rejectedRecipients).toEqual(["rejected@x.com"]);
  const retained = await user.query(api.drafts.get, { draftId });
  expect(retained).toMatchObject({ status: "failed", to: [], cc: [], bcc: [{ email: "rejected@x.com" }], text: "Body", attachments: draft!.attachments });
  expect(retained!.messageIdHeader).not.toBe(draft!.messageIdHeader);
  expect(retained!.sendError).toContain("Partially delivered");
  await expect(user.mutation(api.drafts.update, { draftId, expectedDeliveryVersion: 0, to: draft!.to, cc: draft!.cc, bcc: draft!.bcc })).rejects.toThrow("Draft delivery changed");
  expect((await user.query(api.drafts.get, { draftId }))!.to).toEqual([]);
  expect(await t.run(async ctx => (await ctx.storage.get(storageId))?.text())).toBe("attachment");
  const sent = await user.query(api.mail.getMessage, { messageId: result.messageId! });
  expect(sent).toMatchObject({ to: completion.to, cc: completion.cc, bcc: [] });
  expect(await t.mutation(internal.send.completeSend, completion)).toMatchObject({ deduped: true, rejectedRecipients: ["rejected@x.com"] });
  expect((await user.query(api.drafts.get, { draftId }))!.messageIdHeader).toBe(retained!.messageIdHeader);
  const deduped = await user.action(api.send.sendMessage, { accountId, to: completion.to, subject: "Partial", text: "Body", idempotencyKey: "original" });
  expect(deduped).toMatchObject({ deduped: true, rejectedRecipients: ["rejected@x.com"] });
  expect(await user.query(api.drafts.sendProblems, {})).toMatchObject([{ draftId, status: "failed" }]);
  // A Bcc-only retry keeps the rejected address private and is schedulable.
  await user.mutation(api.drafts.scheduleSend, { draftId, at: Date.now() + 10000 });
});
