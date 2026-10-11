// Integration tests for the sync engine. The IMAP side is an in-memory
// fake implementing the real ImapPort contract (no sockets, so it runs in
// the edge-runtime test environment); the store side is the real Convex
// schema, mutations and queries executed via convex-test.
import { describe, expect, test } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import { internal, api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  normalizeMessageId,
  parseAddressList,
  parseMessageIdList,
} from "../../convex/lib/addresses";
import { runAccountSync, runPendingOps, type EngineDeps } from "../../convex/lib/syncEngine";
import { makeStorePort } from "../../convex/node/store";
import type { SyncCapabilities } from "../../convex/lib/syncPlan";
import type {
  Classifier,
  FetchedMeta,
  FlagBits,
  ImapPort,
  ParsedMail,
  ParserPort,
  StorePort,
} from "../../convex/lib/ports";
import type { FolderRole } from "../../convex/lib/types";
import { modules, seedAccount } from "../convex/testUtil";

const USER = "user_it";
const OWNER_EMAIL = "me@x.com";

// ---------- test message sources ----------

let sourceCounter = 0;

function mailSource(o: {
  id?: string;
  subject?: string;
  from?: string;
  to?: string;
  date?: string;
  inReplyTo?: string;
  references?: string[];
  headers?: Record<string, string>;
  body?: string;
}): string {
  const id = o.id ?? `m${++sourceCounter}@test`;
  const lines = [
    `Message-ID: <${id}>`,
    `Subject: ${o.subject ?? "hello"}`,
    `From: ${o.from ?? "Sender <sender@x.com>"}`,
    `To: ${o.to ?? OWNER_EMAIL}`,
    `Date: ${o.date ?? "Tue, 14 Nov 2023 22:13:20 +0000"}`,
  ];
  if (o.inReplyTo) lines.push(`In-Reply-To: <${o.inReplyTo}>`);
  if (o.references?.length) {
    lines.push(`References: ${o.references.map((r) => `<${r}>`).join(" ")}`);
  }
  for (const [k, v] of Object.entries(o.headers ?? {})) {
    lines.push(`${k}: ${v}`);
  }
  return lines.join("\r\n") + "\r\n\r\n" + (o.body ?? "body text");
}

function headersOf(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const headEnd = source.search(/\r?\n\r?\n/);
  const head = headEnd === -1 ? source : source.slice(0, headEnd);
  let key = "";
  for (const line of head.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && key) {
      out.set(key, (out.get(key) ?? "") + " " + line.trim());
      continue;
    }
    const i = line.indexOf(":");
    if (i === -1) continue;
    key = line.slice(0, i).trim().toLowerCase();
    out.set(key, line.slice(i + 1).trim());
  }
  return out;
}

function bodyOf(source: string): string {
  const i = source.search(/\r?\n\r?\n/);
  return i === -1 ? "" : source.slice(i + 2).trim();
}

// ---------- fake IMAP ----------

interface ServerMessage {
  uid: number;
  flags: Set<string>;
  source: string;
  date: number;
}

const normFlag = (f: string) => f.replace(/^\\/, "").toLowerCase();

class FakeMailbox {
  uidValidity = 1;
  uidNext = 1;
  // Real servers bump HIGHESTMODSEQ on any mailbox change, including flag
  // stores - the counter models that so CONDSTORE paths are exercised.
  modseq = 0;
  messages = new Map<number, ServerMessage>();

  constructor(
    public path: string,
    public specialUse?: string,
  ) {}

  bump() {
    this.modseq++;
  }

  append(source: string, flags: string[] = [], date?: number): number {
    const uid = this.uidNext++;
    this.messages.set(uid, {
      uid,
      flags: new Set(flags.map(normFlag)),
      source,
      date: date ?? Date.now(),
    });
    this.bump();
    return uid;
  }

  unseen(): number {
    let n = 0;
    for (const m of this.messages.values()) {
      if (!m.flags.has("seen")) n++;
    }
    return n;
  }
}

const ALL_CAPS: SyncCapabilities = {
  condstore: false,
  qresync: false,
  move: false,
  uidplus: true,
  specialUse: true,
};

class FakeImap implements ImapPort {
  caps: SyncCapabilities = { ...ALL_CAPS };
  boxes = new Map<string, FakeMailbox>();

  mailbox(path: string): FakeMailbox {
    const box = this.boxes.get(path);
    if (!box) throw new Error(`no mailbox ${path}`);
    return box;
  }

  add(path: string, specialUse?: string): FakeMailbox {
    const box = new FakeMailbox(path, specialUse);
    this.boxes.set(path, box);
    return box;
  }

  async capabilities() {
    return this.caps;
  }

  async listMailboxes() {
    return [...this.boxes.values()].map((b) => ({
      path: b.path,
      delimiter: "/",
      specialUse: b.specialUse,
    }));
  }

  async status(path: string) {
    const box = this.boxes.get(path);
    if (!box) return null;
    return {
      uidValidity: box.uidValidity,
      uidNext: box.uidNext,
      highestModseq: String(box.modseq),
      messages: box.messages.size,
      unseen: box.unseen(),
    };
  }

  async searchUids(path: string, opts?: { minUid?: number; maxUid?: number }) {
    const box = this.boxes.get(path);
    if (!box) return [];
    return [...box.messages.keys()]
      .filter(
        (u) =>
          (opts?.minUid === undefined || u >= opts.minUid) &&
          (opts?.maxUid === undefined || u <= opts.maxUid),
      )
      .sort((a, b) => a - b);
  }

  async searchText(path: string, query: string) {
    const box = this.boxes.get(path);
    if (!box) return [];
    const q = query.toLowerCase();
    return [...box.messages.values()]
      .filter((m) => m.source.toLowerCase().includes(q))
      .map((m) => m.uid)
      .sort((a, b) => a - b);
  }

  private metaFor(m: ServerMessage): FetchedMeta {
    const h = headersOf(m.source);
    const get = (k: string) => h.get(k);
    const listUnsub = !!get("list-unsubscribe");
    const listId = get("list-id");
    const precedence = get("precedence");
    const autoSubmitted = get("auto-submitted");
    const mid = normalizeMessageId(get("message-id"));
    const irt = get("in-reply-to")?.match(/<[^>]+>/)?.[0];
    return {
      uid: m.uid,
      flags: {
        seen: m.flags.has("seen"),
        flagged: m.flags.has("flagged"),
        answered: m.flags.has("answered"),
      },
      messageIdHeader: mid || `uid-${m.uid}-${m.date}`,
      inReplyTo: irt ? normalizeMessageId(irt) : undefined,
      references: parseMessageIdList(get("references")),
      subject: get("subject") ?? "",
      from: parseAddressList(get("from"))[0] ?? { email: "" },
      to: parseAddressList(get("to")),
      cc: parseAddressList(get("cc")),
      bcc: parseAddressList(get("bcc")),
      replyTo: parseAddressList(get("reply-to")),
      date: Date.parse(get("date") ?? "") || m.date,
      size: m.source.length,
      bulk:
        listUnsub ||
        !!listId ||
        /bulk|list|junk/i.test(precedence ?? "") ||
        (!!autoSubmitted && !/^no$/i.test(autoSubmitted)),
      headers: { listUnsubscribe: listUnsub, listId, precedence, autoSubmitted },
      postDraftId: get("x-post-draft-id") || undefined,
      hasAttachments: /multipart\/mixed/i.test(get("content-type") ?? ""),
      attachments: [],
      textPartId: "1",
    };
  }

  async *fetchMeta(path: string, uids: number[]) {
    const box = this.boxes.get(path);
    if (!box) return;
    for (const uid of uids) {
      const m = box.messages.get(uid);
      if (m) yield this.metaFor(m);
    }
  }

  fetchFlagsCalls = 0;

  async *fetchFlags(path: string) {
    this.fetchFlagsCalls++;
    const box = this.boxes.get(path);
    if (!box) return;
    for (const m of box.messages.values()) {
      yield {
        uid: m.uid,
        flags: {
          seen: m.flags.has("seen"),
          flagged: m.flags.has("flagged"),
          answered: m.flags.has("answered"),
        } satisfies FlagBits,
      };
    }
  }

  async fetchSource(path: string, uid: number) {
    const m = this.boxes.get(path)?.messages.get(uid);
    if (!m) throw new Error("message gone");
    return new TextEncoder().encode(m.source);
  }

  async fetchPart(path: string, uid: number) {
    return this.fetchSource(path, uid);
  }

  async storeFlags(
    path: string,
    uids: number[],
    add: string[],
    remove: string[],
  ) {
    const box = this.boxes.get(path);
    if (!box) return;
    for (const uid of uids) {
      const m = box.messages.get(uid);
      if (!m) continue;
      for (const f of add) m.flags.add(normFlag(f));
      for (const f of remove) m.flags.delete(normFlag(f));
      box.bump();
    }
  }

  async moveOrCopy(
    path: string,
    uids: number[],
    targetPath: string,
    canMove: boolean,
  ) {
    const src = this.boxes.get(path);
    const dst = this.boxes.get(targetPath) ?? this.add(targetPath);
    const map = new Map<number, number>();
    for (const uid of uids) {
      const m = src?.messages.get(uid);
      if (!m) continue;
      const newUid = dst.uidNext++;
      dst.messages.set(newUid, { ...m, uid: newUid });
      dst.bump();
      map.set(uid, newUid);
      // MOVE deletes the source; the COPY fallback in FlowPort does
      // COPY + delete, so both paths remove the original.
      void canMove;
      src!.messages.delete(uid);
      src!.bump();
    }
    return map;
  }

  async expunge(path: string, uids: number[]) {
    const box = this.boxes.get(path);
    if (!box) return;
    for (const uid of uids) {
      if (box.messages.delete(uid)) box.bump();
    }
  }

  async append(path: string, source: Uint8Array | string, flags: string[]) {
    const box = this.boxes.get(path) ?? this.add(path);
    const s =
      typeof source === "string" ? source : new TextDecoder().decode(source);
    return { uid: box.append(s, flags) };
  }

  async createMailbox(path: string) {
    if (!this.boxes.has(path)) this.add(path);
  }

  async close() {}

  // test-only server-side operations
  serverMove(path: string, uid: number, targetPath: string): number {
    const srcBox = this.mailbox(path);
    const dst = this.boxes.get(targetPath) ?? this.add(targetPath);
    const m = srcBox.messages.get(uid);
    if (!m) throw new Error("no such uid");
    const newUid = dst.uidNext++;
    dst.messages.set(newUid, { ...m, uid: newUid });
    dst.bump();
    srcBox.messages.delete(uid);
    srcBox.bump();
    return newUid;
  }

  serverDelete(path: string, uid: number) {
    const box = this.mailbox(path);
    if (box.messages.delete(uid)) box.bump();
  }

  serverSetFlags(path: string, uid: number, add: string[], remove: string[]) {
    const box = this.mailbox(path);
    const m = box.messages.get(uid);
    if (!m) throw new Error("no such uid");
    for (const f of add) m.flags.add(normFlag(f));
    for (const f of remove) m.flags.delete(normFlag(f));
    box.bump();
  }

  // Simulates a server dropping UID validity and renumbering.
  serverRenumber(path: string, uidValidity: number, sources: string[]) {
    const box = this.mailbox(path);
    box.uidValidity = uidValidity;
    box.messages.clear();
    box.uidNext = 100;
    for (const s of sources) box.append(s);
  }
}

// ---------- tiny parser port (test-only sources are simple) ----------

const parser: ParserPort = {
  async parse(source): Promise<ParsedMail> {
    const s =
      typeof source === "string" ? source : new TextDecoder().decode(source);
    const h = headersOf(s);
    const get = (k: string) => h.get(k);
    return {
      subject: get("subject") ?? "",
      from: parseAddressList(get("from"))[0] ?? { email: "" },
      to: parseAddressList(get("to")),
      cc: parseAddressList(get("cc")),
      bcc: parseAddressList(get("bcc")),
      replyTo: parseAddressList(get("reply-to")),
      date: Date.parse(get("date") ?? "") || undefined,
      messageIdHeader: normalizeMessageId(get("message-id")) || undefined,
      inReplyTo: normalizeMessageId(get("in-reply-to")) || undefined,
      references: parseMessageIdList(get("references")),
      text: bodyOf(s),
      attachments: [],
      headers: {},
    };
  },
  async decodePart(data) {
    return new TextDecoder().decode(data);
  },
};

// ---------- convex-test store port ----------

const classifyCalls: string[] = [];
const classify: Classifier = async (item) => {
  classifyCalls.push(item.request.email.subject);
  return {
    inbox: /promo|newsletter/i.test(item.request.email.subject)
      ? "other"
      : "primary",
    categoryIds: [],
    classifiedBy: "jev",
    needsRetry: false,
  };
};

type T = ReturnType<typeof convexTest>;

// Reuse the real makeStorePort so the same runQuery/runMutation mapping
// the production actions use is exercised against convex-test.
function storeFor(t: T, accountId: Id<"accounts">): StorePort {
  const ctx = {
    runQuery: t.query.bind(t),
    runMutation: t.mutation.bind(t),
  } as Parameters<typeof makeStorePort>[0];
  return makeStorePort(ctx, accountId);
}

async function world(opts?: { caps?: Partial<SyncCapabilities> }) {
  const t = convexTest(schema, modules);
  const accountId = await seedAccount(t, USER, OWNER_EMAIL);
  const imap = new FakeImap();
  Object.assign(imap.caps, opts?.caps ?? {});
  for (const [path, su] of [
    ["INBOX", undefined],
    ["Sent", "\\Sent"],
    ["Drafts", "\\Drafts"],
    ["Archive", "\\Archive"],
    ["Trash", "\\Trash"],
    ["Junk", "\\Junk"],
  ] as const) {
    imap.add(path, su);
  }
  const now = { t: 1_700_000_000_000 };
  const deps: EngineDeps = {
    accountId: String(accountId),
    imap,
    store: storeFor(t, accountId),
    parser,
    classify,
    now: () => now.t,
    log: process.env.E2E_DEBUG ? console.log : () => {},
  };
  classifyCalls.length = 0;
  return { t, accountId, imap, deps, now };
}

async function allMessages(t: T) {
  return await t.run((ctx) => ctx.db.query("messages").collect());
}

async function allFolders(t: T) {
  return await t.run((ctx) => ctx.db.query("folders").collect());
}

async function folderByRole(t: T, accountId: Id<"accounts">, role: string) {
  const folders = await allFolders(t);
  return folders.find(
    (f) => f.accountId === accountId && f.role === (role as FolderRole),
  )!;
}

async function threadById(t: T, threadId: Id<"threads">) {
  const threads = await t.run((ctx) => ctx.db.query("threads").collect());
  return threads.find((th) => th._id === threadId)!;
}

// ---------- tests ----------

describe("sync engine integration (fake IMAP, real Convex)", () => {
  test("initial sync discovers folders and ingests a window", async () => {
    const { t, accountId, imap, deps } = await world();
    imap.mailbox("INBOX").append(
      mailSource({ id: "a@t", subject: "Welcome aboard" }),
      ["\\Seen"],
    );
    imap.mailbox("INBOX").append(
      mailSource({ id: "p@t", subject: "promo sale ends today" }),
      [],
    );
    imap
      .mailbox("Sent")
      .append(
        mailSource({ id: "s@t", subject: "mine", from: OWNER_EMAIL }),
        ["\\Seen"],
      );

    const outcome = await runAccountSync(deps);

    const msgs = await allMessages(t);
    expect(msgs).toHaveLength(3);
    expect(outcome.newMessages).toBe(3);

    const promo = msgs.find((m) => m.subject.includes("promo"))!;
    expect(promo.inbox).toBe("other");
    expect(promo.classifiedBy).toBe("jev");
    expect(classifyCalls).toContain("promo sale ends today");

    const outbound = msgs.find((m) => m.subject === "mine")!;
    expect(outbound.isOutbound).toBe(true);
    expect(outbound.inbox).toBeUndefined();

    const inboxFolder = await folderByRole(t, accountId, "inbox");
    expect(inboxFolder.syncedUids).toBe("1-2");
    expect(inboxFolder.flags).toHaveLength(2);
    expect(inboxFolder.uidNext).toBe(3);

    const sentFolder = await folderByRole(t, accountId, "sent");
    expect(sentFolder.syncedUids).toBe("1");

    const account = await t.run((ctx) => ctx.db.get(accountId));
    expect(account!.initialSyncDone).toBe(true);
  });

  test("a second unchanged run writes nothing new", async () => {
    const { t, imap, deps } = await world();
    imap.mailbox("INBOX").append(mailSource({ id: "a@t" }), ["\\Seen"]);
    await runAccountSync(deps);

    // Regression: an unchanged sync must produce zero document writes.
    // The initial ingest already captured full flags (stamping
    // lastFlagsFullAt), so no follow-up flag pass or account/folder patch
    // should run at all.
    const writes: string[] = [];
    for (const name of [
      "ingestBatch",
      "patchFolderState",
      "applyFlagChanges",
      "relocateMessages",
      "deleteMessages",
      "applyMoveResults",
      "updateAccount",
      "upsertFolder",
      "markDiscovery",
    ] as const) {
      const orig = deps.store[name].bind(deps.store) as (
        ...a: unknown[]
      ) => Promise<unknown>;
      (deps.store as unknown as Record<string, unknown>)[name] = (
        ...a: unknown[]
      ) => {
        writes.push(`${name}(${JSON.stringify(a[0]).slice(0, 120)})`);
        return orig(...a);
      };
    }

    const second = await runAccountSync(deps);
    expect(second.newMessages).toBe(0);
    expect(second.vanished).toBe(0);
    expect(await allMessages(t)).toHaveLength(1);
    expect(writes).toEqual([]);
  });

  test("a CONDSTORE flag pass with no local diff still advances stored modseq", async () => {
    const { t, accountId, imap, deps } = await world({
      caps: { condstore: true },
    });
    const uid = imap.mailbox("INBOX").append(mailSource({ id: "a@t" }), []);
    await runAccountSync(deps);
    const inbox = await folderByRole(t, accountId, "inbox");

    // Another client flags the message; a pending op (or optimistic write)
    // has already applied the same flag locally, so the flag pass finds no
    // doc-level diff. The stored highestModseq must still advance or every
    // later sync would repeat the CONDSTORE fetch.
    imap.serverSetFlags("INBOX", uid, ["\\Seen"], []);
    await t.run(async (ctx) => {
      const folder = await ctx.db.get(inbox._id);
      const m = await ctx.db
        .query("messages")
        .withIndex("by_folder_uid", (q) =>
          q.eq("folderId", inbox._id).eq("uid", uid),
        )
        .first();
      await ctx.db.patch(m!._id, { seen: true });
      await ctx.db.patch(inbox._id, { flags: "1" });
      void folder;
    });

    const before = imap.fetchFlagsCalls;
    await runAccountSync(deps);
    const mid = await folderByRole(t, accountId, "inbox");
    const serverModseq = String(imap.mailbox("INBOX").modseq);
    expect(mid.highestModseq).toBe(serverModseq);
    expect(mid.unseen).toBe(0);

    // The follow-up run must not refetch flags at all.
    await runAccountSync(deps);
    expect(imap.fetchFlagsCalls).toBe(before + 1);
  });

  test("new mail arrival is ingested on the next sync", async () => {
    const { t, imap, deps } = await world();
    imap.mailbox("INBOX").append(mailSource({ id: "a@t" }), ["\\Seen"]);
    await runAccountSync(deps);

    const uid = imap
      .mailbox("INBOX")
      .append(mailSource({ id: "new@t", subject: "just landed" }));
    const outcome = await runAccountSync(deps);
    expect(outcome.newMessages).toBe(1);
    const msgs = await allMessages(t);
    const fresh = msgs.find((m) => m.subject === "just landed")!;
    expect(fresh.uid).toBe(uid);
  });

  test("external flag changes propagate to docs and threads", async () => {
    const { t, imap, deps } = await world();
    const uid = imap
      .mailbox("INBOX")
      .append(mailSource({ id: "a@t", subject: "flag me" }));
    await runAccountSync(deps);

    let doc = (await allMessages(t))[0];
    expect(doc.seen).toBe(false);

    // Another client marks it read and starred.
    imap.serverSetFlags("INBOX", uid, ["\\Seen", "\\Flagged"], []);
    const outcome = await runAccountSync(deps);
    expect(outcome.flagChanges).toBeGreaterThan(0);

    doc = (await allMessages(t))[0];
    expect(doc.seen).toBe(true);
    expect(doc.flagged).toBe(true);
    const thread = await threadById(t, doc.threadId);
    expect(thread.starred).toBe(true);
    expect(thread.unread).toBe(false);
  });

  test("external INBOX->Archive move relocates and keeps classification", async () => {
    const { t, accountId, imap, deps } = await world();
    const uid = imap
      .mailbox("INBOX")
      .append(
        mailSource({ id: "mv@t", subject: "promo newsletter offer" }),
        ["\\Seen"],
      );
    await runAccountSync(deps);
    const before = (await allMessages(t))[0];
    expect(before.folderRole).toBe("inbox");
    expect(before.inbox).toBe("other");

    const newUid = imap.serverMove("INBOX", uid, "Archive");
    await runAccountSync(deps);

    const msgs = await allMessages(t);
    expect(msgs).toHaveLength(1);
    const moved = msgs[0];
    expect(moved._id).toBe(before._id);
    expect(moved.uid).toBe(newUid);
    expect(moved.folderRole).toBe("archive");
    expect(moved.inbox).toBe("other");

    const archive = await folderByRole(t, accountId, "archive");
    expect(moved.folderId).toBe(archive._id);
    // The relocated UID must be registered as synced in the target folder;
    // otherwise pending ops cannot resolve its remote location.
    expect(archive.syncedUids).toBe(String(newUid));
    const thread = await threadById(t, moved.threadId);
    expect(thread.location).toBe("archive");
  });

  test("trash op after an external move really moves on the server", async () => {
    // Regression: a relocated UID that never landed in the target folder's
    // syncedUids made remotePathFor fall back to the optimistic folderPath
    // (the target itself), so the move op was skipped as already done.
    const { t, accountId, imap, deps, now } = await world();
    const uid = imap
      .mailbox("INBOX")
      .append(mailSource({ id: "tr@t", subject: "promo newsletter offer" }));
    await runAccountSync(deps);
    imap.serverMove("INBOX", uid, "Archive");
    await runAccountSync(deps);
    const doc = (await allMessages(t))[0];
    expect(doc.folderRole).toBe("archive");

    await t
      .withIdentity({ subject: USER })
      .mutation(api.mail.trash, { messageIds: [doc._id] });
    now.t = Date.now(); // ops enqueue with real-time nextAttemptAt
    const outcome = await runAccountSync(deps);
    expect(outcome.opsProcessed).toBe(1);
    expect(imap.mailbox("Archive").messages.size).toBe(0);
    expect(imap.mailbox("Trash").messages.size).toBe(1);
    expect(doc.uid !== undefined).toBe(true);
    const trashed = (await allMessages(t))[0];
    expect(trashed.folderRole).toBe("trash");
    const trash = await folderByRole(t, accountId, "trash");
    expect(trash.syncedUids).toBe(String(trashed.uid));
  });

  test("external move to a folder created after discovery relocates", async () => {
    const { t, accountId, imap, deps } = await world();
    const uid = imap
      .mailbox("INBOX")
      .append(mailSource({ id: "mv2@t", subject: "promo newsletter offer" }));
    await runAccountSync(deps);
    const before = (await allMessages(t))[0];
    expect(before.folderRole).toBe("inbox");

    // Folder roles are unique per account; drop the pre-seeded Archive so
    // the externally created folder can take the role (as on Ethereal).
    imap.boxes.delete("Archive");
    await t.run(async (ctx) => {
      const rows = await ctx.db
        .query("folders")
        .withIndex("by_account_role", (q) =>
          q.eq("accountId", accountId).eq("role", "archive"),
        )
        .collect();
      for (const r of rows) await ctx.db.delete(r._id);
      return rows.length;
    });

    // Another client creates a brand-new folder and moves the message there
    // between discovery runs; the sync must still find it.
    const newUid = imap.serverMove("INBOX", uid, "Archives");
    await runAccountSync(deps);

    const msgs = await allMessages(t);
    expect(msgs).toHaveLength(1);
    const moved = msgs[0];
    expect(moved._id).toBe(before._id);
    expect(moved.uid).toBe(newUid);
    expect(moved.inbox).toBe("other");
    const folders = await allFolders(t);
    const target = folders.find((f) => f.path === "Archives")!;
    expect(target.role).toBe("archive");
    expect(moved.folderId).toBe(target._id);
  });

  test("external deletion removes the doc and its thread", async () => {
    const { t, imap, deps } = await world();
    const uid = imap.mailbox("INBOX").append(mailSource({ id: "d@t" }));
    await runAccountSync(deps);
    expect(await allMessages(t)).toHaveLength(1);

    imap.serverDelete("INBOX", uid);
    const outcome = await runAccountSync(deps);
    expect(outcome.vanished).toBe(1);
    expect(await allMessages(t)).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.query("threads").collect()),
    ).toHaveLength(0);
  });

  test("UIDVALIDITY change remaps by Message-ID and drops the missing", async () => {
    const { t, accountId, imap, deps } = await world();
    const keepSrc = mailSource({ id: "keep@t", subject: "still here" });
    imap.mailbox("INBOX").append(keepSrc, ["\\Seen"]);
    imap.mailbox("INBOX").append(mailSource({ id: "gone@t" }), ["\\Seen"]);
    await runAccountSync(deps);
    expect(await allMessages(t)).toHaveLength(2);

    // Server invalidates UIDs: same messages renumber from 100, "gone" lost.
    imap.serverRenumber("INBOX", 42, [keepSrc]);
    await runAccountSync(deps);

    const msgs = await allMessages(t);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].messageIdHeader).toBe("keep@t");
    expect(msgs[0].uid).toBe(100);
    const inbox = await folderByRole(t, accountId, "inbox");
    expect(inbox.uidValidity).toBe(42);
    expect(inbox.syncedUids).toBe("100");
  });

  test("archive pending op round-trips through COPYUID remap", async () => {
    const { t, accountId, imap, deps } = await world({
      caps: { move: false, uidplus: true },
    });
    const uid = imap
      .mailbox("INBOX")
      .append(mailSource({ id: "op@t" }), ["\\Seen"]);
    await runAccountSync(deps);
    const doc = (await allMessages(t))[0];

    await t.run((ctx) =>
      ctx.db.insert("pendingOps", {
        userId: USER,
        accountId,
        kind: "move",
        payload: {
          moves: [
            {
              folderPath: "INBOX",
              uid,
              targetRole: "archive",
              messageId: doc._id,
            },
          ],
        },
        attempts: 0,
        nextAttemptAt: 0,
        createdAt: 0,
      }),
    );

    const outcome = await runAccountSync(deps);
    expect(outcome.opsProcessed).toBe(1);

    const after = (await allMessages(t))[0];
    expect(after.folderRole).toBe("archive");
    const archive = await folderByRole(t, accountId, "archive");
    expect(after.folderId).toBe(archive._id);
    const newUid = after.uid!;
    // Server really moved it (UIDs are per-mailbox, so it may coincide
    // numerically with the old one).
    expect(imap.mailbox("INBOX").messages.size).toBe(0);
    expect(imap.mailbox("Archive").messages.has(newUid)).toBe(true);
    // Folder state was patched in the same mutation: the next sync sees no
    // surprise arrival or vanish for this message.
    const inboxAfter = await folderByRole(t, accountId, "inbox");
    expect(inboxAfter.syncedUids).not.toContain(String(uid));
    expect(
      await t.run((ctx) => ctx.db.query("pendingOps").collect()),
    ).toHaveLength(0);
  });

  test("archive via the public mutation really moves on the server", async () => {
    // Regression: mail.archive patches folderRole optimistically; the move
    // op must resolve the remote location from folder state, not the doc.
    const { t, imap, deps, now } = await world({ caps: { move: true } });
    imap
      .mailbox("INBOX")
      .append(mailSource({ id: "op2@t" }), ["\\Seen"]);
    await runAccountSync(deps);
    const doc = (await allMessages(t))[0];

    await t
      .withIdentity({ subject: USER })
      .mutation(api.mail.archive, { messageIds: [doc._id] });

    // Doc is already patched to the target role before the op runs.
    const optimistic = (await allMessages(t))[0];
    expect(optimistic.folderRole).toBe("archive");

    now.t = Date.now(); // ops enqueue with real-time nextAttemptAt
    const outcome = await runAccountSync(deps);
    expect(outcome.opsProcessed).toBe(1);
    expect(imap.mailbox("INBOX").messages.size).toBe(0);
    expect(
      [...imap.mailbox("Archive").messages.keys()].length,
    ).toBe(1);

    const after = (await allMessages(t))[0];
    expect(after.folderRole).toBe("archive");
    const next = await runAccountSync(deps);
    expect(next.vanished).toBe(0);
    expect(next.newMessages).toBe(0);
  });

  test("archive op still runs when the target folder already holds the same uid number", async () => {
    // Regression: UIDs are per-mailbox. When Archive already tracks uid 1,
    // archiving INBOX's uid 1 used to be skipped as "already moved" because
    // remotePathFor matched the wrong mailbox's syncedUids.
    const { t, accountId, imap, deps, now } = await world({
      caps: { move: true },
    });
    const uid = imap
      .mailbox("INBOX")
      .append(mailSource({ id: "col@t", subject: "collide me" }), ["\\Seen"]);
    imap
      .mailbox("Archive")
      .append(mailSource({ id: "other@t", subject: "already there" }));
    await runAccountSync(deps);
    const archive0 = await folderByRole(t, accountId, "archive");
    expect(archive0.syncedUids).toBe("1");

    const doc = (await allMessages(t)).find((m) => m.subject === "collide me")!;
    expect(doc.uid).toBe(uid);
    await t
      .withIdentity({ subject: USER })
      .mutation(api.mail.archive, { messageIds: [doc._id] });
    now.t = Date.now();
    const outcome = await runAccountSync(deps);
    expect(outcome.opsProcessed).toBe(1);
    expect(imap.mailbox("INBOX").messages.size).toBe(0);
    expect(imap.mailbox("Archive").messages.size).toBe(2);
    const after = (await allMessages(t)).find(
      (m) => m.subject === "collide me",
    )!;
    expect(after.folderRole).toBe("archive");
    const archive1 = await folderByRole(t, accountId, "archive");
    expect(archive1.syncedUids).toContain(String(after.uid));
  });

  test("flags op runs against the uid's real remote folder", async () => {
    // Regression: with a move op queued first, the doc folder is already
    // the target when the flags op executes; STORE must hit the folder
    // where the uid actually lives on the server.
    const { t, imap, deps, now } = await world({ caps: { move: true } });
    imap.mailbox("INBOX").append(mailSource({ id: "fl@t" }), ["\\Seen"]);
    await runAccountSync(deps);
    const doc = (await allMessages(t))[0];

    await t
      .withIdentity({ subject: USER })
      .mutation(api.mail.archive, { messageIds: [doc._id] });
    await t
      .withIdentity({ subject: USER })
      .mutation(api.mail.setRead, { messageIds: [doc._id], read: false });

    now.t = Date.now(); // ops enqueue with real-time nextAttemptAt
    await runAccountSync(deps);

    const archMsg = [...imap.mailbox("Archive").messages.values()][0];
    expect(archMsg.flags.has("\\Seen")).toBe(false);
  });

  test("a local Sent placeholder is upgraded, not duplicated, by sync", async () => {
    const { t, accountId, imap, deps } = await world();
    await runAccountSync(deps);
    const sentFolder = await folderByRole(t, accountId, "sent");

    // completeSend path: a sendLog row, then the local Sent insert.
    const begun = await t.mutation(internal.send.beginSend, {
      userId: USER,
      accountId,
      idempotencyKey: "send-1",
      contentHash: "ch-1",
      messageIdHeader: "sent-copy@t",
    });
    const sendLogId = (begun as { sendLogId: Id<"sendLog"> }).sendLogId;
    await t.mutation(internal.send.completeSend, {
      sendLogId,
      accountId,
      messageIdHeader: "sent-copy@t",
      references: [],
      subject: "out the door",
      from: { email: OWNER_EMAIL },
      to: [{ email: "rcpt@x.com" }],
      cc: [],
      bcc: [],
      text: "hi",
      attachments: [],
    });
    let msgs = await allMessages(t);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].folderId).toBeNull();

    // The appended copy lands in the server Sent folder; the next sync
    // discovers it and upgrades the placeholder instead of duplicating.
    const uid = imap.mailbox("Sent").append(
      mailSource({
        id: "sent-copy@t",
        subject: "out the door",
        from: OWNER_EMAIL,
        to: "rcpt@x.com",
      }),
      ["\\Seen"],
    );
    await runAccountSync(deps);

    msgs = await allMessages(t);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].folderId).toBe(sentFolder._id);
    expect(msgs[0].uid).toBe(uid);
    expect(msgs[0].folderRole).toBe("sent");
  });

  test("flag refreshes never mark unloaded older mail as synced", async () => {
    const { t, accountId, imap, deps, now } = await world();
    for (let i = 0; i < 1000; i++) imap.mailbox("INBOX").append(mailSource({ id: `backfill-${i}@t` }));
    await runAccountSync(deps);
    const before = await folderByRole(t, accountId, "inbox");
    const messages = await allMessages(t);
    expect(messages.length).toBe(300);
    const deferred = messages.filter(m => m.needsClassification);
    expect(deferred).toHaveLength(100);
    expect(deferred.every(m => m.classifyAttempts === 0)).toBe(true);
    expect(deferred.every(m => Array.isArray(m.classificationCategories))).toBe(true);
    expect((await t.query(internal.syncStore.needsClassification, {})).length).toBeGreaterThan(0);
    expect(before.oldestUid).toBe(701);
    expect(before.backfillDone).toBe(false);
    now.t += 11 * 60 * 1000;
    await runAccountSync(deps);
    const after = await folderByRole(t, accountId, "inbox");
    expect(after.syncedUids).toBe(before.syncedUids);
    expect(after.oldestUid).toBe(701);
    expect(after.backfillDone).toBe(false);
    expect((await allMessages(t)).length).toBe(300);
  });

  test("a permanent deletion expunges remote mail after local records disappear", async () => {
    const { t, imap, deps, now } = await world();
    imap.mailbox("Trash").append(mailSource({ id: "delete-forever@t" }));
    await runAccountSync(deps);
    const message = (await allMessages(t))[0];
    await t.withIdentity({ subject: USER }).mutation(api.mail.deleteForever, { threadIds: [message.threadId] });
    expect(await allMessages(t)).toHaveLength(0);
    now.t = Date.now(); // pending operations are enqueued with wall-clock time
    await runAccountSync(deps);
    expect(imap.mailbox("Trash").messages.size).toBe(0);
    expect(await allMessages(t)).toHaveLength(0);
  });

  test("batched moves preserve every source removal and target COPYUID", async () => {
    const { t, accountId, imap, deps, now } = await world();
    for (let i = 0; i < 3; i++) imap.mailbox("INBOX").append(mailSource({ id: `batch-${i}@t` }));
    await runAccountSync(deps);
    const messages = await allMessages(t);
    await t.withIdentity({ subject: USER }).mutation(api.mail.archive, { threadIds: messages.map(m => m.threadId) });
    now.t = Date.now();
    // Assert immediately after the batch, before a full sync can repair it.
    expect(await runPendingOps(deps, imap.caps)).toBe(1);
    expect(imap.mailbox("INBOX").messages.size).toBe(0);
    expect(imap.mailbox("Archive").messages.size).toBe(3);
    expect((await folderByRole(t, accountId, "inbox")).syncedUids).toBe("");
    expect((await folderByRole(t, accountId, "archive")).syncedUids).toBe("1-3");
    expect((await allMessages(t)).map(m => m.folderRole)).toEqual(["archive", "archive", "archive"]);
  });

  test("foreign-client remote drafts are imported only once", async () => {
    const { t, imap, deps, now } = await world();
    imap.mailbox("Drafts").append(mailSource({ id: "foreign-draft@t", from: OWNER_EMAIL }));
    await runAccountSync(deps);
    await runAccountSync(deps); // draft linking uses the persisted folder window
    const before = await t.run(ctx => ctx.db.query("drafts").collect());
    expect(before).toHaveLength(1);
    now.t += 11 * 60 * 1000;
    await runAccountSync(deps);
    const after = await t.run(ctx => ctx.db.query("drafts").collect());
    expect(after).toHaveLength(1);
    expect(after[0]._id).toBe(before[0]._id);
    expect((await t.withIdentity({ subject: USER }).query(api.mail.counts, {})).drafts).toBe(1);
  });
});
