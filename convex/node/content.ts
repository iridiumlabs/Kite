"use node";

import { v } from "convex/values";
import { internalAction, type ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import { Id } from "../_generated/dataModel";
import sanitizeHtml from "sanitize-html";
import { connectImap, FlowPort, accountToImapConfig } from "./imap";
import { MailParserPort } from "./mailParser";
import { decryptCredentials } from "./crypto";
import { rewriteCidReferences, blockRemoteImages } from "../lib/html";
import { splitHtmlQuote, splitTextQuote } from "../lib/quoteSplit";
import type { ParsedMail } from "../lib/ports";
import { checkReceivedAttachmentSize } from "../lib/attachmentLimits";

const INLINE_CID_MAX = 3 * 1024 * 1024;

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "a", "abbr", "address", "article", "aside", "b", "bdi", "bdo",
    "blockquote", "br", "caption", "center", "cite", "code", "col",
    "colgroup", "dd", "del", "details", "dfn", "div", "dl", "dt", "em",
    "figcaption", "figure", "font", "footer", "h1", "h2", "h3", "h4",
    "h5", "h6", "header", "hr", "i", "img", "ins", "kbd", "li", "main",
    "mark", "nav", "ol", "p", "pre", "q", "rp", "rt", "ruby", "s",
    "samp", "section", "small", "span", "strike", "strong", "sub",
    "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead",
    "time", "tr", "u", "ul", "var", "wbr",
  ],
  allowedAttributes: {
    "*": [
      "align", "bgcolor", "border", "cellpadding", "cellspacing", "color",
      "dir", "height", "lang", "style", "title", "valign", "width",
    ],
    a: ["href", "name", "target", "rel"],
    img: ["src", "alt", "data-src", "width", "height"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan"],
    col: ["span"],
    colgroup: ["span"],
    ol: ["start", "type"],
    ul: ["type"],
    li: ["value"],
    time: ["datetime"],
  },
  allowedSchemes: ["http", "https", "mailto", "cid", "data"],
  allowedSchemesByTag: {
    img: ["http", "https", "data", "cid"],
    a: ["http", "https", "mailto"],
  },
  disallowedTagsMode: "discard",
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" },
    }),
  },
};

// Sanitizes email HTML: no scripts/iframes/objects/forms/event handlers/
// javascript: URLs/base/meta refresh. Inline styles are kept except known
// scriptable CSS vectors.
export function sanitizeEmailHtml(html: string): string {
  let out = sanitizeHtml(html, SANITIZE_OPTIONS);
  out = out.replace(/style\s*=\s*(["'])(?:(?!\1)[\s\S])*?(?:expression|javascript|behaviou?r\s*:|-moz-binding|@import)(?:(?!\1)[\s\S])*\1/gi, '');
  out = out.replace(/<\s*meta[^>]*>/gi, "");
  out = out.replace(/<\s*base[^>]*>/gi, "");
  return out;
}

// Shared resolver: returns the IMAP port + coordinates, or reports the
// message moved and triggers a resync.
async function resolveRemote(
  ctx: Pick<ActionCtx, "runQuery" | "runMutation" | "scheduler">,
  messageId: Id<"messages">,
): Promise<
  | {
      port: FlowPort;
      close: () => Promise<void>;
      folderPath: string;
      uid: number;
      accountId: Id<"accounts">;
    }
  | { storageId: Id<"_storage">; accountId: Id<"accounts"> }
  | { moved: true }
> {
  const ref = await ctx.runQuery(internal.syncStore.messageRemoteRef, {
    messageId,
  });
  if (!ref || !ref.message) throw new Error("Message not found");
  const m = ref.message;
  if (m.uid === undefined || !ref.folderPath) {
    if (m.sourceStorageId) {
      return { storageId: m.sourceStorageId, accountId: m.accountId };
    }
    await ctx.scheduler.runAfter(0, internal.node.sync.syncAccount, {
      accountId: m.accountId,
    });
    return { moved: true };
  }
  const secret = await ctx.runQuery(internal.syncStore.getSecret, {
    accountId: m.accountId,
  });
  const account = await ctx.runQuery(internal.syncStore.getAccountDoc, {
    accountId: m.accountId,
  });
  if (!secret || !account) throw new Error("Account not found");
  const { username, password } = decryptCredentials(secret);
  const cfg = accountToImapConfig(account);
  const client = await connectImap({ ...cfg, username, password });
  const port = new FlowPort(client);
  return {
    port,
    close: async () => {
      await client.logout().catch(() => client.close());
    },
    folderPath: ref.folderPath,
    uid: m.uid,
    accountId: m.accountId,
  };
}

const parser = new MailParserPort();

interface MessageContentResult {
  html?: string;
  quotedHtml?: string;
  text?: string;
  quotedText?: string;
  attachments: Pick<ParsedMail["attachments"][number], "id" | "filename" | "contentType" | "size" | "inline">[];
  headers: Pick<ParsedMail, "date" | "from" | "to" | "cc" | "replyTo"> & { listUnsubscribe?: string };
  remoteImagesBlocked: number;
  loadRemoteImages?: boolean;
  accountId: string;
}

export const getMessageContent = internalAction({
  args: { messageId: v.id("messages"), loadRemoteImages: v.optional(v.boolean()) },
  handler: async (ctx, args): Promise<MessageContentResult> => {
    const resolved = await resolveRemote(ctx, args.messageId);
    if ("moved" in resolved) {
      throw new Error(
        "This message moved. Refreshing the mailbox, try again in a moment.",
      );
    }
    const { accountId } = resolved;
    let src: Uint8Array;
    let close: (() => Promise<void>) | undefined;
    if ("storageId" in resolved) {
      const blob = await ctx.storage.get(resolved.storageId);
      if (!blob) throw new Error("Message source not found");
      src = new Uint8Array(await blob.arrayBuffer());
    } else {
      const { port, folderPath, uid } = resolved;
      close = resolved.close;
      src = await port.fetchSource(folderPath, uid);
    }
    try {
      const parsed = await parser.parse(src);
      const ref = await ctx.runQuery(internal.syncStore.messageRemoteRef, {
        messageId: args.messageId,
      });
      const settings = await ctx.runQuery(
        internal.syncStore.settingsForUser,
        { userId: ref!.message.userId },
      );
      const loadRemote: boolean = args.loadRemoteImages ?? settings?.loadRemoteImages ?? false;

      const cidMap = new Map<string, string>();
      let inlineTotal = 0;
      for (const att of parsed.attachments) {
        if (!att.cid || !att.content) continue;
        if (inlineTotal + att.content.length > INLINE_CID_MAX) continue;
        inlineTotal += att.content.length;
        const b64 = Buffer.from(att.content).toString("base64");
        const uri = `data:${att.contentType};base64,${b64}`;
        cidMap.set(att.cid, uri);
        // mailparser keeps Content-ID angle brackets on some inputs;
        // store a normalized key too so the rewrite always matches.
        cidMap.set(att.cid.replace(/[<>]/g, ""), uri);
      }

      let html = parsed.html ? sanitizeEmailHtml(parsed.html) : undefined;
      let remoteImagesBlocked = 0;
      if (html) {
        const rw = rewriteCidReferences(html, cidMap);
        html = rw.html;
        if (!loadRemote) {
          const blocked = blockRemoteImages(html);
          html = blocked.html;
          remoteImagesBlocked = blocked.blocked;
        }
        const split = splitHtmlQuote(html);
        html = split.html;
        return {
          html,
          quotedHtml: split.quotedHtml,
          text: parsed.text,
          quotedText: parsed.text
            ? splitTextQuote(parsed.text).quotedText
            : undefined,
          attachments: parsed.attachments.map((a) => ({
            id: a.id,
            filename: a.filename,
            contentType: a.contentType,
            size: a.size,
            inline: a.inline,
          })),
          headers: {
            date: parsed.date,
            from: parsed.from,
            to: parsed.to,
            cc: parsed.cc,
            replyTo: parsed.replyTo,
            listUnsubscribe: parsed.headers["list-unsubscribe"],
          },
          remoteImagesBlocked,
          loadRemoteImages: loadRemote,
          accountId: accountId as string,
        };
      }
      const text = parsed.text ?? "";
      const splitText = splitTextQuote(text);
      return {
        text: splitText.text,
        quotedText: splitText.quotedText,
        attachments: parsed.attachments.map((a) => ({
          id: a.id,
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
          inline: a.inline,
        })),
        headers: {
          date: parsed.date,
          from: parsed.from,
          to: parsed.to,
          cc: parsed.cc,
          replyTo: parsed.replyTo,
          listUnsubscribe: parsed.headers["list-unsubscribe"],
        },
        remoteImagesBlocked: 0,
        accountId: accountId as string,
      };
    } finally {
      if (close) await close();
    }
  },
});

export const fetchAttachmentData = internalAction({
  args: { messageId: v.id("messages"), attachmentId: v.string() },
  handler: async (ctx, args) => {
    const resolved = await resolveRemote(ctx, args.messageId);
    if ("moved" in resolved) {
      throw new Error(
        "This message moved. Refreshing the mailbox, try again in a moment.",
      );
    }
    let src: Uint8Array;
    let close: (() => Promise<void>) | undefined;
    if ("storageId" in resolved) {
      const blob = await ctx.storage.get(resolved.storageId);
      if (!blob) throw new Error("Message source not found");
      src = new Uint8Array(await blob.arrayBuffer());
    } else {
      const { port, folderPath, uid } = resolved;
      close = resolved.close;
      src = await port.fetchSource(folderPath, uid);
    }
    try {
      const parsed = await parser.parse(src);
      const att = parsed.attachments.find(
        (a) => a.id === args.attachmentId || a.cid === args.attachmentId,
      );
      if (!att || !att.content) throw new Error("Attachment not found");
      checkReceivedAttachmentSize(att.content.length);
      return new Uint8Array(att.content).buffer as ArrayBuffer;
    } finally {
      if (close) await close();
    }
  },
});

export const downloadAttachment = internalAction({
  args: { messageId: v.id("messages"), attachmentId: v.string() },
  handler: async (ctx, args) => {
    const resolved = await resolveRemote(ctx, args.messageId);
    if ("moved" in resolved) {
      throw new Error(
        "This message moved. Refreshing the mailbox, try again in a moment.",
      );
    }
    let src: Uint8Array;
    let close: (() => Promise<void>) | undefined;
    if ("storageId" in resolved) {
      const blob = await ctx.storage.get(resolved.storageId);
      if (!blob) throw new Error("Message source not found");
      src = new Uint8Array(await blob.arrayBuffer());
    } else {
      const { port, folderPath, uid } = resolved;
      close = resolved.close;
      src = await port.fetchSource(folderPath, uid);
    }
    try {
      const parsed = await parser.parse(src);
      const att = parsed.attachments.find(
        (a) => a.id === args.attachmentId || a.cid === args.attachmentId,
      );
      if (!att || !att.content) throw new Error("Attachment not found");
      checkReceivedAttachmentSize(att.content.length);
      return {
        filename: att.filename,
        contentType: att.contentType,
        size: att.size,
        data: new Uint8Array(att.content).buffer as ArrayBuffer,
      };
    } finally {
      if (close) await close();
    }
  },
});
