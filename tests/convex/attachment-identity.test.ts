import { afterEach, expect, test, vi } from "vitest";
import { api } from "../../convex/_generated/api";
import { makeT, seedAccount } from "./testUtil";

afterEach(() => vi.useRealTimers());

test("removal uses stable IDs despite out-of-order completions and repeated adds", async () => {
  vi.useFakeTimers();
  const t = makeT(); const accountId = await seedAccount(t, "a");
  const user = t.withIdentity({ subject: "a" });
  const draftId = await user.mutation(api.drafts.create, { accountId });
  const first = await t.run(ctx => ctx.storage.store(new Blob(["first private file"])));
  const second = await t.run(ctx => ctx.storage.store(new Blob(["second file"])));
  const attachment = (id: string, storageId: typeof first) => ({ kind: "upload" as const, id, storageId, filename: `${id}.txt`, contentType: "text/plain", size: 10 });
  // The second selection finishes first.
  await user.mutation(api.drafts.addAttachment, { draftId, attachment: attachment("second", second) });
  await user.mutation(api.drafts.addAttachment, { draftId, attachment: attachment("first", first) });
  await user.mutation(api.drafts.addAttachment, { draftId, attachment: attachment("first", first) });
  expect((await user.query(api.drafts.get, { draftId }))!.attachments).toHaveLength(2);
  await user.mutation(api.drafts.removeAttachment, { draftId, attachmentId: "first" });
  await user.mutation(api.drafts.removeAttachment, { draftId, attachmentId: "first" });
  expect((await user.query(api.drafts.get, { draftId }))!.attachments).toMatchObject([{ id: "second", storageId: second }]);
  expect(await t.run(ctx => ctx.storage.get(first))).toBeNull();
  expect(await t.run(async ctx => (await ctx.storage.get(second))!.text())).toBe("second file");
});

test("removing one attachment retains a blob still referenced by another attachment", async () => {
  vi.useFakeTimers();
  const t = makeT(); const accountId = await seedAccount(t, "a");
  const user = t.withIdentity({ subject: "a" });
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(["shared"])));
  const draftId = await user.mutation(api.drafts.create, { accountId, attachments: ["one", "two"].map(id => ({ kind: "upload" as const, id, storageId, filename: id, contentType: "text/plain", size: 6 })) });
  await user.mutation(api.drafts.removeAttachment, { draftId, attachmentId: "one" });
  expect(await t.run(async ctx => (await ctx.storage.get(storageId)) !== null)).toBe(true);
  await user.mutation(api.drafts.removeAttachment, { draftId, attachmentId: "two" });
  expect(await t.run(ctx => ctx.storage.get(storageId))).toBeNull();
});
