// Shared, local-only setup for the preserved reader/sync diagnostic scripts.
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import { ImapFlow } from "imapflow";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import https from "node:https";

export const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export const errorText = (error: unknown) => error instanceof Error ? error.message.slice(0, 150) : "Unknown error";

export async function diagnosticMailbox(threaded: boolean) {
  const tokenRes = await fetch("http://localhost:3000/api/dev-auth/token");
  if (!tokenRes.ok) throw new Error("Start the dev-auth application first.");
  const { token } = await tokenRes.json() as { token: string };
  const client = new ConvexHttpClient("http://127.0.0.1:3210");
  client.setAuth(token);
  const account = await new Promise<{ user: string; pass: string }>((resolve, reject) => {
    const req = https.request({ hostname: "api.nodemailer.com", path: "/user", method: "POST", headers: { "Content-Type": "application/json" } }, res => {
      let body = "";
      res.on("data", chunk => body += chunk);
      res.on("end", () => {
        try {
          const value = JSON.parse(body) as { user?: string; pass?: string };
          if (!value.user || !value.pass) throw new Error("Ethereal account creation failed");
          resolve({ user: value.user, pass: value.pass });
        } catch (error) { reject(error); }
      });
    });
    req.setTimeout(30_000, () => req.destroy(new Error("Ethereal request timed out")));
    req.on("error", reject);
    req.end(JSON.stringify({ requestor: "kite-diagnostic", version: "1.0" }));
  });
  const { accountId } = await client.action(api.accounts.connect, {
    email: account.user, password: account.pass, displayName: "Diagnostic",
    imapHost: "imap.ethereal.email", imapPort: 993,
    smtpHost: "smtp.ethereal.email", smtpPort: 587, smtpSecure: false,
  });
  const cleanup = () => client.mutation(api.accounts.remove, { accountId });
  const imap = new ImapFlow({ host: "imap.ethereal.email", port: 993, secure: true, auth: { user: account.user, pass: account.pass }, logger: false });
  try {
    await imap.connect();
    for (let i = 0; i < (threaded ? 3 : 6); i++) {
      const source = await new Promise<Buffer>((resolve, reject) => new MailComposer({
        from: `sender${i}@example.com`, to: account.user,
        subject: threaded ? "Diagnostic thread" : `Diagnostic ${i}`, text: `body ${i}`,
        messageId: `<diagnostic${i}@x>`,
        inReplyTo: threaded && i ? `<diagnostic${i - 1}@x>` : undefined,
      }).compile().build((err, bytes) => err ? reject(err) : resolve(bytes)));
      await imap.append("INBOX", source, []);
    }
  } catch (error) { await cleanup(); throw error; }
  finally { await imap.logout().catch(() => {}); }
  return { client, accountId, cleanup };
}
