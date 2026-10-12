import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { makeT, seedAccount } from "./testUtil";

afterEach(() => vi.useRealTimers());

test.each(["sending", "sent"] as const)("reusing a %s send's idempotency key does not strand a different draft's claim", async status => {
  vi.useFakeTimers();
  const t = makeT();
  const accountId = await seedAccount(t, "a");
  const user = t.withIdentity({ subject: "a" });
  const reservation = await t.mutation(internal.send.beginSend, {
    userId: "a", accountId, idempotencyKey: "existing-key",
    contentHash: "original-content", messageIdHeader: "<original@x.com>",
  });
  const sendLogId = reservation.sendLogId;
  if (!sendLogId) throw new Error("Expected a new send reservation");
  await t.run(async ctx => ctx.db.patch(sendLogId, { status }));
  const draftId = await user.mutation(api.drafts.create, {
    accountId, subject: "A different message", text: "New body", to: [{ email: "recipient@x.com" }],
  });
  const result = await user.action(api.send.sendDraft, { draftId, idempotencyKey: "existing-key" });
  expect(result.deduped).toBe(true);
  expect(result.sendLogId).toBe(sendLogId);
  expect((await user.query(api.drafts.get, { draftId }))?.status).toBe("failed");
  await user.mutation(api.drafts.update, { draftId, text: "Still editable" });
  expect((await user.query(api.drafts.get, { draftId }))?.text).toBe("Still editable");
});
