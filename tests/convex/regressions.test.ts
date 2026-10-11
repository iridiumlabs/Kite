import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { makeMessage, makeT, seedAccount, seedFolders } from "./testUtil";

afterEach(() => vi.useRealTimers());

test("category names are trimmed, unique per owner, and nonempty on create and update", async () => {
  const t = makeT();
  const user = t.withIdentity({ subject: "a" });
  const id = await user.mutation(api.categories.create, { name: " Receipts ", description: "Orders" });
  expect((await user.query(api.categories.list, {}))[0].name).toBe("Receipts");
  await expect(user.mutation(api.categories.create, { name: "receipts", description: "" })).rejects.toThrow("already exists");
  await expect(user.mutation(api.categories.create, { name: "  ", description: "" })).rejects.toThrow("empty");
  const second = await user.mutation(api.categories.create, { name: "Work", description: "" });
  await expect(user.mutation(api.categories.update, { categoryId: second, name: " RECEIPTS " })).rejects.toThrow("already exists");
  await expect(user.mutation(api.categories.update, { categoryId: id, name: " " })).rejects.toThrow("empty");
  await user.mutation(api.categories.update, { categoryId: id, name: "Receipts" });
  await t.withIdentity({ subject: "b" }).mutation(api.categories.create, { name: "Receipts", description: "" });
});

test("expired snoozes are not starved by more than a batch of ordinary threads", async () => {
  vi.useFakeTimers();
  const t = makeT();
  const accountId = await seedAccount(t, "a");
  for (let i = 0; i < 105; i++) {
    await t.mutation(internal.ingest.ingest, makeMessage("a", accountId, { messageIdHeader: `normal${i}@x` }));
  }
  const due = await t.mutation(internal.ingest.ingest, makeMessage("a", accountId, { messageIdHeader: "due@x" }));
  await t.withIdentity({ subject: "a" }).mutation(api.mail.snooze, { threadIds: [due.threadId], until: Date.now() + 1000 });
  vi.advanceTimersByTime(2000);
  expect(await t.mutation(internal.crons.unsnoozeBatch, {})).toBe(1);
  const thread = await t.run((ctx) => ctx.db.get(due.threadId));
  expect(thread?.snoozedUntil).toBeUndefined();
  expect(thread?.listKey).toBe("primary");
  expect(await t.mutation(internal.crons.unsnoozeBatch, {})).toBe(0);
});

test("backfill status is scoped to the requested owner, account and folder role", async () => {
  const t = makeT();
  const a = await seedAccount(t, "a");
  const b = await seedAccount(t, "a", "b@x.com");
  const f = await seedFolders(t, "a", a);
  const g = await seedFolders(t, "a", b);
  await t.run(async (ctx) => {
    await ctx.db.patch(f.inbox, { backfillDone: false });
    await ctx.db.patch(g.sent, { backfillDone: false });
  });
  const user = t.withIdentity({ subject: "a" });
  expect(await user.query(api.mail.backfillStatus, { role: "inbox" })).toEqual({ total: 2, pending: 1 });
  expect(await user.query(api.mail.backfillStatus, { accountId: a, role: "sent" })).toEqual({ total: 1, pending: 0 });
  expect(await t.withIdentity({ subject: "b" }).query(api.mail.backfillStatus, {})).toEqual({ total: 0, pending: 0 });
});

test("an empty filtered category page keeps a cursor to older matching mail", async () => {
  const t = makeT();
  const accountId = await seedAccount(t, "a");
  const user = t.withIdentity({ subject: "a" });
  const categoryId = await user.mutation(api.categories.create, { name: "Work", description: "Work mail" });
  for (let i = 0; i < 3; i++) {
    await t.mutation(internal.ingest.ingest, makeMessage("a", accountId, {
      messageIdHeader: `category-page-${i}@x`, date: 100 + i, seen: i !== 0, categoryIds: [categoryId],
    }));
  }
  const args = { view: "category" as const, categoryId, filter: { unread: true } };
  const first = await user.query(api.mail.listThreads, { ...args, paginationOpts: { numItems: 2, cursor: null } });
  expect(first.page).toEqual([]);
  expect(first.isDone).toBe(false);
  const second = await user.query(api.mail.listThreads, { ...args, paginationOpts: { numItems: 2, cursor: first.continueCursor } });
  expect(second.page).toHaveLength(1);
  expect(second.page[0].unread).toBe(true);
  expect(second.isDone).toBe(true);
});

test("account draft pagination is indexed, newest-first and has no duplicates", async () => {
  vi.useFakeTimers();
  const t = makeT();
  const a = await seedAccount(t, "a");
  const user = t.withIdentity({ subject: "a" });
  for (let i = 0; i < 7; i++) {
    await user.mutation(api.drafts.create, { accountId: a, subject: String(i) });
    vi.advanceTimersByTime(1000);
  }
  const first = await user.query(api.drafts.list, { accountId: a, paginationOpts: { numItems: 3, cursor: null, id: 65 } });
  const second = await user.query(api.drafts.list, { accountId: a, paginationOpts: { numItems: 3, cursor: first.continueCursor } });
  expect(first.page.map((d) => d.subject)).toEqual(["6", "5", "4"]);
  expect(second.page.map((d) => d.subject)).toEqual(["3", "2", "1"]);
});

test("send rejects foreign drafts, reply targets and forwarded attachments before network I/O", async () => {
  vi.useFakeTimers();
  const t = makeT();
  const a = await seedAccount(t, "a");
  const b = await seedAccount(t, "b", "b@x.com");
  const foreign = await t.mutation(internal.ingest.ingest, makeMessage("b", b));
  const draftId = await t.withIdentity({ subject: "b" }).mutation(api.drafts.create, { accountId: b });
  const user = t.withIdentity({ subject: "a" });
  const args = { accountId: a, to: [{ email: "r@x.com" }], subject: "Test", text: "Test" };
  await expect(user.action(api.send.sendMessage, { ...args, draftId })).rejects.toThrow("Draft not found");
  await expect(user.action(api.send.sendMessage, { ...args, replyToMessageId: foreign.messageId })).rejects.toThrow("Message not found");
  await expect(user.action(api.send.sendMessage, { ...args, attachments: [{ messageId: foreign.messageId, attachmentId: "x" }] })).rejects.toThrow("Attachment not found");
  await expect(user.action(api.send.reply, { messageId: foreign.messageId, text: "Test" })).rejects.toThrow("Message not found");
  await expect(user.action(api.send.forward, { messageId: foreign.messageId, to: args.to })).rejects.toThrow("Message not found");
  expect(await t.run((ctx) => ctx.db.query("sendLog").collect())).toHaveLength(0);
});

test("classification retries retain ingest-time categories and cannot overwrite manual corrections", async () => {
  const t = makeT();
  const accountId = await seedAccount(t, "a");
  const folders = await seedFolders(t, "a", accountId);
  const user = t.withIdentity({ subject: "a" });
  const categoryId = await user.mutation(api.categories.create, { name: "Orders", description: "Original description" });
  const message = await t.mutation(internal.ingest.ingest, {
    ...makeMessage("a", accountId, { folderId: folders.inbox, uid: 1, classifiedBy: "heuristic", needsClassification: true }),
    classificationCategories: [{ id: categoryId, name: "Orders", description: "Original description" }],
  });
  await user.mutation(api.categories.update, { categoryId, description: "Changed description" });
  await user.mutation(api.categories.create, { name: "New category", description: "Added later" });
  const retry = await t.query(internal.syncStore.needsClassification, {});
  expect(retry[0].classificationCategories).toEqual([{ id: categoryId, name: "Orders", description: "Original description" }]);
  const update = { messageId: message.messageId, inbox: "other" as const, categoryIds: [categoryId], classifiedBy: "jev" as const, needsClassification: false, classifyAttempts: 2 };
  await user.mutation(api.mail.moveToInbox, { threadIds: [message.threadId], inbox: "primary" });
  await t.mutation(internal.syncStore.applyClassification, { updates: [update] });
  const doc = await t.run(ctx => ctx.db.get(message.messageId));
  expect(doc?.inbox).toBe("primary");
  expect(doc?.classifiedBy).toBe("manual");
  expect(doc?.categoryIds).toEqual([]);
});

test("failed classification retries preserve the fallback inbox and successful retries omit deleted categories", async () => {
  const t = makeT();
  const accountId = await seedAccount(t, "a");
  const user = t.withIdentity({ subject: "a" });
  const categoryId = await user.mutation(api.categories.create, { name: "Temporary", description: "" });
  const message = await t.mutation(internal.ingest.ingest, makeMessage("a", accountId, { inbox: "other", classifiedBy: "heuristic", needsClassification: true }));
  await t.mutation(internal.syncStore.applyClassification, { updates: [{ messageId: message.messageId, inbox: "primary", categoryIds: [], classifiedBy: "heuristic", needsClassification: true, classifyAttempts: 2 }] });
  expect((await t.run(ctx => ctx.db.get(message.messageId)))?.inbox).toBe("other");
  await user.mutation(api.categories.remove, { categoryId });
  await t.mutation(internal.syncStore.applyClassification, { updates: [{ messageId: message.messageId, inbox: "other", categoryIds: [categoryId], classifiedBy: "jev", needsClassification: false, classifyAttempts: 3 }] });
  const doc = await t.run(ctx => ctx.db.get(message.messageId));
  expect(doc?.categoryIds).toEqual([]);
  expect(doc?.needsClassification).toBe(false);
});
