// Reading tools: thread listing, search, thread/message fetch, attachments.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import {
  formatMessage,
  formatThread,
  type BodyFormatOpts,
  type MessageContent,
  type MessageDoc,
} from "../format";
import type { KiteBackend as Backend } from "../backend";
import {
  addTool,
  okResult,
  zCursor,
  zLimit,
  zListOut,
  zMessageOut,
  zThreadOut,
  type BackendFor,
} from "./common";

const zBodyFormat = z
  .enum(["text", "html", "both"])
  .default("text")
  .describe("Which body variant to return (default text)");

const zBodyOpts = {
  includeBody: z.boolean().default(true).describe("Fetch the body from the mail server"),
  format: zBodyFormat,
  maxBodyChars: z
    .number()
    .int()
    .min(100)
    .max(200000)
    .default(20000)
    .describe("Body truncation limit in characters (default 20000)"),
  includeQuoted: z
    .boolean()
    .default(false)
    .describe("Also return quoted reply/forward content split from the body"),
};

async function categoryMap(backend: Backend) {
  const cats = await backend.listCategories();
  return new Map(cats.map((c) => [c._id, { id: c._id, name: c.name }]));
}

async function accountMap(backend: Backend) {
  const accounts = await backend.listAccounts();
  return new Map(accounts.map((a) => [a._id, a.email]));
}

async function runLimited<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function bodyOpts(a: {
  format: "text" | "html" | "both";
  maxBodyChars: number;
  includeQuoted: boolean;
}): BodyFormatOpts {
  return { format: a.format, maxBodyChars: a.maxBodyChars, includeQuoted: a.includeQuoted };
}

const FOLDER_VIEWS = [
  "inbox",
  "junk",
  "sent",
  "drafts",
  "archive",
  "trash",
  "local",
] as const;

export function registerReadingTools(server: McpServer, getBackend: BackendFor) {
  addTool(
    server,
    getBackend,
    "list_threads",
    {
      title: "List threads",
      description:
        "Lists conversation threads in a view: primary or other inbox, archive, trash, snoozed, starred, one account's inbox, or one category (category needs categoryId). Newest activity first; paginate with nextCursor.",
      inputSchema: z.object({
        view: z.enum([
          "primary",
          "other",
          "archive",
          "trash",
          "snoozed",
          "starred",
          "account",
          "category",
        ]),
        accountId: z.string().optional(),
        categoryId: z
          .string()
          .optional()
          .describe("Required when view is category"),
        unreadOnly: z.boolean().optional(),
        starredOnly: z.boolean().optional(),
        hasAttachments: z.boolean().optional(),
        limit: zLimit,
        cursor: zCursor,
      }),
      outputSchema: zListOut(zThreadOut),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args, backend) => {
      const res = await backend.listThreads({
        view: args.view,
        accountId: args.accountId,
        categoryId: args.categoryId,
        filter: {
          unread: args.unreadOnly,
          starred: args.starredOnly,
          hasAttachments: args.hasAttachments,
        },
        numItems: args.limit,
        cursor: args.cursor ?? null,
      });
      const [acctMap, catMap] = await Promise.all([
        accountMap(backend),
        categoryMap(backend),
      ]);
      return {
        items: res.items.map((t) => formatThread(t, acctMap.get(t.accountId), catMap)),
        nextCursor: res.nextCursor,
      };
    },
  );

  addTool(
    server,
    getBackend,
    "search_emails",
    {
      title: "Search emails",
      description:
        "Finds messages three ways and reports which ran in `source`: with only free text it uses the local subject/sender/snippet index; add structured filters (from, to, subject, inbox, folder, category, dates, flags) for a filtered scan; set searchServer true for a full IMAP search including bodies and mail older than the synced window. At most 100 results per call.",
      inputSchema: z.object({
        query: z.string().optional().describe("Free text searched against subject, sender, and snippet (or the whole message when searchServer is true)"),
        accountId: z.string().optional(),
        folder: z.enum(FOLDER_VIEWS).optional(),
        inbox: z.enum(["primary", "other"]).optional(),
        categoryId: z.string().optional(),
        from: z.string().optional(),
        to: z.string().optional(),
        subject: z.string().optional(),
        unread: z.boolean().optional(),
        starred: z.boolean().optional(),
        hasAttachments: z.boolean().optional(),
        after: z.string().optional().describe("ISO 8601 lower date bound"),
        before: z.string().optional().describe("ISO 8601 upper date bound"),
        searchServer: z
          .boolean()
          .optional()
          .describe("IMAP full-text search including bodies; slower but finds unsynced and body-only matches"),
        limit: zLimit,
        cursor: zCursor,
      }),
      outputSchema: z.object({
        source: z.enum(["index", "filters", "server"]),
        items: z.array(zMessageOut),
        nextCursor: z.string().nullable(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args, backend) => {
      const catMap = await categoryMap(backend);
      const fmt = (m: MessageDoc) => formatMessage(m, catMap);
      const after = args.after ? Date.parse(args.after) : undefined;
      const before = args.before ? Date.parse(args.before) : undefined;
      if (args.after && Number.isNaN(after)) throw new Error("after must be an ISO 8601 date");
      if (args.before && Number.isNaN(before)) throw new Error("before must be an ISO 8601 date");

      if (args.searchServer) {
        if (!args.query) throw new Error("searchServer needs a query");
        const docs = await backend.deepSearch({
          query: args.query,
          accountId: args.accountId,
          limit: args.limit,
        });
        return { source: "server" as const, items: docs.map(fmt), nextCursor: null };
      }

      const hasFilters =
        args.folder !== undefined ||
        args.inbox !== undefined ||
        args.categoryId !== undefined ||
        args.from !== undefined ||
        args.to !== undefined ||
        args.subject !== undefined ||
        args.unread !== undefined ||
        args.starred !== undefined ||
        args.hasAttachments !== undefined ||
        after !== undefined ||
        before !== undefined;

      if (hasFilters) {
        const res = await backend.findMessages({
          accountId: args.accountId,
          view: args.inbox ?? args.folder,
          categoryId: args.categoryId,
          from: args.from,
          to: args.to,
          subject: args.subject,
          unread: args.unread,
          starred: args.starred,
          hasAttachments: args.hasAttachments,
          after,
          before,
          cursor: args.cursor ?? undefined,
          limit: args.limit,
        });
        const needle = args.query?.toLowerCase();
        const items = needle
          ? res.items.filter(
              (m) =>
                m.subject.toLowerCase().includes(needle) ||
                m.snippet.toLowerCase().includes(needle) ||
                m.from.email.toLowerCase().includes(needle) ||
                (m.from.name ?? "").toLowerCase().includes(needle),
            )
          : res.items;
        return { source: "filters" as const, items: items.map(fmt), nextCursor: res.nextCursor };
      }

      if (!args.query) {
        throw new Error("Pass a query or at least one filter");
      }
      const docs = await backend.searchIndex({
        query: args.query,
        accountId: args.accountId,
        role: args.folder,
        limit: args.limit,
      });
      return { source: "index" as const, items: docs.map(fmt), nextCursor: null };
    },
  );

  addTool(
    server,
    getBackend,
    "get_thread",
    {
      title: "Get thread",
      description:
        "Returns a thread summary plus its messages oldest first. Bodies are fetched for at most the 20 most recent messages (the rest are metadata only), sanitized HTML, and clipped at maxBodyChars.",
      inputSchema: z.object({
        threadId: z.string(),
        includeBodies: z
          .boolean()
          .default(true)
          .describe("Fetch bodies for the latest 20 messages"),
        format: zBodyFormat,
        maxBodyChars: zBodyOpts.maxBodyChars,
        includeQuoted: zBodyOpts.includeQuoted,
      }),
      outputSchema: z.object({
        thread: zThreadOut,
        messages: z.array(zMessageOut),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args, backend) => {
      const { thread, messages } = await backend.getThread(args.threadId);
      const sorted = [...messages].sort((a, b) => a.date - b.date);
      const withBody = args.includeBodies ? sorted.slice(-20) : [];
      const [acctMap, catMap] = await Promise.all([
        accountMap(backend),
        categoryMap(backend),
      ]);
      const contents = new Map<string, MessageContent>();
      await runLimited(withBody, 4, async (m) => {
        try {
          contents.set(m._id, await backend.getMessageContent(m._id));
        } catch {
          // A message that moved or vanished keeps metadata only.
        }
      });
      const opts = bodyOpts(args);
      return {
        thread: formatThread(thread, acctMap.get(thread.accountId), catMap),
        messages: sorted.map((m) =>
          formatMessage(m, catMap, contents.get(m._id), opts),
        ),
      };
    },
  );

  addTool(
    server,
    getBackend,
    "get_email",
    {
      title: "Get email",
      description:
        "Returns one message with full headers, flags, category and attachment metadata, plus the sanitized body when includeBody is true (clipped at maxBodyChars).",
      inputSchema: z.object({
        messageId: z.string(),
        ...zBodyOpts,
      }),
      outputSchema: zMessageOut,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args, backend) => {
      const [message, catMap] = await Promise.all([
        backend.getMessage(args.messageId),
        categoryMap(backend),
      ]);
      let content: MessageContent | undefined;
      if (args.includeBody) {
        content = await backend.getMessageContent(args.messageId);
      }
      return formatMessage(message, catMap, content, bodyOpts(args));
    },
  );

  addTool(
    server,
    getBackend,
    "get_attachment",
    {
      title: "Get attachment",
      description:
        "Downloads one attachment by id from a message's attachment list. Text, JSON, XML, CSV, and calendar files come back as decoded text; images as image content; everything else as a base64 resource. Refuses files over maxBytes.",
      inputSchema: z.object({
        messageId: z.string(),
        attachmentId: z.string(),
        maxBytes: z
          .number()
          .int()
          .min(1)
          .max(10 * 1024 * 1024)
          .default(10 * 1024 * 1024)
          .describe("Largest allowed size in bytes (default 10 MB)"),
      }),
      outputSchema: z.object({
        filename: z.string(),
        contentType: z.string(),
        size: z.number(),
        text: z.string().optional(),
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args, backend) => {
      const att = await backend.downloadAttachment(
        args.messageId,
        args.attachmentId,
      );
      if (att.size > args.maxBytes) {
        throw new Error(
          `Attachment is ${att.size} bytes, over the ${args.maxBytes} byte limit. Raise maxBytes to fetch it.`,
        );
      }
      const bytes = new Uint8Array(att.data);
      const textLike =
        /^text\//.test(att.contentType) ||
        /(json|xml|csv|calendar|javascript)/.test(att.contentType);
      const meta = {
        filename: att.filename,
        contentType: att.contentType,
        size: att.size,
      };
      if (textLike) {
        const text = new TextDecoder("utf-8").decode(bytes);
        return okResult({ ...meta, text });
      }
      const data = Buffer.from(bytes).toString("base64");
      if (/^image\//.test(att.contentType)) {
        return {
          content: [
            { type: "image" as const, data, mimeType: att.contentType },
            { type: "text" as const, text: JSON.stringify(meta) },
          ],
          structuredContent: meta,
        };
      }
      return {
        content: [
          {
            type: "resource" as const,
            resource: {
              uri: `kite://attachment/${args.messageId}/${args.attachmentId}`,
              mimeType: att.contentType,
              blob: data,
            },
          },
          { type: "text" as const, text: JSON.stringify(meta) },
        ],
        structuredContent: meta,
      };
    },
  );
}
