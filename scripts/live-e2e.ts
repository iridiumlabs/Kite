// Live wire-level E2E for Kite's IMAP/SMTP engine against Ethereal.Email
// (real SMTP + IMAP) and the local anonymous Convex backend at :3210.
//
// Opt-in only — never run by `npm test`. Usage:
//
//   npx tsx scripts/live-e2e.ts
//
// Requires the local backend running (CONVEX_AGENT_MODE=anonymous npx convex dev)
// and CREDENTIALS_ENCRYPTION_KEY set on the deployment. Drives the real
// deployed functions via the deployment admin key acting as user
// "live-e2e-user".

import { ConvexHttpClient } from "convex/browser";
import { ImapFlow, type MessageEnvelopeObject } from "imapflow";
import { type SendMailOptions } from "nodemailer";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";

const CONVEX_URL = "http://127.0.0.1:3210";
const USER = "live-wire-user";
const TAG = `e2e-${Date.now().toString(36)}`;

interface EthAccount {
  user: string;
  pass: string;
}

// ---------- tiny test harness ----------

const failures: string[] = [];
const notes: string[] = [];

function ok(name: string, cond: unknown, detail?: string) {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    console.log(`  FAIL ${name}${detail ? ` -- ${detail}` : ""}`);
    failures.push(name);
  }
}

function note(msg: string) {
  console.log(`  note: ${msg}`);
  notes.push(msg);
}

function step(n: string, title: string) {
  console.log(`\n=== ${n}: ${title} ${"=".repeat(Math.max(0, 60 - title.length))}`);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(
  label: string,
  fn: () => Promise<boolean>,
  timeoutMs = 90_000,
  intervalMs = 1_500,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await fn()) return true;
    await sleep(intervalMs);
  }
  console.log(`  timeout waiting for: ${label}`);
  return false;
}

// ---------- convex client ----------

function makeClient() {
  const cfgPath = path.join(".convex", "local", "default", "config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const adminKey: string =
    cfg.adminKey ??
    (Array.isArray(cfg.backends) && cfg.backends[0]?.adminKey) ??
    "";
  if (!adminKey) throw new Error(`No adminKey in ${cfgPath}`);
  const client = new ConvexHttpClient(CONVEX_URL, {
    skipConvexDeploymentUrlCheck: true,
  });
  (client as unknown as { setAdminAuth(k: string, i: object): void }).setAdminAuth(
    adminKey,
    { subject: USER, issuer: "live-e2e" },
  );
  return client;
}

type AnyArgs = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = any;

const client = makeClient();
const q = (p: string, args: AnyArgs = {}): Promise<AnyResult> =>
  client.query(p as never, args as never);
const mu = (p: string, args: AnyArgs = {}): Promise<AnyResult> =>
  client.mutation(p as never, args as never);
const act = (p: string, args: AnyArgs = {}): Promise<AnyResult> =>
  client.action(p as never, args as never);

const state = {
  account: (email: string) =>
    q("liveSupport:accountForUser", { userId: USER, email }),
  folders: (accountId: string) =>
    q("liveSupport:foldersForAccount", { accountId }),
  messages: (accountId: string) =>
    q("liveSupport:messagesForAccount", { accountId }),
  threads: (accountId: string) =>
    q("liveSupport:threadsForAccount", { accountId }),
  ops: (accountId: string) =>
    q("liveSupport:opsForAccount", { accountId }),
  sendLog: (accountId: string) =>
    q("liveSupport:sendLogForAccount", { accountId }),
  drafts: (accountId: string) =>
    q("liveSupport:draftsForAccount", { accountId }),
  docs: () =>
    q("liveSupport:docsForUser", { userId: USER }) as Promise<
      Record<string, number>
    >,
  snapshot: () =>
    q("liveSupport:snapshotForUser", { userId: USER }) as Promise<
      Record<string, AnyResult[]>
    >,
  counters: () => q("liveSupport:countersForUser", { userId: USER }),
};

// ---------- imap helpers ----------

const IMAP = { host: "imap.ethereal.email", port: 993 };

async function withImap<T>(
  acc: EthAccount,
  fn: (imap: ImapFlow) => Promise<T>,
): Promise<T> {
  const imap = new ImapFlow({
    host: IMAP.host,
    port: IMAP.port,
    secure: true,
    auth: { user: acc.user, pass: acc.pass },
    logger: false,
  });
  await imap.connect();
  try {
    return await fn(imap);
  } finally {
    await imap.logout().catch(() => {});
  }
}

async function serverFind(
  imap: ImapFlow,
  subject: string,
): Promise<{
  folder: string;
  uid: number;
  flags: Set<string>;
  envelope: MessageEnvelopeObject;
} | null> {
  const list = await imap.list();
  for (const box of list) {
    const lock = await imap.getMailboxLock(box.path);
    try {
      for await (const m of imap.fetch("1:*", {
        uid: true,
        flags: true,
        envelope: true,
      })) {
        if (m.envelope?.subject === subject) {
          return { folder: box.path, uid: m.uid, flags: m.flags ?? new Set(), envelope: m.envelope };
        }
      }
    } finally {
      lock.release();
    }
  }
  return null;
}

async function folderStatus(imap: ImapFlow, path: string) {
  try {
    const st = await imap.status(path, { messages: true, uidNext: true });
    return st || null;
  } catch {
    return null;
  }
}

async function subjectsIn(imap: ImapFlow, path: string): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const lock = await imap.getMailboxLock(path);
  try {
    for await (const m of imap.fetch("1:*", { uid: true, envelope: true })) {
      if (m.envelope?.subject) out.set(m.envelope.subject, m.uid);
    }
  } finally {
    lock.release();
  }
  return out;
}

type Mail = SendMailOptions;

const require_ = createRequire(import.meta.url);

// nodemailer.createTestAccount caches its first account process-wide
// (ETHEREAL_CACHE defaults to "yes"), so hit the API directly to get two
// distinct mailboxes.
function createEtherealAccount(): Promise<EthAccount> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ requestor: "kite-live-e2e", version: "1.0" });
    const req = require_("node:https").request(
      {
        hostname: "api.nodemailer.com",
        path: "/user",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res: { on(e: string, cb: (c?: Buffer) => void): void }) => {
        let buf = "";
        res.on("data", (c?: Buffer) => (buf += c));
        res.on("end", () => {
          try {
            const j = JSON.parse(buf);
            if (!j.user || !j.pass) reject(new Error(`bad ethereal response: ${buf}`));
            else resolve({ user: j.user, pass: j.pass });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

async function rawMime(mail: Mail): Promise<Buffer> {
  const MailComposer = require_("nodemailer/lib/mail-composer");
  return await new Promise((resolve, reject) => {
    const composer = new MailComposer(mail);
    composer
      .compile()
      .build((err: Error | null, msg: Buffer) => (err ? reject(err) : resolve(msg)));
  });
}

// ---------- doc helpers ----------

function canon(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce((acc: Record<string, unknown>, k) => {
          acc[k] = val[k];
          return acc;
        }, {});
    }
    return val;
  });
}

function snapshotDocs(docs: Record<string, AnyResult[]>): Map<string, string> {
  const m = new Map<string, string>();
  for (const [table, rows] of Object.entries(docs)) {
    for (const d of rows) m.set(`${table}:${d._id}`, canon(d));
  }
  return m;
}

function changedFields(
  beforeJson: string | undefined,
  afterJson: string | undefined,
): { name: string; b: string; a: string }[] {
  const before: Record<string, unknown> = beforeJson ? JSON.parse(beforeJson) : {};
  const after: Record<string, unknown> = afterJson ? JSON.parse(afterJson) : {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: { name: string; b: string; a: string }[] = [];
  for (const k of keys) {
    if (k === "_creationTime" || k === "_id") continue;
    const b = canon(before[k]);
    const a = canon(after[k]);
    if (b !== a) out.push({ name: k, b, a });
  }
  return out;
}

// Folder STATUS fields that legitimately advance when the server side
// changed (including via our own pending ops) without meaning mail docs
// were re-ingested or re-written.
const FOLDER_STATUS_FIELDS = new Set([
  "updatedAt",
  "highestModseq",
  "unseen",
  "messages",
  "uidNext",
  "lastFlagsFullAt",
]);
const ACCOUNT_STATUS_FIELDS = new Set([
  "lastSyncedAt",
  "status",
  "lastError",
  "nextSyncAfter",
  "syncFailCount",
]);

function countDeltas(
  before: Map<string, string>,
  after: Map<string, string>,
  opts: { allowStatusOnly?: boolean } = {},
): { n: number; diffs: string[] } {
  let n = 0;
  const diffs: string[] = [];
  for (const [k, v] of after) {
    if (k.startsWith("syncLocks:")) continue; // lease bookkeeping, not mail docs
    if (before.get(k) === v) continue;
    const changed = changedFields(before.get(k), v);
    const table = k.split(":")[0];
    const allowed =
      opts.allowStatusOnly &&
      changed.length > 0 &&
      ((table === "folders" && changed.every((c) => FOLDER_STATUS_FIELDS.has(c.name))) ||
        (table === "accounts" && changed.every((c) => ACCOUNT_STATUS_FIELDS.has(c.name))));
    if (!allowed) n++;
    diffs.push(
      `${allowed ? "note " : "delta "}${k}: ` +
        changed.map((c) => `${c.name}: ${c.b} -> ${c.a}`).join("; "),
    );
  }
  for (const k of before.keys()) {
    if (!k.startsWith("syncLocks:") && !after.has(k)) {
      n++;
      diffs.push(`deleted ${k}`);
    }
  }
  return { n, diffs };
}

function sha256(buf: Buffer | ArrayBuffer) {
  return createHash("sha256").update(Buffer.from(buf as ArrayBuffer)).digest("hex");
}

async function opsDrained(accountId: string, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ops = await state.ops(accountId);
    if (ops.length === 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        `timeout waiting for: pending ops to drain -- ${JSON.stringify(
          ops.map((o: AnyResult) => ({
            kind: o.kind,
            attempts: o.attempts,
            lastError: o.lastError,
          })),
        )}`,
      );
    }
    for (const o of ops) {
      note(`  op pending: ${o.kind} attempts=${o.attempts} err=${o.lastError ?? "-"}`);
    }
    await sleep(1_500);
  }
}

async function runSync(accountId: string) {
  // Retry while a previous run holds the lease.
  const deadline = Date.now() + 120_000;
  let last: AnyResult;
  for (;;) {
    last = await act("node/sync:syncAccount", { accountId });
    if (!last?.skipped) return last;
    if (Date.now() > deadline) return last;
    await sleep(2_000);
  }
}

// ---------- payload builders ----------

const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n" +
    "2 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 40 40 Td (kite live e2e) Tj ET\n" +
    "endstream\nendobj\ntrailer\n<< /Size 3 /Root 1 0 R >>\n%%EOF\n",
);

const SUB = {
  personal: `${TAG} personal hello`,
  news: `${TAG} weekly digest`,
  attach: `${TAG} document and image`,
  sanitize: `${TAG} html sample`,
  outbound: `${TAG} outbound`,
  draft: `${TAG} draft subject`,
};

function seedMails(B: EthAccount, A: EthAccount): Mail[] {
  return [
    {
      from: { name: "Bob Sender", address: B.user },
      to: A.user,
      subject: SUB.personal,
      text: "Hi there, a genuinely personal note about our quixotic weekend plan. Reply when you can.",
      messageId: `<${TAG}-a@ethereal>`,
    },
    {
      from: { name: "Acme Weekly", address: B.user },
      to: A.user,
      subject: SUB.news,
      headers: {
        "List-Unsubscribe": "<mailto:unsub@acme.example>",
        Precedence: "bulk",
      },
      html: "<p>This week in Acme: 10 deals you cannot miss. <a href='https://acme.example/unsub'>Unsubscribe</a></p>",
      text: "This week in Acme: 10 deals you cannot miss. Unsubscribe: https://acme.example/unsub",
      messageId: `<${TAG}-b@ethereal>`,
    },
    {
      from: B.user,
      to: A.user,
      subject: SUB.attach,
      html: '<p>See attached report and the inline image: <img src="cid:px@e2e"></p>',
      text: "See attached report.",
      attachments: [
        { filename: "report.pdf", content: PDF_BYTES, contentType: "application/pdf" },
        { filename: "pixel.png", content: PNG_1PX, cid: "px@e2e", contentType: "image/png" },
      ],
      messageId: `<${TAG}-c@ethereal>`,
    },
    {
      from: B.user,
      to: A.user,
      subject: SUB.sanitize,
      html:
        '<div><p>safe paragraph</p><script>alert("xss")</script>' +
        '<img src="https://x.example/i.png" onerror="alert(1)">' +
        '<a href="javascript:alert(2)">click</a></div>',
      text: "safe paragraph",
      messageId: `<${TAG}-d@ethereal>`,
    },
  ];
}

// ---------- main ----------

async function main() {
  console.log(`live-e2e tag=${TAG} backend=${CONVEX_URL}`);

  // Clean slate: remove accounts through the real path first (exercises
  // async purge batches), then hard-purge any stragglers or orphans.
  const pre = await state.docs();
  const preCount = Object.entries(pre)
    .filter(([t]) => t !== "counters")
    .reduce((s, [, n]) => s + n, 0);
  if (preCount > 0) {
    note(`user ${USER} has ${preCount} leftover docs; purging`);
    for (const acc of await q("accounts:list", {})) {
      await mu("accounts:remove", { accountId: acc._id });
    }
    await mu("liveSupport:purgeForUser", { userId: USER });
  }

  const A = await createEtherealAccount();
  const B = await createEtherealAccount();
  if (B.user === A.user) throw new Error("Could not create two distinct Ethereal accounts");
  console.log(`  A=${A.user}\n  B=${B.user}`);

  // ---- Step 1: connect ----
  step("1", "connect accounts (real IMAP/SMTP validation)");

  let wrongErr = "";
  try {
    await act("accounts:connect", {
      email: A.user,
      password: "definitely-wrong-password",
      imapHost: IMAP.host,
      imapPort: 993,
      smtpHost: "smtp.ethereal.email",
      smtpPort: 587,
    });
  } catch (e) {
    wrongErr = e instanceof Error ? e.message : String(e);
  }
  ok("wrong password produces auth error", /Authentication failed/i.test(wrongErr), wrongErr);
  ok("no account row after failed connect", (await q("accounts:list", {})).length === 0);

  const connA = await act("accounts:connect", {
    email: A.user,
    password: A.pass,
    displayName: "Live E2E A",
    imapHost: IMAP.host,
    imapPort: 993,
    smtpHost: "smtp.ethereal.email",
    smtpPort: 587,
  });
  const connB = await act("accounts:connect", {
    email: B.user,
    password: B.pass,
    displayName: "Live E2E B",
    imapHost: IMAP.host,
    imapPort: 993,
    smtpHost: "smtp.ethereal.email",
    smtpPort: 587,
  });
  const accountA = connA.accountId as string;
  const accountB = connB.accountId as string;

  const docA = await state.account(A.user);
  ok("A stored imapPort 993 / imapSecure true", docA.imapPort === 993 && docA.imapSecure === true);
  ok("A stored smtpPort 587 / smtpSecure false", docA.smtpPort === 587 && docA.smtpSecure === false);
  note(`A capabilities: ${JSON.stringify(docA.capabilities)}`);
  ok("A capabilities recorded", !!docA.capabilities);

  await waitFor("A initial sync ready", async () => (await state.account(A.user)).status === "ready", 300_000);
  await waitFor("B initial sync ready", async () => (await state.account(B.user)).status === "ready", 300_000);
  const docA2 = await state.account(A.user);
  const docB2 = await state.account(B.user);
  ok("A status ready", docA2.status === "ready", JSON.stringify(docA2.lastError));
  ok("B status ready", docB2.status === "ready", JSON.stringify(docB2.lastError));

  // ---- Step 2: seed ----
  // Ethereal relays B->A over real SMTP, but in every observed run the
  // copies landed in A's INBOX 4-7 minutes after SMTP acceptance, which
  // makes a "no remote changes" sync window impossible to time. Seeding
  // is setup, not a validation target (real SMTP is exercised by the
  // connect-time verify() and by the send/reply/forward step), so the
  // seeds are APPENDed over IMAP instead.
  step("2", "seed 4 messages B -> A via IMAP APPEND");
  const seedSubjects = seedMails(B, A).map((m) => m.subject as string);
  await withImap(A, async (imap) => {
    const present = await subjectsIn(imap, "INBOX");
    for (const mail of seedMails(B, A)) {
      if (present.has(mail.subject as string)) continue;
      const raw = await rawMime(mail);
      await imap.append("INBOX", raw);
      note(`appended "${mail.subject}"`);
    }
  });
  // Defensive dedupe: nothing sends these subjects anywhere else, but if
  // a copy ever lands in a second folder keep exactly one across all
  // folders so later assertions stay deterministic.
  const expungeSeedDuplicates = async () => {
    await withImap(A, async (imap) => {
      const seen = new Set<string>();
      const dupes: { box: string; uid: number }[] = [];
      for (const box of await imap.list()) {
        const lock = await imap.getMailboxLock(box.path);
        try {
          for await (const m of imap.fetch("1:*", {
            uid: true,
            envelope: true,
          })) {
            const s = m.envelope?.subject;
            if (!s || !seedSubjects.includes(s)) continue;
            if (seen.has(s)) dupes.push({ box: box.path, uid: m.uid });
            else seen.add(s);
          }
        } finally {
          lock.release();
        }
      }
      for (const d of dupes) {
        const lock = await imap.getMailboxLock(d.box);
        try {
          note(`expunging late duplicate seed in ${d.box} uid=${d.uid}`);
          await imap.messageDelete([d.uid], { uid: true });
        } finally {
          lock.release();
        }
      }
    });
  };

  // ---- Step 3: initial sync of seeded mail ----
  step("3", "syncAccount for A");
  const sync3 = await runSync(accountA);
  note(`sync outcome: ${JSON.stringify(sync3)}`);

  const foldersA = await state.folders(accountA);
  const roleOf = (r: string) => foldersA.find((f: AnyResult) => f.role === r);
  ok("INBOX discovered", foldersA.some((f: AnyResult) => f.path === "INBOX" && f.role === "inbox"));
  for (const r of ["sent", "drafts", "junk", "trash"]) {
    ok(`folder role ${r} present`, !!roleOf(r), foldersA.map((f: AnyResult) => `${f.path}:${f.role}`).join(","));
  }
  const inboxF = foldersA.find((f: AnyResult) => f.role === "inbox");
  ok("INBOX syncedUids stored", (inboxF?.syncedUids ?? "").length > 0);
  ok("INBOX flags stored", (inboxF?.flags ?? "").length > 0);
  ok("INBOX uidNext stored", typeof inboxF?.uidNext === "number");

  const msgsA = async () => await state.messages(accountA);
  let msgs = await msgsA();
  const bySubj = (s: string) => msgs.find((m: AnyResult) => m.subject === s);
  const msgIdsSeen = new Set(msgs.map((m: AnyResult) => `${m.messageIdHeader}:${m.folderId}`));
  ok("each seeded message ingested exactly once",
    [SUB.personal, SUB.news, SUB.attach, SUB.sanitize].every((s) => bySubj(s)),
    msgs.map((m: AnyResult) => m.subject).join(" | "));
  ok("no duplicate messageIds", msgIdsSeen.size === msgs.length);

  const threads = await state.threads(accountA);
  const threadOf = (m: AnyResult) => threads.find((t: AnyResult) => t._id === m.threadId);
  ok("threads created", msgs.every((m: AnyResult) => threadOf(m)));

  ok("personal classified primary", bySubj(SUB.personal)?.inbox === "primary", bySubj(SUB.personal)?.inbox);
  ok("newsletter classified other", bySubj(SUB.news)?.inbox === "other", bySubj(SUB.news)?.inbox);
  ok("heuristic classification used", msgs.every((m: AnyResult) => m.classifiedBy !== "jev"));

  const counters3 = await state.counters();
  note(`counters: ${JSON.stringify(counters3)}`);

  // ---- Step 4: unchanged sync = zero doc writes ----
  step("4", "re-sync with no remote changes");
  // Any SMTP copy that arrived after the seed dedupe is a real remote
  // change; remove it first so the unchanged-sync check is deterministic.
  await expungeSeedDuplicates();
  await runSync(accountA);
  await expungeSeedDuplicates();
  const snapBefore = snapshotDocs(await state.snapshot());
  await runSync(accountA);
  const snapAfter = snapshotDocs(await state.snapshot());
  const d4 = countDeltas(snapBefore, snapAfter);
  for (const d of d4.diffs.slice(0, 10)) note(`  ${d}`);
  ok("unchanged sync produced zero document writes", d4.n === 0, `${d4.n} doc deltas`);
  note("DB read/write counters are not exposed by the local backend; measured via doc snapshot diff instead");

  // ---- Step 5: external changes via a second IMAP client ----
  step("5", "external flag/move/delete, then sync");
  const dDoc = bySubj(SUB.sanitize)!;

  // getMessageContent for (d) must happen before its remote delete below —
  // content fetch requires the local doc + server uid to still exist.
  const contentD = await act("content:getMessageContent", { messageId: dDoc._id });
  ok("(d) script stripped", !/<script/i.test(contentD.html ?? ""));
  ok("(d) onerror stripped", !/onerror/i.test(contentD.html ?? ""));
  ok("(d) javascript: href stripped", !/javascript:/i.test(contentD.html ?? ""));
  ok("(d) safe content kept", /safe paragraph/i.test(contentD.html ?? ""));

  await withImap(A, async (imap) => {
    const aSrv = await serverFind(imap, SUB.personal);
    const bSrv = await serverFind(imap, SUB.news);
    const dSrv = await serverFind(imap, SUB.sanitize);
    if (!aSrv || !bSrv || !dSrv) throw new Error("seeded mail missing on server");
    await imap.messageFlagsAdd(String(aSrv.uid), ["\\Seen", "\\Flagged"], {
      uid: true,
    });
    try {
      await imap.mailboxCreate("Archive");
    } catch {
      /* exists */
    }
    await imap.messageMove(String(bSrv.uid), "Archive", { uid: true });
    await imap.messageDelete(String(dSrv.uid), { uid: true });
  });

  const sync5 = await runSync(accountA);
  note(`sync outcome: ${JSON.stringify(sync5)}`);
  msgs = await msgsA();

  const aAfter = bySubj(SUB.personal);
  ok("personal seen+flagged", aAfter?.seen === true && aAfter?.flagged === true);
  const threads5 = await state.threads(accountA);
  const aThread = threads5.find((t: AnyResult) => t._id === aAfter.threadId);
  ok("thread starred + read", aThread?.starred === true && aThread?.unread === false,
    JSON.stringify({ starred: aThread?.starred, unread: aThread?.unread }));

  const bAfter = bySubj(SUB.news);
  ok("newsletter relocated to archive", bAfter?.folderRole === "archive", bAfter?.folderRole);
  ok("newsletter keeps inbox other", bAfter?.inbox === "other");
  ok("archive folder discovered mid-run",
    (await state.folders(accountA)).some((f: AnyResult) => f.path === "Archive"));
  ok("newsletter appears in archive listing",
    (await state.messages(accountA)).some(
      (m: AnyResult) => m.subject === SUB.news && m.folderRole === "archive",
    ));
  ok("sanitize message deleted locally", !bySubj(SUB.sanitize));
  note(`counters: ${JSON.stringify(await state.counters())}`);

  // ---- Step 6: Kite-side ops ----
  step("6", "pending ops: archive/unread/star/restore/trash");

  const aId = (bySubj(SUB.personal))._id;
  await mu("mail:archive", { messageIds: [aId] });
  await opsDrained(accountA);
  ok("archive op: message in Archive on server",
    (await withImap(A, (imap) => serverFind(imap, SUB.personal)))?.folder === "Archive");

  await mu("mail:setRead", { messageIds: [aId], read: false });
  await mu("mail:setStarred", { messageIds: [aId], starred: true });
  await opsDrained(accountA);
  const aSrv2 = await withImap(A, (imap) => serverFind(imap, SUB.personal));
  ok("flags op: unread on server", aSrv2 && !aSrv2.flags.has("\\Seen"));
  ok("flags op: flagged on server", aSrv2 && aSrv2.flags.has("\\Flagged"));

  await mu("mail:restore", { messageIds: [aId] });
  await opsDrained(accountA);
  ok("restore op: back in INBOX",
    (await withImap(A, (imap) => serverFind(imap, SUB.personal)))?.folder === "INBOX");

  const bId = (bySubj(SUB.news))?._id;
  await mu("mail:trash", { messageIds: [bId] });
  await opsDrained(accountA);
  ok("trash op: newsletter in Trash on server",
    (await withImap(A, (imap) => serverFind(imap, SUB.news)))?.folder === "Trash");

  // COPYUID remap: local uid must match the post-move server uid.
  msgs = await msgsA();
  const aDoc2 = bySubj(SUB.personal)!;
  const aSrv3 = await withImap(A, (imap) => serverFind(imap, SUB.personal));
  ok("COPYUID remap: local uid matches server", aSrv3?.uid === aDoc2.uid,
    `local=${aDoc2.uid} server=${aSrv3?.uid}`);

  // A late SMTP copy would legitimately create new docs on the next sync;
  // expunge it first so this no-op check stays deterministic.
  await expungeSeedDuplicates();
  const snap6a = snapshotDocs(await state.snapshot());
  await runSync(accountA);
  const snap6b = snapshotDocs(await state.snapshot());
  // Our own flag/move ops change server state; the follow-up sync may
  // advance compact folder snapshots, but must not touch mail documents.
  const d6 = countDeltas(snap6a, snap6b, { allowStatusOnly: true });
  for (const d of d6.diffs.slice(0, 10)) note(`  ${d}`);
  // Applying remote ops changes folder flags and STATUS values. This first
  // reconciliation may update compact snapshots, but must then stabilize.
  ok("post-ops reconciliation does not rewrite mail", d6.diffs.every(d => d.startsWith("note ") || d.startsWith("delta folders:")), d6.diffs.join("; "));
  if (d6.n) note(`post-ops reconciliation updated ${d6.n} compact snapshot(s)`);
  const stableBefore = snapshotDocs(await state.snapshot());
  await runSync(accountA);
  const stableAfter = snapshotDocs(await state.snapshot());
  const stableDiff = countDeltas(stableBefore, stableAfter);
  ok("unchanged sync after remote-op reconciliation is a no-op", stableDiff.n === 0, `${stableDiff.n} doc deltas`);

  // ---- Step 7: content + attachment fetch ----
  step("7", "getMessageContent + downloadAttachment");
  msgs = await msgsA();
  const cDoc2 = bySubj(SUB.attach)!;
  const contentC = await act("content:getMessageContent", { messageId: cDoc2._id });
  ok("(c) attachments listed", (contentC.attachments ?? []).length >= 1,
    JSON.stringify(contentC.attachments));
  ok("(c) pdf attachment present",
    (contentC.attachments ?? []).some((x: AnyResult) => x.filename === "report.pdf"));
  ok("(c) cid image inlined as data URI", /data:image\/png/.test(contentC.html ?? ""));
  ok("(c) no cid: ref left", !/cid:/.test(contentC.html ?? ""));

  const pdfAtt = (contentC.attachments ?? []).find((x: AnyResult) => x.filename === "report.pdf");
  const dl = await act("content:downloadAttachment", {
    messageId: cDoc2._id,
    attachmentId: pdfAtt.id,
  });
  ok("downloaded pdf byte-identical", sha256(dl.data) === sha256(PDF_BYTES),
    `got ${sha256(dl.data).slice(0, 16)} want ${sha256(PDF_BYTES).slice(0, 16)}`);

  let delErr = "";
  try {
    await act("content:getMessageContent", { messageId: dDoc._id });
  } catch (e) {
    delErr = e instanceof Error ? e.message : String(e);
  }
  ok("(d) content after delete errors clearly", /not found|moved/i.test(delErr), delErr || "no error");

  // ---- Step 8: send / reply / forward / idempotency ----
  step("8", "sendMessage + reply + forward + idempotency");
  const attachB64 = Buffer.from("attachment payload").toString("base64");
  const out = await act("send:sendMessage", {
    accountId: accountA,
    to: [{ email: B.user }],
    subject: SUB.outbound,
    text: "outbound body from live e2e",
    attachments: [{ filename: "note.txt", contentType: "text/plain", contentBase64: attachB64 }],
    idempotencyKey: `${TAG}-key1`,
  });
  ok("sendMessage returned", !!out, JSON.stringify(out));

  await sleep(3_000);
  const sentOnServer = await withImap(A, async (imap) => {
    const sent = await subjectsIn(imap, "Sent Mail");
    return sent.get(SUB.outbound);
  });
  ok("sent copy exists on server Sent Mail", typeof sentOnServer === "number");
  // Ethereal captures a copy into the sender INBOX; count exact copies in Sent.
  const sentCopies = await withImap(A, async (imap) => {
    let n = 0;
    const lock = await imap.getMailboxLock("Sent Mail");
    try {
      for await (const m of imap.fetch("1:*", { envelope: true })) {
        if (m.envelope?.subject === SUB.outbound) n++;
      }
    } finally {
      lock.release();
    }
    return n;
  });
  ok("exactly one Sent copy on server", sentCopies === 1, `count=${sentCopies}`);

  // reply to B's personal message (aDoc is its local doc; it is in INBOX again)
  const aDoc3 = bySubj(SUB.personal)!;
  const reply = await act("send:reply", {
    messageId: aDoc3._id,
    text: "replying to your note",
    includeQuote: true,
  });
  ok("reply sent", !!reply, JSON.stringify(reply));
  await opsDrained(accountA);

  await sleep(3_000);
  const replyHdrs = await withImap(A, async (imap) => {
    const lock = await imap.getMailboxLock("Sent Mail");
    const out: { inReplyTo?: string; references?: string; messageId?: string; subject?: string } = {};
    try {
      for await (const m of imap.fetch("1:*", {
        envelope: true,
        headers: ["in-reply-to", "references", "message-id"],
      })) {
        const subj = m.envelope?.subject ?? "";
        if (subj.startsWith("Re:") && subj.includes(SUB.personal)) {
          const h = m.headers?.toString() ?? "";
          out.inReplyTo = /in-reply-to:\s*(\S+)/i.exec(h)?.[1];
          out.references = /references:\s*(.+)/i.exec(h)?.[1]?.trim();
          out.subject = subj;
        }
      }
    } finally {
      lock.release();
    }
    return out;
  });
  const stripAngles = (s?: string) => (s ?? "").replace(/[<>]/g, "");
  ok("reply In-Reply-To matches original",
    stripAngles(replyHdrs.inReplyTo) === stripAngles(aDoc3.messageIdHeader),
    `${replyHdrs.inReplyTo} vs ${aDoc3.messageIdHeader}`);
  ok("reply References contains original", (replyHdrs.references ?? "").includes(aDoc3.messageIdHeader));

  const fwd = await act("send:forward", {
    messageId: aDoc3._id,
    to: [{ email: B.user }],
    text: "forwarding this",
  });
  ok("forward sent", !!fwd, JSON.stringify(fwd));
  await opsDrained(accountA);

  // \Answered on the original
  const aSrv4 = await withImap(A, (imap) => serverFind(imap, SUB.personal));
  ok("original marked \\Answered on server", aSrv4?.flags.has("\\Answered"),
    JSON.stringify([...(aSrv4?.flags ?? [])]));

  await runSync(accountA);
  msgs = await msgsA();
  const sentDocs = msgs.filter((m: AnyResult) => m.folderRole === "sent");
  const sentMsgIds = new Set(sentDocs.map((m: AnyResult) => m.messageIdHeader));
  ok("sent messages upgraded, not duplicated", sentDocs.length === sentMsgIds.size,
    `${sentDocs.length} docs / ${sentMsgIds.size} ids`);
  const replyDoc = msgs.find(
    (m: AnyResult) => m.subject.includes(SUB.personal) && m.isOutbound,
  );
  ok("reply in same thread", replyDoc && replyDoc.threadId === aDoc3.threadId,
    `${replyDoc?.threadId} vs ${aDoc3.threadId}`);

  // idempotent resend
  const bInboxBefore = await withImap(B, async (imap) => (await folderStatus(imap, "INBOX"))?.messages ?? 0);
  const out2 = await act("send:sendMessage", {
    accountId: accountA,
    to: [{ email: B.user }],
    subject: SUB.outbound,
    text: "outbound body from live e2e",
    attachments: [{ filename: "note.txt", contentType: "text/plain", contentBase64: attachB64 }],
    idempotencyKey: `${TAG}-key1`,
  });
  ok("same idempotencyKey dedupes", out2.deduped === true, JSON.stringify(out2));
  await sleep(3_000);
  const bInboxAfter = await withImap(B, async (imap) => (await folderStatus(imap, "INBOX"))?.messages ?? 0);
  ok("no second SMTP send", bInboxAfter === bInboxBefore, `${bInboxBefore} -> ${bInboxAfter}`);

  let dupErr = "";
  try {
    await act("send:sendMessage", {
      accountId: accountA,
      to: [{ email: B.user }],
      subject: SUB.outbound,
      text: "outbound body from live e2e",
      attachments: [{ filename: "note.txt", contentType: "text/plain", contentBase64: attachB64 }],
    });
  } catch (e) {
    dupErr = e instanceof Error ? e.message : String(e);
  }
  ok("same content without key -> duplicate warning", /duplicate/i.test(dupErr), dupErr || "no error");

  // ---- Step 9: drafts ----
  step("9", "draft create/update/push/send");
  const draftId = (await mu("drafts:create", {
    accountId: accountA,
    to: [{ email: B.user }],
    subject: SUB.draft,
    text: "draft v1",
  })) as string;

  const remoteDrafts = () =>
    withImap(A, async (imap) => {
      const st = await folderStatus(imap, "Drafts");
      if (!st || st.messages === 0) return [];
      const lock = await imap.getMailboxLock("Drafts");
      const rows: { uid: number; draftHdr?: string; subject?: string }[] = [];
      try {
        for await (const m of imap.fetch("1:*", {
          uid: true,
          envelope: true,
          headers: ["x-kite-draft-id"],
        })) {
          rows.push({
            uid: m.uid,
            draftHdr: /x-kite-draft-id:\s*(\S+)/i.exec(m.headers?.toString() ?? "")?.[1],
            subject: m.envelope?.subject,
          });
        }
      } finally {
        lock.release();
      }
      return rows;
    });

  const pushed1 = await waitFor("draft pushed remotely (v1)", async () => {
    const dr = await remoteDrafts();
    return dr.length === 1;
  }, 45_000, 1_500);
  ok("draft pushed to server Drafts", pushed1);
  let rds = await remoteDrafts();
  const uidV1 = rds[0]?.uid;

  await mu("drafts:update", { draftId, text: "draft v2" });
  const pushed2 = await waitFor("draft pushed remotely (v2)", async () => {
    const dr = await remoteDrafts();
    return dr.length === 1 && dr[0].uid !== uidV1;
  }, 45_000, 1_500);
  rds = await remoteDrafts();
  ok("update pushed as new remote version", pushed2 && rds[0]?.uid !== uidV1);
  ok("previous remote version deleted", rds.length === 1, JSON.stringify(rds));
  const uidV2 = rds[0]?.uid;

  await mu("drafts:update", { draftId, text: "draft v3" });
  const pushed3 = await waitFor("draft pushed remotely (v3)", async () => {
    const dr = await remoteDrafts();
    return dr.length === 1 && dr[0].uid !== uidV2;
  }, 45_000, 1_500);
  rds = await remoteDrafts();
  ok("second update pushed", pushed3 && rds[0]?.uid !== uidV2);
  ok("still exactly one remote draft", rds.length === 1);

  const sd = await act("send:sendDraft", { draftId });
  ok("sendDraft accepted", !!sd, JSON.stringify(sd));
  await opsDrained(accountA);
  await sleep(2_000);
  ok("draft removed locally", (await state.drafts(accountA)).length === 0);
  const rdsAfter = await remoteDrafts();
  ok("remote draft removed", rdsAfter.length === 0, JSON.stringify(rdsAfter));

  // ---- Step 10: UIDVALIDITY ----
  step("10", "UIDVALIDITY reset");
  note("Ethereal provides no way to force a UIDVALIDITY change; covered by the fake-port integration test");

  // ---- Step 11: deepSearch ----
  step("11", "deepSearch body term");
  const found = await act("mail:deepSearch", { query: "quixotic", accountId: accountA });
  const hits = Array.isArray(found) ? found : (found?.page ?? []);
  ok("deepSearch finds body-only term",
    hits.some((m: AnyResult) => m.subject === SUB.personal),
    JSON.stringify(hits.map((m: AnyResult) => m.subject)));

  // ---- Step 12: cleanup ----
  step("12", "cleanup accounts");
  await mu("accounts:remove", { accountId: accountA });
  await mu("accounts:remove", { accountId: accountB });
  // Messages/threads/drafts/ops/sendLog purge asynchronously in batches.
  // Zero-count counter rows are retained by design (user-level aggregates).
  await waitFor("account purge batches", async () => {
    const d = await state.docs();
    return Object.entries(d)
      .filter(([t]) => t !== "counters")
      .reduce((s, [, n]) => s + n, 0) === 0;
  }, 120_000, 1_000);
  const post = await state.snapshot();
  const leftovers: string[] = [];
  for (const [table, rows] of Object.entries(post)) {
    if (table === "counters") continue;
    if (rows.length > 0) leftovers.push(`${table}=${rows.length}`);
  }
  ok("all rows purged", leftovers.length === 0, leftovers.join(","));
  const countersLeft = await state.counters();
  ok("counters zeroed", countersLeft.every((c: AnyResult) => c.count === 0),
    JSON.stringify(countersLeft));

  // ---- summary ----
  console.log(`\n${"=".repeat(64)}`);
  console.log("delivery: seeds appended via IMAP (Ethereal SMTP delivery observed at 4-7 min latency)");
  console.log(`capabilities: ${JSON.stringify((await state.account(A.user))?.capabilities ?? docA2.capabilities)}`);
  if (failures.length === 0) {
    console.log("RESULT: all checks passed");
  } else {
    console.log(`RESULT: ${failures.length} FAILURES:`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exitCode = 1;
});
