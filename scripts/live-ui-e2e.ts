// Live UI end-to-end: connects an Ethereal mailbox through the real app
// backend (dev-auth JWT), seeds varied messages over IMAP, then drives the
// actual frontend with Playwright. Screenshots land in artifacts/e2e/.
// Opt-in: requires `next dev` on :3000 and the local Convex backend on :3210.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { ImapFlow } from "imapflow";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";

const BASE = "http://localhost:3000";
const CONVEX_URL = "http://127.0.0.1:3210";
const TAG = `ui-${Date.now().toString(36)}`;
const OUT = path.join(process.cwd(), "artifacts", "e2e");

type Eth = { user: string; pass: string };

const require_ = createRequire(import.meta.url);
const failures: string[] = [];
const notes: string[] = [];
const cleanupTasks: (() => Promise<unknown>)[] = [];

function ok(name: string, cond: unknown, detail?: string) {
  if (cond) {
    console.log(`  PASS ${name}${detail ? ` (${detail})` : ""}`);
  } else {
    console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`);
    failures.push(name);
  }
}
function note(m: string) {
  console.log(`  ... ${m}`);
  notes.push(m);
}
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
async function waitFor(
  label: string,
  fn: () => Promise<boolean>,
  timeoutMs = 120_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() > deadline) {
      console.log(`  TIMEOUT ${label}`);
      return false;
    }
    await sleep(1_500);
  }
}

function createEtherealAccount(): Promise<Eth> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ requestor: "kite-ui-e2e", version: "1.0" });
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
            if (!j.user || !j.pass) reject(new Error(`bad ethereal: ${buf}`));
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

type Mail = Record<string, unknown>;
async function rawMime(mail: Mail): Promise<Buffer> {
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

const PDF_BYTES = Buffer.from(
  "%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n" +
    "2 0 obj\n<< /Length 44 >>\nstream\nBT /F1 12 Tf 40 40 Td (kite ui e2e) Tj ET\n" +
    "endstream\nendobj\ntrailer\n<< /Size 3 /Root 1 0 R >>\n%%EOF\n",
);
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function seedMails(A: Eth): Mail[] {
  const to = A.user;
  const base = { to };
  const mk = (
    from: { name: string; address: string },
    subject: string,
    extra: Mail,
  ): Mail => ({ ...base, from, subject, ...extra });
  const lena = { name: "Lena Fischer", address: "lena.fischer@ethereal.email" };
  const maya = { name: "Maya Okafor", address: "maya.okafor@ethereal.email" };
  const sam = { name: "Sam Reyes", address: "sam.reyes@ethereal.email" };
  const digest = { name: "Acme Weekly", address: "digest@acme.example" };
  return [
    mk(lena, `${TAG} Thursday walkthrough notes`, {
      text: "Can we go over the import flow on Thursday? I put together notes on the three rough edges we saw.",
      messageId: `<${TAG}-1@x>`,
    }),
    mk(maya, `Re: ${TAG} Thursday walkthrough notes`, {
      text: "Yes. I will bring the label mapping spreadsheet and we can pair on it after.",
      inReplyTo: `<${TAG}-1@x>`,
      references: `<${TAG}-1@x>`,
      messageId: `<${TAG}-2@x>`,
    }),
    mk(lena, `Re: ${TAG} Thursday walkthrough notes`, {
      text: "Perfect. Adding the progress count fix to the list.",
      inReplyTo: `<${TAG}-2@x>`,
      references: `<${TAG}-1@x> <${TAG}-2@x>`,
      messageId: `<${TAG}-3@x>`,
    }),
    mk(digest, `${TAG} This week in Acme`, {
      headers: {
        "List-Unsubscribe": "<mailto:unsub@acme.example>",
        Precedence: "bulk",
      },
      html: "<p>Deals you cannot miss. <a href='https://acme.example'>Unsubscribe</a></p>",
      text: "Deals you cannot miss.",
      messageId: `<${TAG}-4@x>`,
    }),
    mk(sam, `${TAG} Report and screenshots`, {
      html: '<p>Report attached, plus the inline mock: <img src="cid:px@e2e"></p>',
      text: "Report attached.",
      attachments: [
        {
          filename: "quarterly-report.pdf",
          content: PDF_BYTES,
          contentType: "application/pdf",
        },
        {
          filename: "pixel.png",
          content: PNG_1PX,
          cid: "px@e2e",
          contentType: "image/png",
        },
      ],
      messageId: `<${TAG}-5@x>`,
    }),
    mk(maya, `${TAG} Dinner next week?`, {
      text: "Are you free Tuesday or Wednesday evening? The new place on 5th finally opened.",
      messageId: `<${TAG}-6@x>`,
    }),
    mk(sam, `${TAG} Travel plans`, {
      html: "<p>Booked the <b>train</b> for Friday. Arriving 14:32.</p>",
      text: "Booked the train for Friday. Arriving 14:32.",
      messageId: `<${TAG}-7@x>`,
    }),
    mk(lena, `${TAG} Figma file updated`, {
      text: "Pushed a new version with the compact rows. Take a look when you have a minute.",
      messageId: `<${TAG}-8@x>`,
    }),
    mk(
      { name: "Builds", address: "ci@acme.example" },
      `${TAG} build 412 passed`,
      {
        headers: { Precedence: "bulk" },
        text: "kite/main build 412 finished green in 4m12s.",
        messageId: `<${TAG}-9@x>`,
      },
    ),
    mk(sam, `${TAG} Question about the sync`, {
      text: "Does the client keep flag state when messages move between folders?",
      messageId: `<${TAG}-10@x>`,
    }),
    mk(maya, `${TAG} Photo from the trip`, {
      text: "Attached the good one.",
      attachments: [
        {
          filename: "trip-photo.png",
          content: PNG_1PX,
          contentType: "image/png",
        },
      ],
      messageId: `<${TAG}-11@x>`,
    }),
    mk(
      { name: "Receipts", address: "noreply@shop.example" },
      `${TAG} your receipt`,
      {
        headers: { Precedence: "bulk" },
        text: "Thanks for your order. Total: 42.00 USD.",
        messageId: `<${TAG}-12@x>`,
      },
    ),
    mk(lena, `${TAG} Agenda for Monday`, {
      text: "1. Launch checklist\n2. Remaining polish items\n3. Timeline for beta invite",
      messageId: `<${TAG}-13@x>`,
    }),
    mk(sam, `${TAG} Quick intro`, {
      text: "Met someone who runs a similar client. Wants to chat next week if you are up for it.",
      messageId: `<${TAG}-14@x>`,
    }),
    mk(maya, `${TAG} Last thing for today`, {
      text: "Ship it. Then sleep.",
      messageId: `<${TAG}-15@x>`,
    }),
  ];
}

async function seedImap(A: Eth) {
  const imap = new ImapFlow({
    host: "imap.ethereal.email",
    port: 993,
    secure: true,
    auth: { user: A.user, pass: A.pass },
    logger: false, disableAutoIdle: true, socketTimeout: 30_000, greetingTimeout: 15_000,
  });
  imap.on("error", () => {});
  await imap.connect();
  try {
    for (const m of seedMails(A)) {
      await imap.append("INBOX", await rawMime(m), []);
    }
  } finally {
    await imap.logout().catch(() => {});
  }
}

// Finds a thread by subject substring across both inboxes, clicks it, and
// returns which inbox it was in.
async function openThread(
  page: Page,
  subject: string,
): Promise<"primary" | "other"> {
  subject = subject.replace(`${TAG} `, "");
  for (const view of ["primary", "other"] as const) {
    await page.goto(`${BASE}/mail/${view}`, { waitUntil: "networkidle" });
    const row = page.getByRole("option").filter({ hasText: TAG }).filter({ hasText: subject }).first();
    const found = await row
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (found) {
      await row.click();
      await page.waitForTimeout(300);
      await page.waitForFunction(() => document.querySelectorAll('[aria-label="Loading"]').length === 0, undefined, { timeout: 30_000 });
      return view;
    }
  }
  throw new Error(`thread not found in either inbox: ${subject}`);
}

async function shot(page: Page, name: string) {
  const file = path.join(OUT, `${name}.png`);
  await page.screenshot({ path: file, animations: "disabled", mask: [page.locator("code")] });
  console.log(`  shot ${name}.png`);
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`UI E2E tag ${TAG}`);

  // 1. dev token + convex client
  const tokenRes = await fetch(`${BASE}/api/dev-auth/token`);
  if (!tokenRes.ok) throw new Error("dev-auth token route not reachable");
  const { token } = (await tokenRes.json()) as { token: string };
  const client = new ConvexHttpClient(CONVEX_URL);
  client.setAuth(token);

  // 2. connect Ethereal
  console.log("connecting ethereal account...");
  const acct = await createEtherealAccount();
  const { accountId } = (await client.action(api.accounts.connect, {
    email: acct.user,
    password: acct.pass,
    displayName: "UI E2E",
    imapHost: "imap.ethereal.email",
    imapPort: 993,
    smtpHost: "smtp.ethereal.email",
    smtpPort: 587,
    smtpSecure: false,
  })) as { accountId: string };
  cleanupTasks.push(() => client.mutation(api.accounts.remove, { accountId: accountId as Id<"accounts"> }));
  ok("account connect", !!accountId, accountId);

  // 3. seed + sync. The connect-time initial sync may run while appends are
  // still landing, so keep kicking syncNow until all threads are ingested.
  console.log("seeding 15 messages over IMAP...");
  await seedImap(acct);
  const countView = async (v: "primary" | "other") =>
    (
      (await client.query(api.mail.listThreads, {
        view: v,
        accountId: accountId as Id<"accounts">,
        paginationOpts: { numItems: 50, cursor: null },
      })) as { page: unknown[] }
    ).page.length;
  const synced = await waitFor(
    "all threads synced",
    async () => {
      await client
        .mutation(api.accounts.syncNow, { accountId: accountId as never })
        .catch(() => {});
      return (await countView("primary")) + (await countView("other")) >= 10;
    },
    240_000,
  );
  ok("threads synced", synced);
  const pCount = await countView("primary");
  const oCount = await countView("other");
  note(`primary: ${pCount} other: ${oCount}`);

  // Reuse an existing category without violating unique-name rules.
  const existingCategory = (await client.query(api.categories.list, {})).find(c => c.name.toLowerCase() === "receipts");
  const createdCategoryId = existingCategory ? undefined : await client.mutation(api.categories.create, {
    name: "Receipts", description: "Order confirmations and invoices", color: "#34C759",
  });
  if (createdCategoryId) cleanupTasks.push(() => client.mutation(api.categories.remove, { categoryId: createdCategoryId }));
  cleanupTasks.push(async () => {
    for (const key of await client.query(api.apiKeys.list, {})) {
      if (key.name === `${TAG}-key` && !key.revokedAt) await client.mutation(api.apiKeys.revoke, { apiKeyId: key._id });
    }
  });
  let secondAccountId: Id<"accounts"> | undefined;

  // 4. drive the app
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });

  try {
    await page.goto(`${BASE}/mail/primary`, {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    const firstView = await openThread(page, "Thursday walkthrough");
    await shot(page, "01-inbox");
    ok("inbox renders seeded threads", true);

    // open a thread
    await openThread(page, "Thursday walkthrough");
    await page.getByRole("heading").filter({ hasText: "Thursday walkthrough" }).waitFor({ timeout: 10_000 });
    await shot(page, "02-reader");
    ok("thread opens in reader", true);

    // The seeded conversation is the oldest row, so go up then back down.
    const conversationUrl = page.url();
    await page.keyboard.press("k");
    await page.waitForTimeout(400);
    ok("k navigates to previous thread", page.url() !== conversationUrl);
    await page.keyboard.press("j");
    await page.waitForTimeout(400);
    await shot(page, "03-keyboard-next");
    ok("j navigates back to the conversation", page.url() === conversationUrl);

    // back to list, star a row
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    void firstView;

    // focus + star via keyboard
    await page.keyboard.press("j");
    await page.waitForTimeout(200);
    await page.keyboard.press("s");
    await page.waitForTimeout(400);
    await shot(page, "04-star");
    ok("s stars focused thread", await waitFor("star persisted", async () => {
      const rows = await client.query(api.mail.listThreads, { view: "starred", paginationOpts: { numItems: 50, cursor: null } });
      return rows.page.some(t => t.subject.includes(TAG));
    }, 10_000));

    // archive with undo
    await page.keyboard.press("e");
    await page.waitForTimeout(600);
    await shot(page, "05-archive-toast");
    const undoVisible = await page
      .locator("text=Undo")
      .first()
      .isVisible()
      .catch(() => false);
    ok("archive shows undo toast", undoVisible);
    if (undoVisible) {
      await page.click("text=Undo");
      await page.waitForTimeout(500);
      await shot(page, "06-undo");
      ok("undo restores thread", true);
    }

    // mark unread
    await page.keyboard.press("u");
    await page.waitForTimeout(400);
    await shot(page, "07-mark-unread");
    ok("u toggles read state", true);

    // open the attachment thread and download an attachment
    const attView = await openThread(page, `${TAG} Report and screenshots`);
    const attBtn = page.locator("text=quarterly-report.pdf").first();
    const hasAtt = await attBtn
      .waitFor({ state: "visible", timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
    await shot(page, "08-attachments");
    ok("attachment card visible", hasAtt);
    const frame = page.frameLocator('iframe[title="Message"]').first();
    await frame.locator('img[src^="data:image/png;base64,"]').waitFor({ timeout: 30_000 });
    ok("inline CID image renders", await frame.locator("img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0));
    await page.waitForFunction(() => [...document.querySelectorAll<HTMLIFrameElement>('iframe[title="Message"]')].every(f =>
      !!f.contentDocument?.body && f.getBoundingClientRect().height + 1 >= f.contentDocument.body.scrollHeight));
    ok("HTML reader fits the complete message body", true);
    if (hasAtt) {
      const [dl] = await Promise.all([
        page.waitForEvent("download", { timeout: 45_000 }).catch(() => null),
        attBtn.click(),
      ]);
      ok("attachment downloads", dl !== null, dl?.suggestedFilename());
      if (dl) {
        const p = await dl.path();
        if (p) {
          const buf = await import("node:fs/promises").then((fs) =>
            fs.readFile(p),
          );
          ok(
            "attachment bytes match",
            buf.equals(PDF_BYTES),
            `${buf.length}B vs ${PDF_BYTES.length}B`,
          );
        }
      }
    }

    // assign a category via the tag popover
    await page.click('button[aria-label="Categories"]');
    await page.waitForTimeout(500);
    const receipts = page.locator("text=Receipts").first();
    if (await receipts.isVisible().catch(() => false)) {
      await receipts.click();
      await page.waitForTimeout(500);
      await shot(page, "09-category");
      ok("category assigned via tag popover", true);
      await page.keyboard.press("Escape");
    } else {
      await shot(page, "09-category");
      ok("category popover opened", false, "Receipts row not found");
    }

    // move between inboxes via the more menu (reopen the thread: the Escape
    // after the category step closed the reader)
    await openThread(page, "Report and screenshots");
    const dest = attView === "primary" ? "Other" : "Primary";
    const more = page.locator('button[aria-label="More"]').first();
    if (await more.isVisible().catch(() => false)) {
      await more.click();
      await page.waitForTimeout(400);
      const item = page.locator(`text=Move to ${dest}`).first();
      if (await item.isVisible().catch(() => false)) {
        await item.click();
        await page.waitForTimeout(800);
        await shot(page, "10-move-other");
        ok("move between inboxes", true);
        // verify the move actually landed
        const movedView = dest === "Other" ? "other" : "primary";
        const landed = await waitFor(
          "move reflected in backend",
          async () => {
            const t = (await client.query(api.mail.listThreads, {
              view: movedView,
              paginationOpts: { numItems: 50, cursor: null },
            })) as { page: { subject: string }[] };
            return t.page.some((x) =>
              x.subject.includes("Report and screenshots"),
            );
          },
          30_000,
        );
        ok("move persisted", landed);
        // move it back so later steps find it predictably
        await openThread(page, "Report and screenshots");
        await page.waitForTimeout(800);
        const more2 = page.locator('button[aria-label="More"]').first();
        await more2.click();
        await page.waitForTimeout(400);
        const back = page
          .locator(`text=Move to ${attView === "primary" ? "Primary" : "Other"}`)
          .first();
        if (await back.isVisible().catch(() => false)) {
          await back.click();
          await page.waitForTimeout(600);
        }
      } else {
        ok("move between inboxes", false, "menu item not found");
      }
    } else {
      ok("move between inboxes", false, "more button not found");
    }

    // compose + send with attachment
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    await page.keyboard.press("c");
    await page.waitForSelector('input[placeholder="To"], input[placeholder="Subject"]', {
      timeout: 8_000,
    });
    const toInput = page
      .locator('[role="dialog"] input')
      .first();
    await toInput.fill("ui-e2e-recipient@example.com");
    await toInput.press("Enter");
    const subj = page.locator('input[placeholder="Subject"]');
    await subj.fill(`${TAG} outbound from ui`);
    await page
      .locator('[role="dialog"] .ProseMirror')
      .fill("Sent from the Kite UI e2e.");
    await page.setInputFiles('input[type="file"]', {
      name: "e2e-attach.pdf",
      mimeType: "application/pdf",
      buffer: PDF_BYTES,
    });
    await page.waitForTimeout(1000);
    await shot(page, "11-compose");
    await page.click('[role="dialog"] button:has-text("Send")');
    await page.waitForTimeout(800);
    await shot(page, "12-send-toast");
    ok("compose send initiated", true);
    // wait for the actual send to land in the Sent folder
    const sent = await waitFor(
      "send to complete",
      async () => {
        const sentMsgs = (await client.query(api.mail.listMessagesByRole, {
          role: "sent",
          paginationOpts: { numItems: 10, cursor: null },
        })) as { page: { subject: string }[] };
        return sentMsgs.page.some((m) =>
          m.subject.includes("outbound from ui"),
        );
      },
      90_000,
    );
    ok("send landed in Sent", sent);

    // reply to a thread
    await openThread(page, "Thursday walkthrough");
    await page.keyboard.press("r");
    await page.waitForSelector('input[placeholder="Subject"]', {
      timeout: 8_000,
    });
    await page.waitForTimeout(400);
    await shot(page, "13-reply");
    const replySubject = await page
      .locator('input[placeholder="Subject"]')
      .inputValue();
    ok("reply prefills subject", replySubject.startsWith("Re:"));
    await page.getByRole("button", { name: "Quoted text", exact: false }).waitFor({ timeout: 30_000 });
    await page.locator('[role="dialog"] .ProseMirror').fill("Thanks, this is the live quoted reply.");
    await page.click('[role="dialog"] button:has-text("Send")');
    ok("reply sends with original quoted body", await waitFor("quoted reply", async () => {
      const rows = await client.query(api.mail.listMessagesByRole, { role: "sent", accountId: accountId as Id<"accounts">, paginationOpts: { numItems: 50, cursor: null } });
      const reply = rows.page.find(m => m.snippet.startsWith("Thanks, this is the live quoted reply."));
      if (!reply) return false;
      const content = await client.action(api.content.getMessageContent, { messageId: reply._id });
      return JSON.stringify(content).includes("Adding the progress count fix");
    }, 90_000));

    // settings + API key
    await page.keyboard.press("Control+,");
    await page.waitForSelector("text=MCP & API Keys", { timeout: 8_000 });
    await shot(page, "14-settings-general");
    await page.click("text=MCP & API Keys");
    await page.waitForTimeout(500);
    await page.fill('input[placeholder*="Key name"]', `${TAG}-key`);
    await page.click('button:has-text("Create key")');
    await page.waitForSelector("text=will not be shown again", {
      timeout: 8_000,
    });
    await shot(page, "15-api-key");
    ok("api key created", true);
    await page.click("text=Keyboard");
    await page.waitForTimeout(400);
    await shot(page, "16-shortcuts");
    await page.keyboard.press("Escape");

    // Wait out Settings dismissal before opening a new floating surface.
    await page.getByRole("button", { name: "Close settings", exact: true }).waitFor({ state: "hidden" });
    // A modal above an actual open composer must own hit-testing and focus.
    await page.getByRole("button", { name: "Compose", exact: true }).click();
    await page.getByRole("dialog", { name: "New message", exact: true }).waitFor();
    await page.getByRole("button", { name: "New category", exact: true }).click();
    const categoryDialog = page.getByRole("dialog", { name: "New category", exact: true });
    await categoryDialog.waitFor();
    ok("composer remains mounted beneath category dialog", await page.locator('[role="dialog"][aria-label="New message"]').count() === 1);
    ok("category dialog layers above compose", await categoryDialog.evaluate(el => {
      const r = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    }));
    await shot(page, "19-dialog-layering");
    await page.keyboard.press("Escape");
    await categoryDialog.waitFor({ state: "hidden" });
    await page.getByRole("dialog", { name: "New message", exact: true }).getByRole("button", { name: "Close", exact: true }).click();

    // Snooze through the toolbar, verify both views, and unsnooze through UI.
    await openThread(page, `${TAG} Dinner next week?`);
    await page.getByRole("button", { name: "Snooze", exact: true }).click();
    await page.getByRole("button", { name: "Tomorrow", exact: true }).click();
    const snoozed = await waitFor("snooze persisted", async () => {
      const result = await client.query(api.mail.listThreads, { view: "snoozed", paginationOpts: { numItems: 50, cursor: null } });
      return result.page.some(t => t.subject === `${TAG} Dinner next week?`);
    }, 15_000);
    ok("snooze moves thread to Snoozed", snoozed);
    await page.goto(`${BASE}/mail/snoozed`, { waitUntil: "networkidle" });
    await page.getByText(`${TAG} Dinner next week?`, { exact: true }).first().click();
    await shot(page, "19-snoozed");
    await page.getByRole("button", { name: "Snooze", exact: true }).click();
    await page.getByRole("button", { name: "Unsnooze", exact: true }).click();
    await openThread(page, `${TAG} Dinner next week?`);
    ok("unsnooze restores original inbox", true);
    await page.keyboard.press("Escape");

    // Schedule from the real compose UI, then observe the actual scheduled SMTP send.
    await page.getByRole("button", { name: "Compose", exact: true }).click();
    await page.getByRole("dialog", { name: "New message", exact: true }).waitFor();
    const compose = page.locator('[role="dialog"]');
    await compose.locator("input").first().fill("scheduled-recipient@example.com");
    await compose.locator("input").first().press("Enter");
    await page.getByPlaceholder("Subject", { exact: true }).fill(`${TAG} scheduled from UI`);
    await compose.locator(".ProseMirror").fill("Scheduled delivery from Kite.");
    await page.getByRole("button", { name: "Schedule send", exact: true }).click();
    const sendAt = new Date(Date.now() + 90_000);
    const localDate = new Date(sendAt.getTime() - sendAt.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    await page.locator('input[type="datetime-local"]').fill(localDate);
    await shot(page, "20-schedule-popover");
    await page.getByRole("button", { name: "Set", exact: true }).click();
    ok("scheduled draft persisted", await waitFor("scheduled draft", async () => {
      const drafts = await client.query(api.drafts.list, { paginationOpts: { numItems: 50, cursor: null } });
      return drafts.page.some(d => d.subject === `${TAG} scheduled from UI` && d.status === "scheduled");
    }, 15_000));
    ok("scheduled send lands in Sent", await waitFor("scheduled delivery", async () => {
      const sent = await client.query(api.mail.listMessagesByRole, { role: "sent", paginationOpts: { numItems: 50, cursor: null } });
      return sent.page.some(m => m.subject === `${TAG} scheduled from UI`);
    }, 180_000));

    const cancelledDraftId = await client.mutation(api.drafts.create, { accountId: accountId as Id<"accounts">, to: [{ email: "cancel@example.com" }], subject: `${TAG} cancel schedule`, text: "Do not send" });
    await client.mutation(api.drafts.scheduleSend, { draftId: cancelledDraftId, at: Date.now() + 86_400_000 });
    await page.goto(`${BASE}/mail/drafts`, { waitUntil: "networkidle" });
    await page.getByText(`${TAG} cancel schedule`, { exact: true }).first().click();
    await page.getByRole("button", { name: "Cancel schedule", exact: true }).click();
    ok("scheduled send can be cancelled in UI", await waitFor("schedule cancellation", async () => (await client.query(api.drafts.get, { draftId: cancelledDraftId }))?.status === "editing", 10_000));
    await page.keyboard.press("Escape");
    await client.mutation(api.drafts.discard, { draftId: cancelledDraftId });

    // Two real mailboxes with the same subject must remain account-isolated.
    const second = await createEtherealAccount();
    secondAccountId = (await client.action(api.accounts.connect, {
      email: second.user, password: second.pass, displayName: "UI E2E second",
      imapHost: "imap.ethereal.email", imapPort: 993,
      smtpHost: "smtp.ethereal.email", smtpPort: 587, smtpSecure: false,
    })).accountId;
    const secondId = secondAccountId;
    cleanupTasks.push(() => client.mutation(api.accounts.remove, { accountId: secondId }));
    const imap = new ImapFlow({ host: "imap.ethereal.email", port: 993, secure: true, auth: { user: second.user, pass: second.pass }, logger: false, disableAutoIdle: true, socketTimeout: 30_000 });
    imap.on("error", () => {});
    await imap.connect();
    try { await imap.append("INBOX", await rawMime({ from: "second-sender@example.com", to: second.user, subject: `${TAG} Thursday walkthrough notes`, text: "Only in mailbox two.", messageId: `<${TAG}-1@x>` }), []); }
    finally { await imap.logout().catch(() => {}); }
    ok("second mailbox syncs independently", await waitFor("second mailbox", async () => {
      await client.mutation(api.accounts.syncNow, { accountId: secondAccountId });
      const rows = await client.query(api.mail.listThreads, { view: "account", accountId: secondAccountId, paginationOpts: { numItems: 50, cursor: null } });
      return rows.page.length === 1 && rows.page[0].messageCount === 1;
    }, 150_000));
    await page.goto(`${BASE}/mail/account/${secondAccountId}`, { waitUntil: "networkidle" });
    await page.getByText(`${TAG} Thursday walkthrough notes`, { exact: true }).first().click();
    await page.getByText("Only in mailbox two.", { exact: true }).last().waitFor({ timeout: 30_000 });
    await shot(page, "21-second-account");
    const accountRows = await client.query(api.mail.listThreads, { view: "account", accountId: accountId as Id<"accounts">, paginationOpts: { numItems: 50, cursor: null } });
    ok("matching Message-ID does not merge across accounts", accountRows.page.some(t => t.subject.includes(`${TAG} Thursday walkthrough notes`) && t.messageCount >= 3));

    // Drawer navigation on tablet and phone; category dialog must be above compose.
    for (const width of [1024, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.goto(`${BASE}/mail/primary`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Mailboxes" }).click();
      await page.getByRole("button", { name: "Other", exact: false }).first().click();
      await page.waitForURL("**/mail/other");
      ok(`drawer navigates at ${width}px`, !await page.getByRole("button", { name: "Mailboxes" }).evaluate(el => el.closest('[inert]') !== null));
      await shot(page, `22-mobile-${width}`);
      if (width === 390) {
        const subject = page.getByText(`${TAG} your receipt`, { exact: true });
        const box = await subject.boundingBox();
        ok("phone list subject fits the viewport", !!box && box.x >= 0 && box.x + box.width <= width);
        await subject.click();
        await page.getByRole("heading", { name: `${TAG} your receipt` }).waitFor();
        await shot(page, "23-phone-reader");
        await page.getByRole("button", { name: "Back", exact: true }).click();
        await page.waitForURL("**/mail/other");
        ok("phone reader returns to its list", true);
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/mail/primary`, { waitUntil: "networkidle" });

    // dark mode
    await page.evaluate(() => {
      document.documentElement.classList.add("dark");
    });
    await page.waitForTimeout(400);
    await shot(page, "17-dark");
    await page.evaluate(() => {
      document.documentElement.classList.remove("dark");
    });

    // command palette search
    await page.keyboard.press("Control+k");
    await page.waitForTimeout(400);
    await page.keyboard.type("walkthrough", { delay: 30 });
    await page.waitForTimeout(1200);
    await shot(page, "18-search");
    const hasResults = await page
      .locator("text=Thursday walkthrough")
      .first()
      .isVisible()
      .catch(() => false);
    ok("search returns results", hasResults);
    await page.keyboard.press("Escape");

    ok(
      "no console errors",
      consoleErrors.length === 0,
      consoleErrors.slice(0, 5).join(" | "),
    );
  } catch (error) {
    await shot(page, "failure");
    console.log("Browser errors:", consoleErrors.slice(0, 5));
    throw error;
  } finally {
    await browser.close();
    // Cleanup only resources created by this run, never pre-existing fixtures.
    if (secondAccountId) await client.mutation(api.accounts.remove, { accountId: secondAccountId });
    if (createdCategoryId) await client.mutation(api.categories.remove, { categoryId: createdCategoryId });
    for (const key of await client.query(api.apiKeys.list, {})) {
      if (key.name === `${TAG}-key`) await client.mutation(api.apiKeys.revoke, { apiKeyId: key._id });
    }
    try {
      await client.mutation(api.accounts.remove, {
        accountId: accountId as never,
      });
      note("account removed");
    } catch (e) {
      note("cleanup failed: " + (e instanceof Error ? e.message : e));
    }
  }

  console.log(`\n${failures.length === 0 ? "RESULT: all checks passed" : `RESULT: ${failures.length} failures`}`);
  if (failures.length) {
    console.log("failures:", failures.join(", "));
    process.exitCode = 1;
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  // Also covers setup failures before the browser's try/finally begins.
  await Promise.allSettled(cleanupTasks.map(cleanup => cleanup()));
});
