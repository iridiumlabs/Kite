// @vitest-environment node
// In-memory MCP tests: a real SDK Client talks to the real registered server
// over a linked transport pair, with a fake PostBackend behind it.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { McpServer, InMemoryTransport } from "@modelcontextprotocol/server";
import { Client } from "@modelcontextprotocol/client";
import { registerPostTools } from "../../lib/mcp/server";
import type { PostBackend } from "../../lib/mcp/backend";
import type {
  AccountDoc,
  CategoryDoc,
  DraftDoc,
  MessageDoc,
  ThreadDoc,
} from "../../lib/mcp/format";

const EXPECTED_TOOLS = [
  "list_accounts",
  "sync_mailboxes",
  "load_older_emails",
  "get_unread_counts",
  "list_threads",
  "search_emails",
  "get_thread",
  "get_email",
  "get_attachment",
  "send_email",
  "reply_to_email",
  "forward_email",
  "list_drafts",
  "get_draft",
  "create_draft",
  "update_draft",
  "delete_draft",
  "send_draft",
  "cancel_scheduled_send",
  "list_uncertain_send_attempts",
  "resolve_uncertain_draft",
  "mark_read",
  "mark_unread",
  "star",
  "unstar",
  "archive",
  "trash",
  "restore",
  "delete_permanently",
  "snooze",
  "move_to_inbox",
  "list_categories",
  "create_category",
  "update_category",
  "delete_category",
  "assign_categories",
];

const account: AccountDoc = {
  _id: "acct1",
  email: "me@example.com",
  displayName: "Me",
  status: "ready",
  initialSyncDone: true,
  lastSyncedAt: 1700000000000,
};

const category: CategoryDoc = {
  _id: "cat1",
  name: "Receipts",
  description: "Purchase receipts",
  color: "#0a84ff",
};

function makeThread(id = "th1"): ThreadDoc {
  return {
    _id: id,
    accountId: "acct1",
    subject: "Hello there",
    participants: [{ name: "Alice", email: "alice@example.com" }],
    messageCount: 1,
    unreadCount: 1,
    unread: true,
    starred: false,
    hasAttachments: false,
    snippet: "hi",
    lastMessageAt: 1700000000000,
    location: "inbox",
    inbox: "primary",
    categoryIds: [],
  };
}

function makeMessage(id: string, threadId = "th1", date = 1700000000000): MessageDoc {
  return {
    _id: id,
    threadId,
    accountId: "acct1",
    folderRole: "inbox",
    subject: "Hello there",
    from: { name: "Alice", email: "alice@example.com" },
    to: [{ email: "me@example.com" }],
    cc: [],
    bcc: [],
    replyTo: [],
    date,
    snippet: "snippet text",
    seen: false,
    flagged: false,
    answered: false,
    isOutbound: false,
    hasAttachments: false,
    attachments: [],
    inbox: "primary",
    categoryIds: [],
  };
}

function makeBackend(): PostBackend & {
  calls: { m: string; args: unknown[] }[];
} {
  const calls: { m: string; args: unknown[] }[] = [];
  const rec =
    <T extends unknown[]>(m: string, impl: (...a: T) => unknown) =>
    (...a: T) => {
      calls.push({ m, args: a });
      return impl(...a);
    };
  const backend = {
    calls,
    listAccounts: rec("listAccounts", async () => [account]),
    syncNow: rec("syncNow", async () => ({ scheduled: 1 })),
    loadOlder: rec("loadOlder", async () => ({ scheduled: 1 })),
    listThreads: rec("listThreads", async () => ({
      items: [makeThread()],
      nextCursor: null,
    })),
    searchIndex: rec("searchIndex", async () => [makeMessage("m1")]),
    findMessages: rec("findMessages", async () => ({
      items: [makeMessage("m1")],
      nextCursor: null,
    })),
    deepSearch: rec("deepSearch", async () => [makeMessage("m1")]),
    getThread: rec("getThread", async (threadId: string) => ({
      thread: makeThread(threadId),
      messages: Array.from({ length: 25 }, (_, i) =>
        makeMessage(`m${i}`, threadId, 1700000000000 + i),
      ),
    })),
    getMessage: rec("getMessage", async (id: string) => {
      if (id === "missing") throw new Error("Message not found");
      return makeMessage(id);
    }),
    getMessageContent: rec("getMessageContent", async () => ({
      text: "body text",
      html: "<p>body</p>",
      attachments: [],
    })),
    downloadAttachment: rec(
      "downloadAttachment",
      async (_mid: string, attId: string) => {
        const map: Record<
          string,
          { filename: string; contentType: string; data: ArrayBuffer }
        > = {
          txt: {
            filename: "note.txt",
            contentType: "text/plain",
            data: new TextEncoder().encode("hello attachment").buffer as ArrayBuffer,
          },
          png: {
            filename: "pic.png",
            contentType: "image/png",
            data: new Uint8Array([137, 80, 78, 71]).buffer as ArrayBuffer,
          },
          pdf: {
            filename: "doc.pdf",
            contentType: "application/pdf",
            data: new Uint8Array([37, 80, 68, 70]).buffer as ArrayBuffer,
          },
        };
        const a = map[attId];
        return { ...a, size: a.data.byteLength };
      },
    ),
    counts: rec("counts", async () => ({
      "unread:primary": 3,
      "unread:other": 7,
      "unread:acct:acct1": 10,
      "unread:cat:cat1": 2,
      drafts: 1,
    })),
    sendMessage: rec("sendMessage", async () => ({
      messageId: "m-sent",
      deduped: false,
    })),
    reply: rec("reply", async () => ({ messageId: "m-rep", deduped: false })),
    forward: rec("forward", async () => ({
      messageId: "m-fwd",
      deduped: false,
    })),
    sendDraft: rec("sendDraft", async () => ({
      messageId: "m-dsent",
      deduped: false,
    })),
    listDrafts: rec("listDrafts", async () => ({
      items: [
        {
          _id: "d1",
          accountId: "acct1",
          mode: "new",
          to: [{ email: "bob@example.com" }],
          cc: [],
          bcc: [],
          subject: "draft",
          text: "hi",
          html: "",
          attachments: [],
          status: "uncertain",
          updatedAt: 1700000000000,
        } satisfies DraftDoc,
      ],
      nextCursor: null,
    })),
    getDraft: rec("getDraft", async () => null),
    createDraft: rec("createDraft", async () => "d-new"),
    updateDraft: rec("updateDraft", async () => {}),
    discardDraft: rec("discardDraft", async () => {}),
    scheduleDraft: rec("scheduleDraft", async () => {}),
    cancelScheduledDraft: rec("cancelScheduledDraft", async () => {}),
    uncertainDraftAttempts: rec("uncertainDraftAttempts", async () => []),
    resolveUncertainDraft: rec("resolveUncertainDraft", async (args: { outcome: "delivered" | "notDelivered" }) => ({ outcome: args.outcome })),
    setRead: rec("setRead", async () => {}),
    setStarred: rec("setStarred", async () => {}),
    archive: rec("archive", async () => {}),
    trash: rec("trash", async () => {}),
    restore: rec("restore", async () => {}),
    moveToInbox: rec("moveToInbox", async () => {}),
    assignCategories: rec("assignCategories", async () => {}),
    snooze: rec("snooze", async () => {}),
    deleteForever: rec("deleteForever", async () => {}),
    listCategories: rec("listCategories", async () => [category]),
    createCategory: rec("createCategory", async () => "cat-new"),
    updateCategory: rec("updateCategory", async () => {}),
    removeCategory: rec("removeCategory", async () => {}),
  };
  return backend as PostBackend & {
    calls: { m: string; args: unknown[] }[];
  };
}

let client: Client;
let serverConn: McpServer;
const backend = makeBackend();

beforeAll(async () => {
  const [ct, st] = InMemoryTransport.createLinkedPair();
  serverConn = new McpServer({ name: "post", version: "0.1.0" });
  registerPostTools(serverConn, () => backend);
  await serverConn.connect(st);
  client = new Client({ name: "test", version: "0.0.1" });
  await client.connect(ct);
});

afterAll(async () => {
  await client.close();
  await serverConn.close();
});

function sc(res: { structuredContent?: unknown }): Record<string, unknown> {
  return res.structuredContent as Record<string, unknown>;
}

describe("tool surface", () => {
  it("exposes exactly the specified tool set", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
    for (const t of tools) {
      expect(t.description?.length).toBeGreaterThan(10);
      expect(t.description).not.toContain("—");
      expect(t.title).toBeTruthy();
    }
  });
});

describe("read tools", () => {
  it("uncertain drafts satisfy the list/get tool output schemas", async () => {
    const list = await client.callTool({ name: "list_drafts", arguments: {} });
    expect(list.isError).not.toBe(true);
    expect((sc(list).items as Record<string, unknown>[])[0].status).toBe("uncertain");
    const original = backend.getDraft;
    try {
      const draft = (await backend.listDrafts({ numItems: 50, cursor: null })).items[0];
      backend.getDraft = async () => draft;
      const get = await client.callTool({ name: "get_draft", arguments: { draftId: draft._id } });
      expect(get.isError).not.toBe(true);
      expect(sc(get).status).toBe("uncertain");
    } finally {
      backend.getDraft = original;
    }
  });

  it("list_accounts returns formatted accounts", async () => {
    const res = await client.callTool({ name: "list_accounts", arguments: {} });
    const out = sc(res);
    expect((out.items as Record<string, unknown>[])[0].email).toBe(
      "me@example.com",
    );
    expect((out.items as Record<string, unknown>[])[0].lastSyncedAt).toBe(
      "2023-11-14T22:13:20.000Z",
    );
  });

  it("list_threads formats threads with categories and account email", async () => {
    const res = await client.callTool({
      name: "list_threads",
      arguments: { view: "primary" },
    });
    const out = sc(res);
    const t = (out.items as Record<string, unknown>[])[0];
    expect(t.subject).toBe("Hello there");
    expect(t.accountEmail).toBe("me@example.com");
    expect(t.unread).toBe(true);
    expect(out.nextCursor).toBeNull();
  });

  it("search_emails picks index for free text, filters for structured, server for searchServer", async () => {
    let res = await client.callTool({
      name: "search_emails",
      arguments: { query: "hello" },
    });
    expect(sc(res).source).toBe("index");
    res = await client.callTool({
      name: "search_emails",
      arguments: { from: "alice", unread: true },
    });
    expect(sc(res).source).toBe("filters");
    res = await client.callTool({
      name: "search_emails",
      arguments: { query: "deep term", searchServer: true },
    });
    expect(sc(res).source).toBe("server");
  });

  it("search_emails post-filters free text against subject/snippet", async () => {
    const res = await client.callTool({
      name: "search_emails",
      arguments: { query: "no match here", unread: true },
    });
    expect((sc(res).items as unknown[]).length).toBe(0);
  });

  it("get_thread fetches bodies for only the latest 20 messages", async () => {
    backend.calls.length = 0;
    const res = await client.callTool({
      name: "get_thread",
      arguments: { threadId: "th1" },
    });
    const out = sc(res);
    const messages = out.messages as Record<string, unknown>[];
    expect(messages.length).toBe(25);
    const contentCalls = backend.calls.filter(
      (c) => c.m === "getMessageContent",
    ).length;
    expect(contentCalls).toBe(20);
    expect(messages[24].body).toBeTruthy();
    expect(messages[0].body).toBeUndefined();
  });

  it("get_thread honors includeBodies=false", async () => {
    backend.calls.length = 0;
    const res = await client.callTool({
      name: "get_thread",
      arguments: { threadId: "th1", includeBodies: false },
    });
    const messages = sc(res).messages as Record<string, unknown>[];
    expect(messages.every((m) => m.body === undefined)).toBe(true);
  });

  it("get_email clips the body at maxBodyChars", async () => {
    const res = await client.callTool({
      name: "get_email",
      arguments: { messageId: "m1", maxBodyChars: 100 },
    });
    const body = sc(res).body as Record<string, unknown>;
    expect(body.text).toBe("body text");
    expect(body.truncated).toBe(false);
  });

  it("get_attachment returns text for text-like types", async () => {
    const res = await client.callTool({
      name: "get_attachment",
      arguments: { messageId: "m1", attachmentId: "txt" },
    });
    const out = sc(res);
    expect(out.text).toBe("hello attachment");
    expect(out.filename).toBe("note.txt");
    expect(
      (res.content as { type: string; text?: string }[]).some(
        (c) => c.type === "text" && c.text === "hello attachment" || c.text?.includes("note.txt"),
      ),
    ).toBe(true);
  });

  it("get_attachment returns image content for images", async () => {
    const res = await client.callTool({
      name: "get_attachment",
      arguments: { messageId: "m1", attachmentId: "png" },
    });
    const kinds = (res.content as { type: string }[]).map((c) => c.type);
    expect(kinds).toContain("image");
  });

  it("get_attachment returns a base64 resource for binary types", async () => {
    const res = await client.callTool({
      name: "get_attachment",
      arguments: { messageId: "m1", attachmentId: "pdf" },
    });
    const resItem = (res.content as {
      type: string;
      resource?: { blob: string; mimeType: string };
    }[]).find((c) => c.type === "resource");
    expect(resItem?.resource?.mimeType).toBe("application/pdf");
    expect(atob(resItem!.resource!.blob)).toEqual("%PDF");
  });
});

describe("write tools", () => {
  it("send_email maps addresses and forwards idempotencyKey", async () => {
    backend.calls.length = 0;
    const res = await client.callTool({
      name: "send_email",
      arguments: {
        fromEmail: "me@example.com",
        to: ["Bob <bob@example.com>"],
        subject: "hi",
        text: "hello",
        idempotencyKey: "key-1",
      },
    });
    const out = sc(res);
    expect(out.messageId).toBe("m-sent");
    expect(out.deduplicated).toBe(false);
    const call = backend.calls.find((c) => c.m === "sendMessage")!;
    const a = call.args[0] as Record<string, unknown>;
    expect(a.accountId).toBe("acct1");
    expect(a.to).toEqual([{ name: "Bob", email: "bob@example.com" }]);
    expect(a.idempotencyKey).toBe("key-1");
  });

  it("sending tools expose partial-delivery recipients rather than reporting full success", async () => {
    const send = backend.sendMessage; const draft = backend.sendDraft;
    try {
      backend.sendMessage = async () => ({ messageId: "m-sent", deduped: false, rejectedRecipients: ["rejected@example.com"] });
      backend.sendDraft = async () => ({ messageId: "m-dsent", deduped: true, rejectedRecipients: ["rejected@example.com"] });
      const sent = sc(await client.callTool({ name: "send_email", arguments: { fromEmail: "me@example.com", to: ["ok@example.com", "rejected@example.com"], subject: "Partial" } }));
      expect(sent.rejectedRecipients).toEqual(["rejected@example.com"]);
      const retried = sc(await client.callTool({ name: "send_draft", arguments: { draftId: "d1", idempotencyKey: "same" } }));
      expect(retried.rejectedRecipients).toEqual(["rejected@example.com"]);
      expect(retried.deduplicated).toBe(true);
    } finally { backend.sendMessage = send; backend.sendDraft = draft; }
  });

  it("uncertain-draft resolution requires explicit confirmation and forwards the selected attempt", async () => {
    backend.uncertainDraftAttempts = async () => [{ sendLogId: "log", messageIdHeader: "m@x", createdAt: 1, canConfirmDelivered: true, canConfirmNotDelivered: true }];
    backend.resolveUncertainDraft = async args => { backend.calls.push({ m: "resolveUncertainDraft", args: [args] }); return { outcome: args.outcome }; };
    expect(sc(await client.callTool({ name: "list_uncertain_send_attempts", arguments: { draftId: "d1" } })).attempts).toMatchObject([{ sendLogId: "log" }]);
    const denied = await client.callTool({ name: "resolve_uncertain_draft", arguments: { draftId: "d1", sendLogId: "log", outcome: "notDelivered" } });
    expect(denied.isError).toBe(true);
    const resolved = await client.callTool({ name: "resolve_uncertain_draft", arguments: { draftId: "d1", sendLogId: "log", outcome: "notDelivered", confirmed: true } });
    expect(sc(resolved)).toEqual({ outcome: "notDelivered" });
    expect(backend.calls.find(c => c.m === "resolveUncertainDraft")!.args[0]).toEqual({ draftId: "d1", sendLogId: "log", outcome: "notDelivered", confirmed: true });
  });

  it("send_email resolves a missing account to an error", async () => {
    const res = await client.callTool({
      name: "send_email",
      arguments: {
        fromEmail: "nobody@example.com",
        to: ["bob@example.com"],
        subject: "x",
      },
    });
    expect(res.isError).toBe(true);
    expect(
      (res.content as { text: string }[])[0].text,
    ).toContain("nobody@example.com");
  });

  it("organizing tools resolve messageIds to threadIds and report updated", async () => {
    const res = await client.callTool({
      name: "archive",
      arguments: { threadIds: ["th1"], messageIds: ["m2"] },
    });
    const out = sc(res);
    expect(out.updated).toBe(1); // both resolve to th1
    expect(out.threadIds).toEqual(["th1"]);
  });

  it("bulk limit rejects over 100 ids", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `th${i}`);
    const res = await client.callTool({
      name: "archive",
      arguments: { threadIds: ids },
    });
    expect(res.isError).toBe(true);
  });

  it("bad email input fails validation", async () => {
    const res = await client.callTool({
      name: "send_email",
      arguments: { fromEmail: "me@example.com", to: [{}], subject: "x" },
    });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0].text).toContain(
      "Input validation error",
    );
  });

  it("backend errors surface as isError with the server message", async () => {
    const res = await client.callTool({
      name: "get_email",
      arguments: { messageId: "missing" },
    });
    expect(res.isError).toBe(true);
    expect((res.content as { text: string }[])[0].text).toContain(
      "Message not found",
    );
  });

  it("move_to_inbox and snooze reach the backend", async () => {
    backend.calls.length = 0;
    await client.callTool({
      name: "move_to_inbox",
      arguments: { threadIds: ["th1"], inbox: "other" },
    });
    const mv = backend.calls.find((c) => c.m === "moveToInbox")!;
    expect(mv.args[1]).toBe("other");
    await client.callTool({
      name: "snooze",
      arguments: { threadIds: ["th1"], until: "2030-01-01T00:00:00Z" },
    });
    const sn = backend.calls.find((c) => c.m === "snooze")!;
    expect(sn.args[1]).toBe(Date.parse("2030-01-01T00:00:00Z"));
  });

  it("get_unread_counts splits counter keys by scope", async () => {
    const res = await client.callTool({
      name: "get_unread_counts",
      arguments: {},
    });
    const out = sc(res);
    expect(out.primary).toBe(3);
    expect(out.other).toBe(7);
    expect(out.drafts).toBe(1);
    expect(
      (out.byAccount as { email: string; unread: number }[])[0],
    ).toEqual({ accountId: "acct1", email: "me@example.com", unread: 10 });
    expect(
      (out.byCategory as { name: string; unread: number }[])[0],
    ).toEqual({ categoryId: "cat1", name: "Receipts", unread: 2 });
  });
});
