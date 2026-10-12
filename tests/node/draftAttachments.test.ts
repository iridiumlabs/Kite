// @vitest-environment node
import { expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { v } from "convex/values";
import { api, internal } from "../../convex/_generated/api";
import { internalAction, type ActionCtx } from "../../convex/_generated/server";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { materializeDraftAttachments } from "../../convex/node/draftAttachments";
import { draftAttachmentId } from "../../convex/lib/draftAttachment";
import { makeMessage, modules, seedAccount, seedFolder } from "../convex/testUtil";

async function setup() {
  const sent = vi.fn();
  const t = convexTest(schema, {
    ...modules,
    "../../convex/node/sendOps.ts": async () => ({ performSend: internalAction({
      args: v.any(), handler: async (ctx, args: { attachments: { storageId: Id<"_storage"> }[] }) => {
        const file = await ctx.storage.get(args.attachments[0].storageId);
        expect(await file!.text()).toBe("attachment");
        sent(); return { messageId: undefined, deduped: false };
      },
    }) }),
  });
  const accountId = await seedAccount(t, "a");
  const folderId = await seedFolder(t, "a", accountId, "drafts", "Drafts");
  const source = await t.mutation(internal.ingest.ingest, {
    ...makeMessage("a", accountId, { folderId, folderRole: "drafts", uid: 1, hasAttachments: true }),
    attachments: ["a0", "a1"].map(id => ({ id, filename: `${id}.txt`, contentType: "text/plain", size: 10, inline: false })),
  });
  const draftId = await t.mutation(internal.syncStore.importRemoteDraft, {
    userId: "a", accountId, messageIdHeader: "imported@x", subject: "Imported", to: [{ email: "to@x.com" }], cc: [], bcc: [], html: "", text: "Body",
    remoteFolderId: folderId, remoteUid: 1,
    attachments: [{ kind: "forward", messageId: source.messageId, attachmentId: "a0", filename: "a0.txt", contentType: "text/plain", size: 10 }],
  });
  const user = t.withIdentity({ subject: "a" });
  await user.mutation(api.drafts.update, { draftId, subject: "Edited imported draft" });
  const downloads = vi.fn().mockResolvedValue(new TextEncoder().encode("attachment").buffer);
  const uploads: Id<"_storage">[] = [];
  const ctx = {
    runAction: downloads,
    runMutation: (ref: Parameters<typeof t.mutation>[0], args: never) => t.mutation(ref, args),
    storage: {
      store: async (blob: Blob) => { const id = await t.run(ctx => ctx.storage.store(blob)); uploads.push(id); return id; },
      delete: (id: Id<"_storage">) => t.run(ctx => ctx.storage.delete(id)),
    },
  } as unknown as Pick<ActionCtx, "runAction" | "runMutation" | "storage">;
  return { t, user, draftId, accountId, source, ctx, downloads, uploads, sent, draft: (await user.query(api.drafts.get, { draftId }))! };
}

test("imported attachments survive replacement and deletion of the old remote draft row", async () => {
  const { t, user, draftId, source, ctx, draft, sent } = await setup();
  const materialized = await materializeDraftAttachments(ctx, draft);
  expect(materialized!.attachments[0].kind).toBe("upload");
  expect(draftAttachmentId(materialized!.attachments[0])).toBe(draftAttachmentId(draft.attachments[0]));
  await t.mutation(internal.syncStore.deleteMessages, { ids: [source.messageId] });
  expect(await t.run(ctx => ctx.db.get(source.messageId))).toBeNull();
  await user.action(api.send.sendDraft, { draftId });
  expect(sent).toHaveBeenCalledOnce();
});

test("attachment removals during download are preserved and unused uploads are deleted", async () => {
  const { t, user, draftId, ctx, draft, downloads, uploads } = await setup();
  downloads.mockImplementation(async () => {
    await user.mutation(api.drafts.removeAttachment, { draftId, attachmentId: draftAttachmentId(draft.attachments[0]) });
    return new TextEncoder().encode("attachment").buffer;
  });
  expect(await materializeDraftAttachments(ctx, draft)).toBeNull();
  expect((await user.query(api.drafts.get, { draftId }))!.attachments).toEqual([]);
  expect(await t.run(async ctx => (await ctx.storage.get(uploads[0])) !== null)).toBe(false);
});

test("switching accounts during download preserves bytes but cancels the old account push", async () => {
  const { t, user, draftId, ctx, draft, downloads } = await setup();
  const next = await seedAccount(t, "a", "second@x.com");
  downloads.mockImplementation(async () => {
    await user.mutation(api.drafts.update, { draftId, accountId: next });
    return new TextEncoder().encode("attachment").buffer;
  });
  expect(await materializeDraftAttachments(ctx, draft)).toBeNull();
  const retained = (await user.query(api.drafts.get, { draftId }))!;
  expect(retained.accountId).toBe(next);
  expect(retained.attachments[0].kind).toBe("upload");
  if (retained.attachments[0].kind === "upload") {
    const storageId = retained.attachments[0].storageId;
    expect(await t.run(async ctx => (await ctx.storage.get(storageId))!.text())).toBe("attachment");
  }
});

test("a lost mutation response never deletes files already attached to the draft", async () => {
  const { t, user, draftId, ctx, draft, uploads } = await setup();
  const mutate = ctx.runMutation.bind(ctx);
  ctx.runMutation = async (ref, args) => { await mutate(ref, args); throw new Error("lost response"); };
  await expect(materializeDraftAttachments(ctx, draft)).rejects.toThrow("lost response");
  expect((await user.query(api.drafts.get, { draftId }))!.attachments[0].kind).toBe("upload");
  expect(await t.run(async ctx => (await ctx.storage.get(uploads[0]))!.text())).toBe("attachment");
});

test("pre-mutation download failures clean created blobs without expunging or replacing references", async () => {
  const { t, user, draftId, ctx, downloads, uploads, source } = await setup();
  await user.mutation(api.drafts.addAttachment, { draftId, attachment: { kind: "forward", messageId: source.messageId, attachmentId: "a1", filename: "a1.txt", contentType: "text/plain", size: 10 } });
  const draft = (await user.query(api.drafts.get, { draftId }))!;
  downloads.mockResolvedValueOnce(new TextEncoder().encode("attachment").buffer).mockRejectedValueOnce(new Error("download failed"));
  await expect(materializeDraftAttachments(ctx, draft)).rejects.toThrow("download failed");
  expect((await user.query(api.drafts.get, { draftId }))!.attachments.every(a => a.kind === "forward")).toBe(true);
  expect(await t.run(async ctx => (await ctx.storage.get(uploads[0])) !== null)).toBe(false);
  expect(await t.run(ctx => ctx.db.get(source.messageId))).not.toBeNull();
});
