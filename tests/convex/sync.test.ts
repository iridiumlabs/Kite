import { describe, expect, test } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { makeT, seedAccount, seedFolder, type T } from "./testUtil";

const USER = "user_sync";

async function setup(t: T) {
  const accountId = await seedAccount(t, USER);
  const folderId = await seedFolder(t, USER, accountId, "inbox", "INBOX");
  return { accountId, folderId };
}

function ingestArg(over: Record<string, unknown> = {}) {
  return {
    uid: 1,
    messageIdHeader: "sync1@x",
    subject: "Sync me",
    from: { name: "Sender", email: "sender@x.com" },
    to: [{ email: "me@x.com" }],
    cc: [],
    bcc: [],
    replyTo: [],
    date: 1_700_000_000_001,
    snippet: "snippet",
    seen: true,
    flagged: false,
    answered: false,
    isOutbound: false,
    hasAttachments: false,
    inbox: "primary" as const,
    needsClassification: false,
    ...over,
  };
}

describe("ingestBatch", () => {
  test("ingests messages and writes folder state atomically", async () => {
    const t = makeT();
    const { accountId, folderId } = await setup(t);
    await t.mutation(internal.syncStore.ingestBatch, {
      userId: USER,
      accountId,
      folderId,
      folderRole: "inbox",
      messages: [ingestArg({ uid: 3 }), ingestArg({ uid: 4, messageIdHeader: "b@x", subject: "B" })],
      folderPatch: {
        uidValidity: 7,
        uidNext: 5,
        syncedUids: "3-4",
        flags: "10",
        unseen: 1,
        messages: 2,
      },
    });
    const msgs = await t.run((ctx) =>
      ctx.db.query("messages").collect(),
    );
    expect(msgs).toHaveLength(2);
    const folder = (await t.run((ctx) => ctx.db.get(folderId)))!;
    expect(folder.uidValidity).toBe(7);
    expect(folder.uidNext).toBe(5);
    expect(folder.syncedUids).toBe("3-4");
    expect(folder.flags).toBe("10");
  });

  test("repeating the same batch is idempotent", async () => {
    const t = makeT();
    const { accountId, folderId } = await setup(t);
    const args = {
      userId: USER,
      accountId,
      folderId,
      folderRole: "inbox" as const,
      messages: [ingestArg({ uid: 3 })],
      folderPatch: { syncedUids: "3", flags: "1", uidNext: 4 },
    };
    await t.mutation(internal.syncStore.ingestBatch, args);
    await t.mutation(internal.syncStore.ingestBatch, args);
    const msgs = await t.run((ctx) => ctx.db.query("messages").collect());
    expect(msgs).toHaveLength(1);
    expect(msgs[0].uid).toBe(3);
  });

  test("a duplicate (folderId, uid) does not duplicate the doc", async () => {
    const t = makeT();
    const { accountId, folderId } = await setup(t);
    for (let i = 0; i < 3; i++) {
      await t.mutation(internal.syncStore.ingestBatch, {
        userId: USER,
        accountId,
        folderId,
        folderRole: "inbox",
        messages: [ingestArg({ uid: 9, messageIdHeader: `dup-${i}@x` })],
        folderPatch: { syncedUids: "9", flags: "0" },
      });
    }
    // Same uid with different Message-IDs: (folderId, uid) dedupe wins.
    const msgs = await t.run((ctx) =>
      ctx.db.query("messages").collect(),
    );
    expect(msgs).toHaveLength(1);
  });
});

describe("sendLog dedupe", () => {
  test("same idempotency key returns the existing log", async () => {
    const t = makeT();
    const { accountId } = await setup(t);
    const first = await t.mutation(internal.send.beginSend, {
      userId: USER,
      accountId,
      idempotencyKey: "key-1",
      contentHash: "hash-1",
      messageIdHeader: "s1@x.com",
    });
    expect("sendLogId" in first).toBe(true);
    const again = await t.mutation(internal.send.beginSend, {
      userId: USER,
      accountId,
      idempotencyKey: "key-1",
      contentHash: "hash-1",
      messageIdHeader: "s2@x.com",
    });
    expect("existing" in again).toBe(true);
  });

  test("same content hash within the window is rejected", async () => {
    const t = makeT();
    const { accountId } = await setup(t);
    await t.mutation(internal.send.beginSend, {
      userId: USER,
      accountId,
      contentHash: "hash-2",
      messageIdHeader: "s1@x.com",
    });
    await expect(
      t.mutation(internal.send.beginSend, {
        userId: USER,
        accountId,
        contentHash: "hash-2",
        messageIdHeader: "s2@x.com",
      }),
    ).rejects.toThrow("Possible duplicate send");
  });

  test("allowDuplicate bypasses the hash check", async () => {
    const t = makeT();
    const { accountId } = await setup(t);
    await t.mutation(internal.send.beginSend, {
      userId: USER,
      accountId,
      contentHash: "hash-3",
      messageIdHeader: "s1@x.com",
    });
    const second = await t.mutation(internal.send.beginSend, {
      userId: USER,
      accountId,
      contentHash: "hash-3",
      messageIdHeader: "s2@x.com",
      allowDuplicate: true,
    });
    expect("sendLogId" in second).toBe(true);
  });
});

describe("drafts counter", () => {
  test("create increments and discard decrements", async () => {
    const t = makeT();
    const { accountId } = await setup(t);
    const asUser = t.withIdentity({ subject: USER });
    const draftId = await asUser.mutation(api.drafts.create, {
      accountId,
      subject: "hi",
      to: [{ email: "a@x.com" }],
    });
    let counts = await asUser.query(api.mail.counts, {});
    expect(counts.drafts).toBe(1);
    await asUser.mutation(api.drafts.discard, { draftId });
    counts = await asUser.query(api.mail.counts, {});
    expect(counts.drafts).toBe(0);
    expect(await asUser.query(api.drafts.get, { draftId })).toBeNull();
  });
});
