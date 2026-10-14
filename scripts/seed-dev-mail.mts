// Persistent test mailboxes for manual testing. No SMTP messages are sent.
import nextEnv from "@next/env";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { ImapFlow } from "imapflow";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import https from "node:https";
import { DEV_MAILBOX_NAMES, devMailFixtures } from "./dev-mail-fixtures";

nextEnv.loadEnvConfig(process.cwd(), true);
const deployment = process.env.CONVEX_DEPLOYMENT?.split(/\s/)[0];
if (!deployment?.startsWith("dev:") && !deployment?.startsWith("local:")) {
  throw new Error("Seeding is restricted to a dev/local CONVEX_DEPLOYMENT.");
}
if (process.env.KITE_DEV_AUTH !== "1" || process.env.NEXT_PUBLIC_KITE_DEV_AUTH !== "1") {
  throw new Error("Enable the test-only dev auth harness first.");
}
const url = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!url) throw new Error("NEXT_PUBLIC_CONVEX_URL is missing.");
if (deployment.startsWith("dev:") && new URL(url).hostname !== `${deployment.slice(4)}.convex.cloud`) {
  throw new Error("NEXT_PUBLIC_CONVEX_URL does not match the selected dev deployment.");
}
const tokenRes = await fetch("http://localhost:3000/api/dev-auth/token", { signal: AbortSignal.timeout(15_000) });
if (!tokenRes.ok) throw new Error("Start npm run dev with the dev-auth harness enabled.");
const { token } = await tokenRes.json() as { token: string };
const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()) as { sub: string; iss: string };
if (claims.sub !== "live-e2e-user" || claims.iss !== (process.env.KITE_DEV_AUTH_ISSUER ?? "http://localhost:3000/api/dev-auth")) {
  throw new Error("The local server is not using the expected dev identity/issuer.");
}
const client = new ConvexHttpClient(url);
client.setAuth(token);
const existing = await client.query(api.accounts.list, {}); // Verify auth before creating anything.

function createEthereal(): Promise<{ user: string; pass: string }> {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: "api.nodemailer.com", path: "/user", method: "POST", headers: { "Content-Type": "application/json" } }, res => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("error", reject);
      res.on("end", () => {
        try {
          const account = JSON.parse(body) as { user?: string; pass?: string };
          if (res.statusCode !== 200 || !account.user || !account.pass) throw new Error("Ethereal account creation failed.");
          resolve({ user: account.user, pass: account.pass });
        } catch (error) { reject(error); }
      });
    });
    req.setTimeout(30_000, () => req.destroy(new Error("Ethereal request timed out.")));
    req.on("error", reject);
    req.end(JSON.stringify({ requestor: "kite-manual-dev", version: "1.0" }));
  });
}

for (const [index, displayName] of DEV_MAILBOX_NAMES.entries()) {
  if (existing.some(a => a.displayName === displayName && a.imapHost === "imap.ethereal.email")) {
    console.log(`${displayName} already exists; leaving your test changes intact.`);
    continue;
  }
  console.log(`Creating ${displayName}...`);
  const account = await createEthereal();
  const imap = new ImapFlow({ host: "imap.ethereal.email", port: 993, secure: true,
    auth: { user: account.user, pass: account.pass }, logger: false, disableAutoIdle: true,
    socketTimeout: 30_000, greetingTimeout: 15_000 });
  imap.on("error", () => {});
  try {
    await imap.connect();
    const boxes = await imap.list();
    const paths = { inbox: "INBOX", sent: "Sent", archive: "Archive", trash: "Trash" };
    for (const role of ["sent", "archive", "trash"] as const) {
      const match = boxes.find(b => b.specialUse?.toLowerCase() === `\\${role}` || b.path.toLowerCase() === role);
      if (match) paths[role] = match.path;
      else await imap.mailboxCreate(paths[role]);
    }
    for (const fixture of devMailFixtures(account.user, index === 1)) {
      const source = await new Promise<Buffer>((resolve, reject) => new MailComposer(fixture.mail).compile().build((err, bytes) => err ? reject(err) : resolve(bytes)));
      await imap.append(paths[fixture.folder], source, fixture.flags, fixture.mail.date as Date);
    }
  } finally { await imap.logout().catch(() => {}); }

  const { accountId } = await client.action(api.accounts.connect, {
    email: account.user, password: account.pass, displayName,
    imapHost: "imap.ethereal.email", imapPort: 993,
    smtpHost: "smtp.ethereal.email", smtpPort: 587, smtpSecure: false,
  });
  // Keep a successfully connected account on failure so it can be inspected in Settings.
  const deadline = Date.now() + 240_000;
  let synced = false;
  while (Date.now() < deadline) {
    const inbox = await client.query(api.mail.listThreads, { view: "account", accountId, paginationOpts: { numItems: 50, cursor: null } });
    if (inbox.page.length >= 7) {
      const thread = await client.query(api.mail.getThread, { threadId: inbox.page[0]._id });
      await client.action(api.content.getMessageContent, { messageId: thread.messages[0]._id });
      synced = true;
      break;
    }
    const state = (await client.query(api.accounts.list, {})).find(a => a._id === accountId);
    if (state?.status === "auth_error" || state?.status === "error") {
      throw new Error(`${displayName} sync failed: ${state.lastError ?? state.status}`);
    }
    await client.mutation(api.accounts.syncNow, { accountId });
    await new Promise(resolve => setTimeout(resolve, 5_000));
  }
  if (!synced) throw new Error(`${displayName} is connected but sync timed out; inspect Settings and retry sync.`);
  await client.mutation(api.drafts.create, {
    accountId, to: [{ name: "Sample recipient", email: "friend0@kite-test.example" }],
    subject: index === 1 ? "Draft: next week's priorities" : "Draft: catch up soon?",
    text: "This is an unsent sample draft. Try editing it or switching the sender.",
    html: "<p>This is an unsent sample draft. Try editing it or switching the sender.</p>",
  });
  console.log(`${displayName}: ${account.user} — 12 messages and 1 draft; inbox and reader verified.`);
}
console.log("Done. Reload /mail/primary. Remove these mailboxes in Settings → Connections to reset, then rerun this script.");
