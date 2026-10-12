import { afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { v } from "convex/values";
import { api, internal } from "../../convex/_generated/api";
import { internalAction } from "../../convex/_generated/server";
import schema from "../../convex/schema";
import { makeMessage, makeT, modules, seedAccount, seedFolder } from "./testUtil";

afterEach(() => vi.useRealTimers());

test("failed scheduled draft pushes acquire a single backed-off durable retry", async () => {
  vi.useFakeTimers();
  const t = makeT(); const accountId = await seedAccount(t, "a");
  const draftId = await t.withIdentity({ subject: "a" }).mutation(api.drafts.create, { accountId, text: "Saved work" });
  await t.mutation(internal.syncStore.retryDraftPush, { draftId });
  await t.mutation(internal.syncStore.retryDraftPush, { draftId });
  const ops = await t.run(ctx => ctx.db.query("pendingOps").collect());
  expect(ops).toHaveLength(1);
  expect(ops[0]).toMatchObject({ kind: "appendDraft", payload: { draftId }, nextAttemptAt: Date.now() + 30000, attempts: 0 });
  expect(await t.run(ctx => ctx.db.get(draftId))).toMatchObject({ remoteDirty: true, pushScheduledAt: ops[0].nextAttemptAt });
  await t.run(ctx => ctx.db.patch(draftId, { remoteDirty: false }));
  await t.mutation(internal.syncStore.completeOp, { opId: ops[0]._id });
  await t.mutation(internal.syncStore.retryDraftPush, { draftId });
  expect(await t.run(ctx => ctx.db.query("pendingOps").collect())).toEqual([]);
});

test.each(["before", "after", "never"] as const)("imported reply drafts retain threading and their complete body (original loaded=%s)", async timing => {
  const perform = vi.fn();
  const t = convexTest(schema, { ...modules, "../../convex/node/sendOps.ts": async () => ({
    performSend: internalAction({ args: v.any(), handler: async (ctx, args) => {
      perform(args);
      return await ctx.runMutation(internal.send.completeSend, {
        sendLogId: args.sendLogId, draftId: args.draftId, accountId: args.accountId,
        replyToMessageDocId: args.replyToMessageDocId, messageIdHeader: args.messageIdHeader,
        inReplyTo: args.inReplyTo, references: args.references ?? [], subject: args.subject,
        from: { email: "me@x.com" }, to: args.to, cc: args.cc ?? [], bcc: args.bcc ?? [],
        text: args.text ?? "", attachments: [],
      });
    } }),
  }) });
  const accountId = await seedAccount(t, "a");
  const inbox = await seedFolder(t, "a", accountId, "inbox", "INBOX");
  const drafts = await seedFolder(t, "a", accountId, "drafts", "Drafts");
  let original = timing === "before" ? await t.mutation(internal.ingest.ingest, makeMessage("a", accountId, {
    folderId: inbox, messageIdHeader: "parent@x", references: ["root@x"],
  })) : undefined;
  const text = "My reply\n\n> Existing quote";
  const draftId = await t.mutation(internal.syncStore.importRemoteDraft, {
    userId: "a", accountId, messageIdHeader: "imported@x", inReplyTo: "parent@x", references: ["root@x", "parent@x"],
    subject: "Re: Conversation", to: [{ email: "sender@x.com" }], cc: [], bcc: [], html: "", text,
    remoteFolderId: drafts, remoteUid: 5, attachments: [],
  });
  expect(await t.run(ctx => ctx.db.get(draftId))).toMatchObject({ mode: "reply", inReplyTo: "parent@x", bodyIncludesQuote: true });
  if (original) expect(await t.run(ctx => ctx.db.get(draftId))).toMatchObject({ replyToMessageId: original.messageId, threadId: original.threadId });
  if (timing === "after") original = await t.mutation(internal.ingest.ingest, makeMessage("a", accountId, { folderId: inbox, messageIdHeader: "parent@x" }));
  await t.withIdentity({ subject: "a" }).action(api.send.sendDraft, { draftId });
  expect(perform).toHaveBeenCalledWith(expect.objectContaining({ inReplyTo: "parent@x", references: ["root@x", "parent@x"], text }));
  if (original) {
    expect(perform.mock.calls[0][0].replyToMessageDocId).toBe(original.messageId);
    const flags = await t.run(ctx => ctx.db.query("pendingOps").collect());
    expect(flags).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: "flags", payload: { updates: [expect.objectContaining({ messageId: original.messageId, add: ["\\Answered"] })] },
    })]));
  }
});

test("account purge deletes both uncertain-send recovery MIME and message fallback MIME", async () => {
  vi.useFakeTimers();
  const t = makeT(); const accountId = await seedAccount(t, "a");
  const recoverySource = await t.run(ctx => ctx.storage.store(new Blob(["uncertain private MIME"])));
  const messageSource = await t.run(ctx => ctx.storage.store(new Blob(["accepted private MIME"])));
  await t.mutation(internal.ingest.ingest, makeMessage("a", accountId, { sourceStorageId: messageSource, folderRole: "sent" }));
  const begin = await t.mutation(internal.send.beginSend, { userId: "a", accountId, contentHash: "uncertain", messageIdHeader: "uncertain@x" });
  const sendLogId = begin.sendLogId!;
  await t.mutation(internal.send.markSendUncertain, { sendLogId, recovery: {
    sendLogId, accountId, sourceStorageId: recoverySource, messageIdHeader: "uncertain@x", references: [],
    subject: "Private", from: { email: "me@x" }, to: [], cc: [], bcc: [], text: "", attachments: [],
  } });
  await t.withIdentity({ subject: "a" }).mutation(api.accounts.remove, { accountId });
  await t.mutation(internal.accounts.purgeAccountBatch, { userId: "a", accountId });
  await t.mutation(internal.accounts.purgeAccountBatch, { userId: "a", accountId });
  expect(await t.run(ctx => ctx.storage.get(recoverySource))).toBeNull();
  expect(await t.run(ctx => ctx.storage.get(messageSource))).toBeNull();
});
