import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { counterKeys } from "../../convex/lib/counters";
import {
  makeMessage,
  makeT,
  mulberry32,
  seedAccount,
  seedFolders,
  type T,
  type TestMessage,
} from "./testUtil";

const USER = "user_a";
const PAGE = { numItems: 50, cursor: null };

afterEach(() => {
  vi.useRealTimers();
});

// Counter docs are kept at 0 rather than deleted; comparisons ignore them.
function nonzero(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(counts).filter(([, v]) => v !== 0),
  );
}

async function ingest(t: T, msg: TestMessage) {
  return (await t.mutation(internal.ingest.ingest, msg as never)) as {
    messageId: Id<"messages">;
    threadId: Id<"threads">;
    deduped: boolean;
  };
}

async function listKeys(t: T, userId: string, view: string) {
  const res = await t
    .withIdentity({ subject: userId })
    .query(api.mail.listThreads, {
      view: view as never,
      paginationOpts: PAGE,
    });
  return res.page.map((th) => th._id);
}

async function threadOf(t: T, userId: string, threadId: Id<"threads">) {
  return (
    await t.withIdentity({ subject: userId }).query(api.mail.getThread, {
      threadId,
    })
  ).thread;
}

describe("ingest dedupe", () => {
  test("same folder+uid ingests once", async () => {
    const t = makeT();
    const accountId = await seedAccount(t, USER);
    const folders = await seedFolders(t, USER, accountId);
    const msg = makeMessage(USER, accountId, {
      folderId: folders.inbox,
      uid: 10,
    });
    const first = await ingest(t, msg);
    const second = await ingest(t, { ...msg, seen: false });
    expect(second.deduped).toBe(true);
    expect(second.messageId).toBe(first.messageId);
    const { messages } = await t
      .withIdentity({ subject: USER })
      .query(api.mail.getThread, { threadId: first.threadId });
    expect(messages).toHaveLength(1);
    expect(messages[0].seen).toBe(false);
  });

  test("local placeholder is upgraded by later ingest", async () => {
    const t = makeT();
    const accountId = await seedAccount(t, USER);
    const folders = await seedFolders(t, USER, accountId);
    const local = await ingest(
      t,
      makeMessage(USER, accountId, {
        folderRole: "local",
        folderId: null,
        messageIdHeader: "local1@test",
        isOutbound: true,
        uid: undefined,
      }),
    );
    const remote = await ingest(
      t,
      makeMessage(USER, accountId, {
        folderRole: "sent",
        folderId: folders.sent,
        uid: 42,
        messageIdHeader: "local1@test",
        isOutbound: true,
      }),
    );
    expect(remote.deduped).toBe(true);
    expect(remote.messageId).toBe(local.messageId);
    const doc = await t.run((ctx) => ctx.db.get(local.messageId));
    expect(doc?.folderId).toBe(folders.sent);
    expect(doc?.uid).toBe(42);
    expect(doc?.folderRole).toBe("sent");
  });
});

describe("threading", () => {
  test("reply arriving before its parent lands in one thread", async () => {
    const t = makeT();
    const accountId = await seedAccount(t, USER);
    const child = await ingest(
      t,
      makeMessage(USER, accountId, {
        messageIdHeader: "child@x",
        inReplyTo: "parent@x",
      }),
    );
    const parent = await ingest(
      t,
      makeMessage(USER, accountId, { messageIdHeader: "parent@x" }),
    );
    expect(parent.threadId).toBe(child.threadId);
    const thread = await threadOf(t, USER, child.threadId);
    expect(thread.messageCount).toBe(2);
  });

  test("a message referencing two threads merges them into the oldest", async () => {
    const t = makeT();
    const accountId = await seedAccount(t, USER);
    const a = await ingest(
      t,
      makeMessage(USER, accountId, { messageIdHeader: "a@x" }),
    );
    const b = await ingest(
      t,
      makeMessage(USER, accountId, { messageIdHeader: "b@x" }),
    );
    expect(a.threadId).not.toBe(b.threadId);
    const c = await ingest(
      t,
      makeMessage(USER, accountId, {
        messageIdHeader: "c@x",
        references: ["a@x", "b@x"],
      }),
    );
    expect(c.threadId).toBe(a.threadId);
    const { messages } = await t
      .withIdentity({ subject: USER })
      .query(api.mail.getThread, { threadId: a.threadId });
    expect(messages).toHaveLength(3);
    await expect(
      t.withIdentity({ subject: USER }).query(api.mail.getThread, {
        threadId: b.threadId,
      }),
    ).rejects.toThrow();
  });
});

describe("archive and restore", () => {
  test("archive hides thread from inbox and category views; restore brings it back", async () => {
    const t = makeT();
    const asU = t.withIdentity({ subject: USER });
    const accountId = await seedAccount(t, USER);
    const catId = await asU.mutation(api.categories.create, {
      name: "Receipts",
      description: "purchase receipts",
      color: "#00aa00",
    });
    const { threadId } = await ingest(
      t,
      makeMessage(USER, accountId, { seen: false }),
    );
    await asU.mutation(api.mail.assignCategories, {
      threadIds: [threadId],
      add: [catId],
    });

    const inCategory = async () =>
      (
        await asU.query(api.mail.listThreads, {
          view: "category",
          categoryId: catId,
          paginationOpts: PAGE,
        })
      ).page.map((th) => th._id);

    expect(await listKeys(t, USER, "primary")).toContain(threadId);
    expect(await inCategory()).toContain(threadId);

    await asU.mutation(api.mail.archive, { threadIds: [threadId] });
    expect(await listKeys(t, USER, "primary")).not.toContain(threadId);
    expect(await listKeys(t, USER, "other")).not.toContain(threadId);
    expect(await inCategory()).not.toContain(threadId);
    expect(await listKeys(t, USER, "archive")).toContain(threadId);

    const thread = await threadOf(t, USER, threadId);
    expect(thread.location).toBe("archive");
    expect(thread.categoryIds).toContain(catId);

    await asU.mutation(api.mail.restore, { threadIds: [threadId] });
    expect(await listKeys(t, USER, "primary")).toContain(threadId);
    expect(await inCategory()).toContain(threadId);
    const restored = await threadOf(t, USER, threadId);
    expect(restored.inbox).toBe("primary");
    expect(restored.listKey).toBe("primary");
  });
});

describe("categories", () => {
  test("create and update never reclassify; delete removes everywhere", async () => {
    const t = makeT();
    const asU = t.withIdentity({ subject: USER });
    vi.useFakeTimers();
    const accountId = await seedAccount(t, USER);
    const catA = await asU.mutation(api.categories.create, {
      name: "A",
      description: "first",
      color: "#111111",
    });
    const { threadId, messageId } = await ingest(
      t,
      makeMessage(USER, accountId, { seen: false }),
    );
    await asU.mutation(api.mail.assignCategories, {
      threadIds: [threadId],
      add: [catA],
    });
    const beforeThread = await threadOf(t, USER, threadId);
    expect(beforeThread.categoryIds).toEqual([catA]);

    const catB = await asU.mutation(api.categories.create, {
      name: "B",
      description: "second",
      color: "#222222",
    });
    await asU.mutation(api.categories.update, {
      categoryId: catA,
      name: "A2",
      description: "changed",
    });
    const afterUpdate = await threadOf(t, USER, threadId);
    expect(afterUpdate.categoryIds).toEqual([catA]);
    const msgDoc = await t.run((ctx) => ctx.db.get(messageId));
    expect(msgDoc?.categoryIds).toEqual([catA]);

    const countsBefore = await asU.query(api.mail.counts, {});
    expect(countsBefore[`unread:cat:${catA}`]).toBe(1);

    await asU.mutation(api.categories.remove, { categoryId: catA });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const afterDelete = await threadOf(t, USER, threadId);
    expect(afterDelete.categoryIds).toEqual([]);
    const msgAfter = await t.run((ctx) => ctx.db.get(messageId));
    expect(msgAfter?.categoryIds).toEqual([]);
    const countsAfter = await asU.query(api.mail.counts, {});
    expect(countsAfter[`unread:cat:${catA}`] ?? 0).toBe(0);
    expect(countsAfter["unread:primary"]).toBe(1);

    await expect(
      asU.mutation(api.categories.update, {
        categoryId: catB,
        name: "ok",
      }),
    ).resolves.toBeNull();
  });
});

describe("auth", () => {
  test("api keys resolve the owner, revoked keys fail, cross-user denied", async () => {
    const t = makeT();
    const asA = t.withIdentity({ subject: "userA" });
    const asB = t.withIdentity({ subject: "userB" });
    const accountId = await seedAccount(t, "userA");
    const { threadId } = await ingest(
      t,
      makeMessage("userA", accountId, { seen: false }),
    );

    const { id: keyId, key } = await asA.mutation(api.apiKeys.create, {
      name: "mcp",
    });
    expect(key.startsWith("post_sk_")).toBe(true);

    const counts = await t.query(api.mail.counts, { apiKey: key });
    expect(counts["unread:primary"]).toBe(1);

    const threads = await t.query(api.mail.listThreads, {
      apiKey: key,
      view: "primary",
      paginationOpts: PAGE,
    });
    expect(threads.page.map((x) => x._id)).toContain(threadId);

    await expect(t.query(api.mail.counts, {})).rejects.toThrow();

    await expect(
      asB.query(api.mail.getThread, { threadId }),
    ).rejects.toThrow();
    await expect(
      asB.mutation(api.mail.setRead, { threadIds: [threadId], read: true }),
    ).rejects.toThrow();

    const asBKey = await asB.mutation(api.apiKeys.create, { name: "b" });
    await expect(
      t.query(api.mail.getThread, {
        apiKey: asBKey.key,
        threadId,
      }),
    ).rejects.toThrow();

    await expect(
      t.mutation(api.apiKeys.create, { name: "no-identity" }),
    ).rejects.toThrow();

    await asA.mutation(api.apiKeys.revoke, { apiKeyId: keyId });
    await expect(t.query(api.mail.counts, { apiKey: key })).rejects.toThrow();
  });
});

describe("inboxManual", () => {
  test("new inbound messages inherit the manual inbox bucket", async () => {
    const t = makeT();
    const asU = t.withIdentity({ subject: USER });
    const accountId = await seedAccount(t, USER);
    const first = await ingest(
      t,
      makeMessage(USER, accountId, {
        messageIdHeader: "one@x",
        inbox: "primary",
      }),
    );
    await asU.mutation(api.mail.moveToInbox, {
      threadIds: [first.threadId],
      inbox: "other",
    });
    const catId = await asU.mutation(api.categories.create, {
      name: "Keep",
      description: "d",
      color: "#123456",
    });
    const second = await ingest(
      t,
      makeMessage(USER, accountId, {
        messageIdHeader: "two@x",
        references: ["one@x"],
        inbox: "primary",
        categoryIds: [catId],
      }),
    );
    expect(second.threadId).toBe(first.threadId);
    const doc = await t.run((ctx) => ctx.db.get(second.messageId));
    expect(doc?.inbox).toBe("other");
    expect(doc?.classifiedBy).toBe("inherited");
    expect(doc?.categoryIds).toEqual([catId]);
    const thread = await threadOf(t, USER, first.threadId);
    expect(thread.inbox).toBe("other");
    expect(thread.inboxManual).toBe(true);
    expect(thread.listKey).toBe("other");
  });
});

describe("accounts.remove", () => {
  test("removes account data and keeps counters correct", async () => {
    const t = makeT();
    const asU = t.withIdentity({ subject: USER });
    vi.useFakeTimers();
    const accountId = await seedAccount(t, USER);
    await seedFolders(t, USER, accountId);
    await ingest(t, makeMessage(USER, accountId, { seen: false }));
    await ingest(t, makeMessage(USER, accountId, { seen: false }));

    const otherAccount = await seedAccount(t, USER, "other@x.com");
    await ingest(t, makeMessage(USER, otherAccount, { seen: false }));

    let counts = await asU.query(api.mail.counts, {});
    expect(counts["unread:primary"]).toBe(3);

    await asU.mutation(api.accounts.remove, { accountId });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const leftovers = await t.run(async (ctx) => {
      const threads = await ctx.db
        .query("threads")
        .withIndex("by_account", (q) => q.eq("accountId", accountId))
        .collect();
      const messages = await ctx.db.query("messages").collect();
      return {
        threads: threads.length,
        messages: messages.filter((m) => m.accountId === accountId).length,
      };
    });
    expect(leftovers).toEqual({ threads: 0, messages: 0 });

    counts = await asU.query(api.mail.counts, {});
    expect(counts["unread:primary"]).toBe(1);
    expect(counts[`unread:acct:${accountId}`] ?? 0).toBe(0);
  });
});

describe("randomized counter and listKey invariants", () => {
  test("counters always equal from-scratch recomputation", async () => {
    const t = makeT();
    const asU = t.withIdentity({ subject: USER });
    vi.useFakeTimers();
    const rand = mulberry32(12345);
    const accountId = await seedAccount(t, USER);
    const folders = await seedFolders(t, USER, accountId);
    const catIds: Id<"categories">[] = [];
    for (let i = 0; i < 2; i++) {
      catIds.push(
        await asU.mutation(api.categories.create, {
          name: `cat${i}`,
          description: "d",
          color: "#000000",
        }),
      );
    }

    const pool: Id<"threads">[] = [];
    const trashed: Id<"threads">[] = [];
    const msgIds: string[] = [];
    const pick = <X,>(arr: X[]): X => arr[Math.floor(rand() * arr.length)];

    for (let i = 0; i < 160; i++) {
      const r = rand();
      if (r < 0.4 || pool.length === 0) {
        const refs =
          msgIds.length > 0 && rand() < 0.5
            ? { references: [pick(msgIds)] }
            : {};
        const junk = rand() < 0.1;
        const msg = makeMessage(USER, accountId, {
          folderId: junk ? folders.junk : folders.inbox,
          folderRole: junk ? "junk" : "inbox",
          seen: rand() < 0.6,
          inbox: junk || rand() >= 0.7 ? "other" : "primary",
          flagged: rand() < 0.15,
          ...refs,
        });
        const res = await ingest(t, msg);
        msgIds.push(msg.messageIdHeader);
        if (!pool.includes(res.threadId)) pool.push(res.threadId);
      } else if (r < 0.52) {
        await asU.mutation(api.mail.setRead, {
          threadIds: [pick(pool)],
          read: rand() < 0.7,
        });
      } else if (r < 0.6) {
        await asU.mutation(api.mail.setStarred, {
          threadIds: [pick(pool)],
          starred: rand() < 0.6,
        });
      } else if (r < 0.7) {
        await asU.mutation(api.mail.archive, { threadIds: [pick(pool)] });
      } else if (r < 0.78) {
        await asU.mutation(api.mail.restore, { threadIds: [pick(pool)] });
      } else if (r < 0.86) {
        const tid = pick(pool);
        await asU.mutation(api.mail.trash, { threadIds: [tid] });
        if (!trashed.includes(tid)) trashed.push(tid);
      } else if (r < 0.92) {
        await asU.mutation(api.mail.moveToInbox, {
          threadIds: [pick(pool)],
          inbox: rand() < 0.5 ? "primary" : "other",
        });
      } else if (r < 0.97) {
        await asU.mutation(api.mail.assignCategories, {
          threadIds: [pick(pool)],
          add: rand() < 0.6 ? [pick(catIds)] : undefined,
          remove: rand() < 0.6 ? undefined : [pick(catIds)],
        });
      } else if (trashed.length > 0) {
        const tid = pick(trashed);
        try {
          await asU.mutation(api.mail.deleteForever, { threadIds: [tid] });
          trashed.splice(trashed.indexOf(tid), 1);
          pool.splice(pool.indexOf(tid), 1);
        } catch {
          // Thread no longer in trash; drop it from the trashed pool.
          trashed.splice(trashed.indexOf(tid), 1);
        }
      }
    }

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const threads = await t.run((ctx) =>
      ctx.db.query("threads").collect(),
    );
    const expected = new Map<string, number>();
    const now = Date.now();
    for (const th of threads) {
      for (const key of counterKeys(th)) {
        expected.set(key, (expected.get(key) ?? 0) + 1);
      }
      const expectedListKey =
        th.location === "inbox"
          ? th.snoozedUntil !== undefined && th.snoozedUntil > now
            ? "snoozed"
            : th.inbox
          : th.location;
      expect(th.listKey).toBe(expectedListKey);
      if (th.location === "inbox" && th.listKey !== "snoozed") {
        expect(["primary", "other"]).toContain(th.listKey);
      }
    }
    const counts = await asU.query(api.mail.counts, {});
    expect(nonzero(counts)).toEqual(Object.fromEntries(expected));
  });
});
