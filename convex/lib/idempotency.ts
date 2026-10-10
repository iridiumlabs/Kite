import { normalizeEmail } from "./addresses";
import type { Address } from "./types";

export interface SendContentInput {
  accountId: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  text: string;
  html?: string;
  attachments: { filename: string; size: number }[];
}

export async function sha256Hex(data: string): Promise<string> {
  const bytes = new TextEncoder().encode(data);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeBody(text: string, html?: string): string {
  const s = html ? html.replace(/<[^>]*>/g, " ") + " " + text : text;
  return s.replace(/\s+/g, " ").trim();
}

function sortedEmails(addrs: Address[]): string[] {
  return addrs.map((a) => normalizeEmail(a.email)).sort();
}

// Content hash used for duplicate-send detection: same account, same
// recipients (order-insensitive), same subject and normalized body, same
// attachment names and sizes.
export async function sendContentHash(
  input: SendContentInput,
): Promise<string> {
  const attachments = input.attachments
    .map((a) => `${a.filename}:${a.size}`)
    .sort();
  const canonical = JSON.stringify([
    input.accountId,
    sortedEmails(input.to),
    sortedEmails(input.cc),
    sortedEmails(input.bcc),
    input.subject.trim(),
    normalizeBody(input.text, input.html),
    attachments,
  ]);
  return sha256Hex(canonical);
}
