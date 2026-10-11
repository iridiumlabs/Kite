import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { makeT, seedAccount } from "./testUtil";
afterEach(() => vi.useRealTimers());
test.each(["delivered", "notDelivered"] as const)("explicit direct resolution handles its durable MIME as %s", async outcome => {
  vi.useFakeTimers();
  const t = makeT(); const accountId = await seedAccount(t, "a"); const user = t.withIdentity({ subject: "a" });
  const sourceStorageId = await t.run(ctx => ctx.storage.store(new Blob(["durable MIME"])));
  const begin = await t.mutation(internal.send.beginSend, { accountId, userId: "a", contentHash: "unknown", messageIdHeader: "unknown@x" });
  const sendLogId = begin.sendLogId!;
  await t.mutation(internal.send.markSendUncertain, { sendLogId, recovery: { sendLogId, accountId, sourceStorageId, messageIdHeader: "unknown@x", references: [], subject: "", from: { email: "me@x" }, to: [{ email: "to@x" }], cc: [], bcc: [], text: "", attachments: [] } });
  await t.mutation(internal.send.finishSmtpAttempt, { sendLogId, accepted: false });
  await t.mutation(internal.send.failSend, { sendLogId, error: "Lost response" });
  await user.mutation(api.send.resolveUncertainSend, { sendLogId, outcome, confirmed: true });
  const log = await t.query(internal.send.sendLogEntry, { sendLogId });
  expect(log!.recovery).toBeUndefined();
  const source = await t.run(async ctx => (await ctx.storage.get(sourceStorageId))?.text() ?? null);
  if (outcome === "notDelivered") expect(source).toBeNull();
  else {
    expect(source).toBe("durable MIME");
    expect(await t.run(ctx => ctx.db.get(log!.messageId!))).toMatchObject({ sourceStorageId });
  }
});
