"use node";

import { simpleParser } from "mailparser";
import type { Attachment, ParsedMail as MpParsedMail } from "mailparser";
import type { ParsedMail, ParserPort } from "../lib/ports";
import type { Address } from "../lib/types";
import { normalizeMessageId } from "../lib/addresses";

function addressObjects(value: MpParsedMail["to"]): Address[] {
  if (!value) return [];
  const groups = Array.isArray(value) ? value : [value];
  const out: Address[] = [];
  for (const g of groups) {
    for (const a of g.value ?? []) {
      if (!a.address) continue;
      out.push({ name: a.name || undefined, email: a.address });
    }
  }
  return out;
}

function attachmentId(a: Attachment, index: number): string {
  if (a.partId) return a.partId;
  if (a.checksum) return a.checksum;
  return `part-${index + 1}`;
}

function headerValue(
  headers: MpParsedMail["headers"],
  key: string,
): string | undefined {
  const v = headers.get(key);
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(String).join(", ");
  if (typeof v === "object" && "value" in (v as object)) {
    const inner = (v as { value?: unknown }).value;
    if (typeof inner === "string") return inner;
    if (Array.isArray(inner)) return inner.map(String).join(" ");
    return String(inner ?? "");
  }
  return String(v);
}

export function toParsedMail(parsed: MpParsedMail): ParsedMail {
  const headers: Record<string, string> = {};
  for (const key of [
    "message-id",
    "in-reply-to",
    "references",
    "list-unsubscribe",
    "list-id",
    "precedence",
    "auto-submitted",
    "x-kite-draft-id",
    "reply-to",
    "date",
    "subject",
    "from",
    "to",
    "cc",
  ]) {
    const v = headerValue(parsed.headers, key);
    if (v !== undefined) headers[key] = v;
  }

  const refs = parsed.references;
  const references = (Array.isArray(refs) ? refs : refs ? [refs] : [])
    .flatMap((r: string) => String(r).split(/\s+/))
    .map((r: string) => normalizeMessageId(r))
    .filter(Boolean)
    .slice(-30);

  return {
    subject: parsed.subject ?? "",
    from: addressObjects(parsed.from)[0] ?? { email: "" },
    to: addressObjects(parsed.to),
    cc: addressObjects(parsed.cc),
    bcc: addressObjects(parsed.bcc),
    replyTo: addressObjects(parsed.replyTo),
    date: parsed.date ? parsed.date.getTime() : undefined,
    messageIdHeader: parsed.messageId
      ? normalizeMessageId(parsed.messageId)
      : undefined,
    inReplyTo: parsed.inReplyTo
      ? normalizeMessageId(parsed.inReplyTo)
      : undefined,
    references,
    text: parsed.text || undefined,
    html:
      typeof parsed.html === "string" && parsed.html.length > 0
        ? parsed.html
        : undefined,
    attachments: parsed.attachments.slice(0, 25).map((a, i) => ({
      id: attachmentId(a, i),
      filename: a.filename ?? "attachment",
      contentType: a.contentType || "application/octet-stream",
      size: a.size ?? a.content?.length ?? 0,
      cid: a.cid ?? undefined,
      inline: a.contentDisposition === "inline" || !!a.cid,
      content: a.content ? new Uint8Array(a.content) : undefined,
    })),
    headers,
  };
}

export class MailParserPort implements ParserPort {
  async parse(source: Uint8Array | string): Promise<ParsedMail> {
    const parsed = await simpleParser(
      typeof source === "string" ? source : Buffer.from(source),
    );
    return toParsedMail(parsed);
  }

  async decodePart(
    data: Uint8Array,
    contentType?: string,
    encoding?: string,
  ): Promise<string> {
    const wrapped = Buffer.concat([
      Buffer.from(
        `Content-Type: ${contentType ?? "text/plain"}; charset=utf-8\r\nContent-Transfer-Encoding: ${encoding ?? "8bit"}\r\n\r\n`,
      ),
      Buffer.from(data),
    ]);
    const parsed = await simpleParser(wrapped);
    return parsed.text ?? "";
  }
}
