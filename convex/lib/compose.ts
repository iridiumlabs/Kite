import { isOwner, normalizeEmail, displayName } from "./addresses";
import { replySubject, forwardSubject } from "./subject";
import type { Address } from "./types";

export interface ComposeOriginal {
  messageIdHeader: string;
  references: string[];
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  replyTo: Address[];
  date: number;
}

// Recipients for a reply: Reply-To wins over From. Reply-all adds the
// original To and Cc minus every address the owner controls, deduped.
export function replyRecipients(
  original: ComposeOriginal,
  replyAll: boolean,
  ownerEmails: string[],
): { to: Address[]; cc: Address[] } {
  const to: Address[] =
    original.replyTo.length > 0 ? [...original.replyTo] : [original.from];
  if (!replyAll) return { to, cc: [] };
  const seen = new Set(to.map((a) => normalizeEmail(a.email)));
  const cc: Address[] = [];
  for (const addr of [...original.to, ...original.cc]) {
    const email = normalizeEmail(addr.email);
    if (seen.has(email)) continue;
    if (isOwner(email, ownerEmails)) continue;
    seen.add(email);
    cc.push(addr);
  }
  return { to, cc };
}

export function threadingHeaders(original: ComposeOriginal): {
  inReplyTo: string;
  references: string[];
} {
  return {
    inReplyTo: original.messageIdHeader,
    references: [...original.references, original.messageIdHeader].slice(-30),
  };
}

export function replySubjectFor(original: ComposeOriginal): string {
  return replySubject(original.subject);
}

export function forwardSubjectFor(original: ComposeOriginal): string {
  return forwardSubject(original.subject);
}

export function newMessageId(domain: string): string {
  const uuid =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 14)}`;
  return `${uuid}@${domain}`;
}

export function wroteAttribution(date: number, from: Address): string {
  const d = new Date(date);
  const stamp = Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
  const who = `${displayName(from)} <${from.email}>`;
  return stamp ? `On ${stamp}, ${who} wrote:` : `${who} wrote:`;
}

export function quoteHtml(htmlOrText: string, isHtml: boolean): string {
  const body = isHtml ? htmlOrText : escapeHtml(htmlOrText).replace(/\n/g, "<br>");
  return `<blockquote type="cite" style="margin:0 0 0 0.8ex;border-left:1px #ccc solid;padding-left:1ex">${body}</blockquote>`;
}

export function quoteText(text: string): string {
  return text
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
}

export function forwardHeaderBlock(
  original: ComposeOriginal,
  toHeader: Address[],
): { html: string; text: string } {
  const lines = [
    "---------- Forwarded message ---------",
    `From: ${displayName(original.from)} <${original.from.email}>`,
    `Date: ${new Date(original.date).toUTCString()}`,
    `Subject: ${original.subject}`,
    `To: ${toHeader.map((a) => (a.name ? `${a.name} <${a.email}>` : a.email)).join(", ")}`,
    "",
  ];
  const text = lines.join("\n");
  const html = lines.map(escapeHtml).join("<br>");
  return { html, text };
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const BLOCK_TAG_RE =
  /<\/(p|div|blockquote|li|tr|table|h[1-6]|ul|ol|section|article|header|footer)>/gi;
const BR_RE = /<br\s*\/?>/gi;
const TAG_RE = /<[^>]+>/g;
const ENTITIES: [RegExp, string][] = [
  [/&nbsp;/g, " "],
  [/&amp;/g, "&"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&quot;/g, '"'],
  [/&#39;|&apos;/g, "'"],
];

// Generates the text alternative for an HTML body when none was provided.
export function htmlToText(html: string): string {
  let s = html;
  s = s.replace(/<style[\s\S]*?<\/style>/gi, " ");
  s = s.replace(/<script[\s\S]*?<\/script>/gi, " ");
  s = s.replace(BLOCK_TAG_RE, "\n");
  s = s.replace(BR_RE, "\n");
  s = s.replace(TAG_RE, "");
  for (const [re, rep] of ENTITIES) s = s.replace(re, rep);
  return s
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
