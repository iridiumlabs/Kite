import type { Address } from "./types";

export function normalizeMessageId(id: string | undefined | null): string {
  if (!id) return "";
  let s = id.trim();
  if (s.startsWith("<")) s = s.slice(1);
  if (s.endsWith(">")) s = s.slice(0, -1);
  return s.trim().toLowerCase();
}

// Extracts every normalized message-id from a References-style header value
// (a whitespace separated list of <id> tokens).
export function parseMessageIdList(value: string | undefined | null): string[] {
  if (!value) return [];
  const out: string[] = [];
  const re = /<([^>]+)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(value)) !== null) {
    const id = normalizeMessageId(m[1]);
    if (id) out.push(id);
  }
  if (out.length === 0) {
    const id = normalizeMessageId(value);
    if (id) out.push(id);
  }
  return out;
}

export function parseAddressList(
  value: string | undefined | null,
): Address[] {
  if (!value) return [];
  const out: Address[] = [];
  for (const part of splitAddresses(value)) {
    const addr = parseAddress(part);
    if (addr) out.push(addr);
  }
  return out;
}

function splitAddresses(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuote = false;
  let start = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (inQuote) {
      if (c === "\\") i++;
      else if (c === '"') inQuote = false;
    } else if (c === '"') {
      inQuote = true;
    } else if (c === "<" || c === "(") {
      depth++;
    } else if (c === ">" || c === ")") {
      depth = Math.max(0, depth - 1);
    } else if (c === "," && depth === 0) {
      parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(value.slice(start));
  return parts;
}

export function parseAddress(raw: string): Address | null {
  const s = raw.trim();
  if (!s) return null;
  const lt = s.lastIndexOf("<");
  if (lt !== -1) {
    const gt = s.indexOf(">", lt);
    const email = s.slice(lt + 1, gt === -1 ? undefined : gt).trim();
    if (!email) return null;
    let name = s.slice(0, lt).trim();
    if (name.startsWith('"') && name.endsWith('"') && name.length >= 2) {
      name = name.slice(1, -1).replace(/\\(.)/g, "$1");
    }
    // Drop trailing group comments like "(undisclosed)".
    name = name.replace(/\([^)]*\)\s*$/, "").trim();
    return { name: name || undefined, email: email.toLowerCase() };
  }
  const email = s.replace(/[()]/g, "").trim();
  if (!email || !email.includes("@")) return null;
  return { email: email.toLowerCase() };
}

export function formatAddress(addr: Address): string {
  const email = addr.email;
  const name = addr.name?.trim();
  if (!name) return email;
  const needsQuote = /[",;:@()<>[\]\\]/.test(name);
  const display = needsQuote ? `"${name.replace(/(["\\])/g, "\\$1")}"` : name;
  return `${display} <${email}>`;
}

export function formatAddressList(addrs: Address[]): string {
  return addrs.map(formatAddress).join(", ");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isOwner(
  email: string | Address,
  ownerEmails: string[],
): boolean {
  const e = normalizeEmail(typeof email === "string" ? email : email.email);
  return ownerEmails.some((o) => normalizeEmail(o) === e);
}

export function displayName(addr: Address): string {
  const name = addr.name?.trim();
  if (name) return name;
  const local = addr.email.split("@")[0] ?? addr.email;
  const cleaned = local.replace(/[._-]+/g, " ").trim();
  return cleaned || addr.email;
}

export function initials(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((w) => /[A-Za-z0-9]/.test(w));
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0][0]!.toUpperCase();
  return (words[0][0]! + words[words.length - 1][0]!).toUpperCase();
}
