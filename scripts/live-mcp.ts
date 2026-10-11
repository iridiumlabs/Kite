// Live MCP verification (opt-in; never part of `npm test`):
//   npx tsx scripts/live-mcp.ts
//
// Boots `next dev` on a scratch port, mints a real post_sk_ API key for
// USER via the internal helper, connects two Ethereal accounts through the
// real `accounts:connect` path, then drives the whole tool surface over
// real HTTP with the official Streamable HTTP client.
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { Client } from "@modelcontextprotocol/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { ImapFlow } from "imapflow";
import type { SendMailOptions } from "nodemailer";
import { createRequire } from "node:module";

const CONVEX_URL = "http://127.0.0.1:3210";
const PORT = 3199;
const BASE = `http://127.0.0.1:${PORT}`;
const USER = "live-e2e-user";
const TAG = `mcp-${Date.now().toString(36)}`;

const failures: string[] = [];
const notes: string[] = [];

function ok(name: string, cond: unknown, detail?: string) {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
function note(msg: string) {
  notes.push(msg);
  console.log(`  note: ${msg}`);
}
function step(n: string, title: string) {
  console.log(`\n--- Step ${n}: ${title}`);
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
async function waitFor(name: string, fn: () => Promise<boolean>, ms = 60_000) {
  const deadline = Date.now() + ms;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error(`timeout waiting for: ${name}`);
    await sleep(1_500);
  }
}

// ---------- admin convex client ----------

function makeClient() {
  const cfgPath = path.join(".convex", "local", "default", "config.json");
  const cfg = JSON.parse(readFileSync(cfgPath, "utf8"));
  const adminKey: string =
    cfg.adminKey ??
    (Array.isArray(cfg.backends) && cfg.backends[0]?.adminKey) ??
    "";
  if (!adminKey) throw new Error(`No adminKey in ${cfgPath}`);
  const c = new ConvexHttpClient(CONVEX_URL, {
    skipConvexDeploymentUrlCheck: true,
  });
  (c as unknown as { setAdminAuth(k: string, i: object): void }).setAdminAuth(
    adminKey,
    { subject: USER, issuer: "live-mcp" },
  );
  return c;
}
type AnyArgs = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = any;
const convex = makeClient();
const q = (p: string, args: AnyArgs = {}): Promise<AnyResult> =>
  convex.query(p as never, args as never);
const mu = (p: string, args: AnyArgs = {}): Promise<AnyResult> =>
  convex.mutation(p as never, args as never);
const act = (p: string, args: AnyArgs = {}): Promise<AnyResult> =>
  convex.action(p as never, args as never);

// ---------- next dev ----------

let nextProc: ChildProcess | undefined;
async function freePort() {
  if (process.platform !== "win32") return;
  try {
    const out = require_("node:child_process")
      .execSync(
        `powershell -NoProfile -Command "(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess) -join ','"`,
        { encoding: "utf8" },
      )
      .trim();
    for (const pid of out.split(",")) {
      if (pid) {
        require_("node:child_process").execSync(
          `taskkill /PID ${pid} /T /F`,
          { stdio: "ignore" },
        );
      }
    }
  } catch {
    // Nothing listening; fine.
  }
}
async function startNextDev() {
  await freePort();
  await sleep(1_000);
  nextProc = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    env: {
      ...process.env,
      NEXT_PUBLIC_CONVEX_URL: CONVEX_URL,
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_dummy",
      CLERK_SECRET_KEY: "sk_test_dummy",
      PORT: String(PORT),
    },
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const log = (tag: string) => (d: Buffer) => {
    for (const line of d.toString().split(/\r?\n/)) {
      if (line.trim()) note(`next ${tag}: ${line.trim().slice(0, 200)}`);
    }
  };
  nextProc.stdout?.on("data", log("out"));
  nextProc.stderr?.on("data", log("err"));
  // Poll the route until it answers (first-hit compile can take a while).
  const deadline = Date.now() + 240_000;
  for (;;) {
    try {
      const res = await fetch(`${BASE}/api/mcp`, { method: "GET" });
      if (res.status > 0) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error("next dev did not come up");
    await sleep(2_000);
  }
}
function stopNextDev() {
  if (nextProc && !nextProc.killed) {
    nextProc.kill("SIGTERM");
    // Windows needs taskkill for the spawned npx child tree.
    if (process.platform === "win32" && nextProc.pid) {
      spawn("taskkill", ["/pid", String(nextProc.pid), "/T", "/F"], {
        stdio: "ignore",
      });
    }
  }
}

// ---------- ethereal / imap ----------

interface EthAccount {
  user: string;
  pass: string;
}
const IMAP = { host: "imap.ethereal.email", port: 993 };
const SMTP = { host: "smtp.ethereal.email", port: 587 };

const require_ = createRequire(import.meta.url);

// nodemailer.createTestAccount caches its first account process-wide
// (ETHEREAL_CACHE defaults to "yes"), so hit the API directly to get two
// distinct mailboxes.
function createEthereal(): Promise<EthAccount> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ requestor: "post-live-mcp", version: "1.0" });
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
            if (!j.user || !j.pass) {
              reject(new Error(`bad ethereal response: ${buf}`));
            } else {
              resolve({ user: j.user, pass: j.pass });
            }
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

async function withImap<T>(a: EthAccount, fn: (imap: ImapFlow) => Promise<T>) {
  const imap = new ImapFlow({
    host: IMAP.host,
    port: IMAP.port,
    secure: true,
    auth: { user: a.user, pass: a.pass },
    logger: false,
  });
  await imap.connect();
  try {
    return await fn(imap);
  } finally {
    await imap.logout().catch(() => {});
  }
}

async function rawMime(mail: SendMailOptions): Promise<Buffer> {
  const MailComposer = require_("nodemailer/lib/mail-composer");
  return await new Promise((resolve, reject) => {
    const composer = new MailComposer(mail);
    composer
      .compile()
      .build((err: Error | null, msg: Buffer) =>
        err ? reject(err) : resolve(msg),
      );
  });
}

async function opsDrained(accountId: string, timeoutMs = 300_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ops = (await q("liveSupport:opsForAccount", {
      accountId,
    })) as AnyResult[];
    if (ops.length === 0) return;
    if (Date.now() > deadline) {
      throw new Error(
        `pending ops did not drain: ${JSON.stringify(
          ops.map((o) => ({ kind: o.kind, lastError: o.lastError })),
        )}`,
      );
    }
    await sleep(1_500);
  }
}

async function runSync(accountId: string) {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const last = await act("node/sync:syncAccount", { accountId });
    if (!last?.skipped) return last;
    if (Date.now() > deadline) return last;
    await sleep(2_000);
  }
}

const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n" +
    "2 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 40 40 Td (post live mcp) Tj ET\n" +
    "endstream\nendobj\ntrailer\n<< /Size 3 /Root 1 0 R >>\n%%EOF\n",
);
const sha256 = (b: Buffer | ArrayBuffer) =>
  createHash("sha256").update(b as Buffer).digest("hex");

// ---------- MCP client ----------

let mcp: Client;
const keyValue = { raw: "" };

async function mcpConnect(key: string) {
  const transport = new StreamableHTTPClientTransport(
    new URL(`${BASE}/api/mcp`),
    { requestInit: { headers: { Authorization: `Bearer ${key}` } } },
  );
  const c = new Client({ name: "live-mcp", version: "0.1.0" });
  await c.connect(transport);
  return c;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sc(res: any): AnyResult {
  if (res.isError) {
    throw new Error(
      `tool returned isError: ${res.content?.[0]?.text ?? "?"}`,
    );
  }
  return res.structuredContent;
}
async function call(name: string, args: AnyArgs = {}) {
  return await mcp.callTool({ name, arguments: args });
}

// ---------- main ----------

async function main() {
  console.log(`live-mcp tag=${TAG} backend=${CONVEX_URL} http=${BASE}`);

  // Clean slate.
  const pre = (await q("liveSupport:docsForUser", {
    userId: USER,
  })) as Record<string, number>;
  const preCount = Object.entries(pre)
    .filter(([t]) => t !== "counters")
    .reduce((s, [, n]) => s + n, 0);
  if (preCount > 0) {
    note(`${preCount} leftover docs; purging`);
    for (const acc of await q("accounts:list", {})) {
      await mu("accounts:remove", { accountId: acc._id });
    }
    await mu("liveSupport:purgeForUser", { userId: USER });
  }

  step("0", "start next dev and mint API key");
  await startNextDev();
  note(`next dev up at ${BASE}`);
  const minted = (await mu("liveSupport:mintApiKey", {
    userId: USER,
    name: `live-mcp ${TAG}`,
  })) as { id: string; key: string };
  keyValue.raw = minted.key;
  ok("api key minted with post_sk_ prefix", keyValue.raw.startsWith("post_sk_"));

  const A = await createEthereal();
  let B = await createEthereal();
  for (let i = 0; i < 6 && B.user === A.user; i++) {
    await sleep(3_000);
    B = await createEthereal();
  }
  if (B.user === A.user) {
    throw new Error("Could not create two distinct Ethereal accounts");
  }
  console.log(`  A=${A.user}\n  B=${B.user}`);

  step("1", "connect accounts via real path");
  const connA = await act("accounts:connect", {
    email: A.user,
    password: A.pass,
    displayName: "Live MCP A",
    imapHost: IMAP.host,
    imapPort: 993,
    smtpHost: SMTP.host,
    smtpPort: 587,
  });
  const accountA = connA.accountId as string;
  const connB = await act("accounts:connect", {
    email: B.user,
    password: B.pass,
    displayName: "Live MCP B",
    imapHost: IMAP.host,
    imapPort: 993,
    smtpHost: SMTP.host,
    smtpPort: 587,
  });
  const accountB = connB.accountId as string;
  await waitFor(
    "A ready",
    async () =>
      (await q("liveSupport:accountForUser", { userId: USER, email: A.user }))
        .status === "ready",
    300_000,
  );
  await waitFor(
    "B ready",
    async () =>
      (await q("liveSupport:accountForUser", { userId: USER, email: B.user }))
        .status === "ready",
    300_000,
  );

  step("2", "seed 2 messages via IMAP APPEND");
  const SUB = {
    personal: `${TAG} mcp personal`,
    attach: `${TAG} mcp attachment`,
  };
  await withImap(A, async (imap) => {
    await imap.append(
      "INBOX",
      await rawMime({
        from: { name: "Bob Sender", address: B.user },
        to: A.user,
        subject: SUB.personal,
        text: "Personal note for the MCP live run. laconic keyword.",
        messageId: `<${TAG}-p@ethereal>`,
      }),
    );
    await imap.append(
      "INBOX",
      await rawMime({
        from: B.user,
        to: A.user,
        subject: SUB.attach,
        text: "See attached PDF.",
        attachments: [
          {
            filename: "report.pdf",
            content: PDF_BYTES,
            contentType: "application/pdf",
          },
        ],
        messageId: `<${TAG}-a@ethereal>`,
      }),
    );
  });
  await runSync(accountA);
  const msgs = (await q("liveSupport:messagesForAccount", {
    accountId: accountA,
  })) as AnyResult[];
  ok("2 seeds ingested", msgs.length === 2, `got ${msgs.length}`);

  step("3", "unauthenticated MCP requests rejected");
  {
    const res = await fetch(`${BASE}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    ok("missing bearer -> 401", res.status === 401, `got ${res.status}`);
    ok(
      "WWW-Authenticate header present",
      (res.headers.get("www-authenticate") ?? "").includes("Bearer"),
    );
    const res2 = await fetch(`${BASE}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: "Bearer post_sk_deadbeefdeadbeef",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    ok("unknown key -> 401", res2.status === 401, `got ${res2.status}`);
  }

  step("4", "connect MCP client + list tools");
  mcp = await mcpConnect(keyValue.raw);
  const { tools } = await mcp.listTools();
  ok("33 tools advertised", tools.length === 33, `got ${tools.length}`);
  note(`tools: ${tools.map((t) => t.name).join(", ")}`);

  step("5", "list_accounts + unread counts");
  {
    const out = sc(await call("list_accounts"));
    const emails = out.items.map((a: AnyResult) => a.email);
    ok(
      "list_accounts shows both mailboxes",
      emails.includes(A.user) && emails.includes(B.user),
      JSON.stringify(emails),
    );
    const counts = sc(await call("get_unread_counts"));
    ok(
      "unread counts shape",
      typeof counts.primary === "number" &&
        Array.isArray(counts.byAccount) &&
        typeof counts.drafts === "number",
      JSON.stringify(counts),
    );
  }

  step("6", "list_threads primary + get_thread");
  let threadId = "";
  let attachMessageId = "";
  let attachmentId = "";
  {
    const out = sc(
      await call("list_threads", { view: "primary", accountId: accountA }),
    );
    const subjects = out.items.map((t: AnyResult) => t.subject);
    ok(
      "both seeds in primary listing",
      subjects.includes(SUB.personal) && subjects.includes(SUB.attach),
      JSON.stringify(subjects),
    );
    const personal = out.items.find(
      (t: AnyResult) => t.subject === SUB.personal,
    );
    threadId = personal.id;
    const th = sc(await call("get_thread", { threadId }));
    ok(
      "get_thread returns message with text body",
      th.messages.length >= 1 && th.messages[0].body?.text?.includes("laconic"),
      JSON.stringify(th.messages[0]?.body?.text ?? ""),
    );
    const attachThread = out.items.find(
      (t: AnyResult) => t.subject === SUB.attach,
    );
    const thA = sc(await call("get_thread", { threadId: attachThread.id }));
    attachMessageId = thA.messages[0].id;
    attachmentId = thA.messages[0].attachments[0].id;
    ok(
      "attachment metadata listed",
      thA.messages[0].attachments[0].filename === "report.pdf",
    );
  }

  step("7", "search_emails: index, structured, server");
  {
    const index = sc(await call("search_emails", { query: SUB.personal }));
    ok(
      "index search finds by subject",
      index.source === "index" && index.items.length >= 1,
      JSON.stringify(index.source),
    );
    const structured = sc(
      await call("search_emails", { accountId: accountA, unread: true }),
    );
    ok(
      "structured search finds unread",
      structured.source === "filters" && structured.items.length === 2,
      JSON.stringify({ s: structured.source, n: structured.items.length }),
    );
    const server = sc(
      await call("search_emails", {
        query: "laconic",
        accountId: accountA,
        searchServer: true,
      }),
    );
    ok(
      "searchServer finds body-only term",
      server.source === "server" && server.items.length >= 1,
      JSON.stringify({ s: server.source, n: server.items.length }),
    );
  }

  step("8", "get_attachment PDF bytes");
  {
    const res = await call("get_attachment", {
      messageId: attachMessageId,
      attachmentId,
    });
    const blob = (res.content as AnyResult[]).find(
      (c) => c.type === "resource",
    )?.resource?.blob;
    ok("attachment returned as base64 resource", typeof blob === "string");
    ok(
      "attachment bytes match sha256",
      sha256(Buffer.from(blob, "base64")) === sha256(PDF_BYTES),
    );
    ok(
      "structured metadata has filename",
      sc(res).filename === "report.pdf",
    );
  }

  step("9", "categories + organizing");
  {
    const cat = sc(
      await call("create_category", {
        name: `${TAG} receipts`,
        description: "test category",
        color: "#0a84ff",
      }),
    );
    ok("category created", typeof cat.categoryId === "string");
    const catId = cat.categoryId;
    const cats = sc(await call("list_categories"));
    ok(
      "category listed",
      cats.items.some((c: AnyResult) => c.id === catId),
    );
    await call("assign_categories", {
      threadIds: [threadId],
      add: [catId],
    });
    const assigned = sc(
      await call("list_threads", { view: "category", categoryId: catId }),
    );
    ok(
      "thread appears in category view",
      assigned.items.some((t: AnyResult) => t.id === threadId),
    );

    await call("move_to_inbox", { threadIds: [threadId], inbox: "other" });
    const other = sc(await call("list_threads", { view: "other" }));
    ok(
      "moved thread shows in other",
      other.items.some((t: AnyResult) => t.id === threadId),
    );

    await call("archive", { threadIds: [threadId] });
    const prim = sc(await call("list_threads", { view: "primary" }));
    const otherPost = sc(await call("list_threads", { view: "other" }));
    const arch = sc(await call("list_threads", { view: "archive" }));
    ok(
      "archived thread leaves both inboxes",
      !prim.items.some((t: AnyResult) => t.id === threadId) &&
        !otherPost.items.some((t: AnyResult) => t.id === threadId),
    );
    ok(
      "archived thread in archive view",
      arch.items.some((t: AnyResult) => t.id === threadId),
    );
    await call("restore", { threadIds: [threadId] });
    const prim2 = sc(await call("list_threads", { view: "primary" }));
    const other2 = sc(await call("list_threads", { view: "other" }));
    ok(
      "restored thread returns to other inbox",
      other2.items.some((t: AnyResult) => t.id === threadId) &&
        !prim2.items.some((t: AnyResult) => t.id === threadId),
    );

    const msgId = sc(
      await call("get_thread", { threadId, includeBodies: false }),
    ).messages[0].id;
    await call("mark_read", { messageIds: [msgId] });
    let msg = sc(await call("get_email", { messageId: msgId, includeBody: false }));
    ok("mark_read clears unread", msg.unread === false);
    await call("mark_unread", { threadIds: [threadId] });
    msg = sc(await call("get_email", { messageId: msgId, includeBody: false }));
    ok("mark_unread sets unread", msg.unread === true);
    await call("star", { threadIds: [threadId] });
    const starred = sc(await call("list_threads", { view: "starred" }));
    ok(
      "starred thread in starred view",
      starred.items.some((t: AnyResult) => t.id === threadId),
    );
    await call("unstar", { threadIds: [threadId] });
    await opsDrained(accountA);
    await withImap(A, async (imap) => {
      const lock = await imap.getMailboxLock("INBOX");
      try {
        for await (const m of imap.fetch(
          { uid: "*" },
          { envelope: true, flags: true },
        )) {
          if (m.envelope?.subject === SUB.personal) {
            ok(
              "server flags reflect ops (Seen set, Flagged cleared)",
              m.flags?.has("\\Seen") === true &&
                m.flags?.has("\\Flagged") === false,
              JSON.stringify([...(m.flags ?? [])]),
            );
          }
        }
      } finally {
        lock.release();
      }
    });
  }

  step("10", "draft lifecycle");
  {
    const d = sc(
      await call("create_draft", {
        accountId: accountA,
        to: [B.user],
        subject: `${TAG} mcp draft`,
        text: "draft body",
      }),
    );
    ok("draft created", typeof d.draftId === "string");
    const draftId = d.draftId;
    const got = sc(await call("get_draft", { draftId }));
    ok("get_draft returns draft", got.subject === `${TAG} mcp draft`);
    await call("update_draft", { draftId, text: "revised draft body" });
    const listed = sc(await call("list_drafts", { accountId: accountA }));
    ok(
      "draft listed",
      listed.items.some((x: AnyResult) => x.id === draftId),
    );
    const sent = sc(
      await call("send_draft", {
        draftId,
        idempotencyKey: `${TAG}-draft`,
      }),
    );
    ok("send_draft returns messageId", typeof sent.messageId === "string");
    const draftsAfter = sc(await call("list_drafts", { accountId: accountA }));
    ok(
      "draft removed after send",
      !draftsAfter.items.some((x: AnyResult) => x.id === draftId),
    );
    await opsDrained(accountA);
  }

  step("11", "send/reply/forward + idempotency");
  {
    const sent1 = sc(
      await call("send_email", {
        accountId: accountA,
        to: [B.user],
        subject: `${TAG} mcp outbound`,
        text: "live mcp send",
        idempotencyKey: `${TAG}-send`,
      }),
    );
    ok("send_email returns ids", typeof sent1.messageId === "string");
    const sent2 = sc(
      await call("send_email", {
        accountId: accountA,
        to: [B.user],
        subject: `${TAG} mcp outbound`,
        text: "live mcp send",
        idempotencyKey: `${TAG}-send`,
      }),
    );
    ok(
      "same idempotencyKey dedupes",
      sent2.deduplicated === true && sent2.messageId === sent1.messageId,
      JSON.stringify(sent2),
    );
    const sendLog = (await q("liveSupport:sendLogForAccount", {
      accountId: accountA,
    })) as AnyResult[];
    const forKey = sendLog.filter((s) => s.idempotencyKey === `${TAG}-send`);
    ok(
      "one sendLog row for the idempotency key",
      forKey.length === 1,
      `got ${forKey.length}`,
    );

    const reply = sc(
      await call("reply_to_email", {
        messageId: attachMessageId,
        replyAll: true,
        text: "replying via mcp",
      }),
    );
    ok("reply sent", typeof reply.messageId === "string");
    const fwd = sc(
      await call("forward_email", {
        messageId: attachMessageId,
        to: [B.user],
        text: "forwarding via mcp",
      }),
    );
    ok("forward sent", typeof fwd.messageId === "string");
    await opsDrained(accountA);
    await runSync(accountA);
  }

  step("12", "trash + delete_permanently");
  {
    await call("trash", { threadIds: [threadId] });
    const tr = sc(await call("list_threads", { view: "trash" }));
    ok(
      "trashed thread in trash view",
      tr.items.some((t: AnyResult) => t.id === threadId),
    );
    await call("delete_permanently", { threadIds: [threadId] });
    const tr2 = sc(await call("list_threads", { view: "trash" }));
    ok(
      "delete_permanently removes thread",
      !tr2.items.some((t: AnyResult) => t.id === threadId),
    );
    await opsDrained(accountA);
  }

  step("13", "revoked key rejected");
  {
    await mu("apiKeys:revoke", { apiKeyId: minted.id });
    const res = await fetch(`${BASE}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${keyValue.raw}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    });
    ok("revoked key -> 401", res.status === 401, `got ${res.status}`);
  }

  step("14", "cleanup");
  await mcp.close().catch(() => {});
  await mu("accounts:remove", { accountId: accountA });
  await mu("accounts:remove", { accountId: accountB });
  await waitFor(
    "account purge",
    async () => {
      const d = (await q("liveSupport:docsForUser", {
        userId: USER,
      })) as Record<string, number>;
      return (
        d.accounts === 0 && d.threads === 0 && d.messages === 0 &&
        d.drafts === 0 && d.folders === 0
      );
    },
    300_000,
  );
  ok("all account rows removed", true);
  await mu("liveSupport:purgeForUser", { userId: USER });
}

main()
  .catch((e) => {
    console.error(`\nFATAL ${e instanceof Error ? e.stack ?? e.message : e}`);
    failures.push(`fatal: ${e instanceof Error ? e.message : String(e)}`);
  })
  .finally(() => {
    stopNextDev();
    console.log("\n================ RESULT ================");
    if (failures.length === 0) {
      console.log("all checks passed");
      process.exit(0);
    }
    console.log(`${failures.length} failure(s):`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  });
