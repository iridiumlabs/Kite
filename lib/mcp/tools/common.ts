// Shared registration helper, zod primitives, and small utilities used by
// every Post MCP tool. Tool handlers never touch HTTP or Convex directly;
// they call the PostBackend resolved per request.
import { z } from "zod";
import type { McpServer, ServerContext } from "@modelcontextprotocol/server";
import type { PostBackend } from "../backend";
import { friendlyMessage, type AddressIn } from "../format";

export type BackendFor = (ctx: ServerContext) => PostBackend;

export function okResult(data: Record<string, unknown>) {
  const text = JSON.stringify(data);
  return {
    content: [{ type: "text" as const, text }],
    structuredContent: data,
  };
}

export function errorResult(err: unknown) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: friendlyMessage(err) }],
  };
}

interface ToolSpec<I> {
  title: string;
  description: string;
  inputSchema?: z.ZodType<I>;
  outputSchema?: z.ZodTypeAny;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

// Registers a tool whose handler resolves the backend per call, maps the
// handler result to structuredContent + a compact JSON text item, and turns
// thrown errors into isError results with a one-line actionable message.
// The declared outputSchema is the wire contract; the handler return type
// is deliberately loose since format.ts already produces the shape.
export function addTool<I>(
  server: McpServer,
  getBackend: BackendFor,
  name: string,
  spec: ToolSpec<I>,
  handler: (args: I, backend: PostBackend) => Promise<unknown>,
) {
  server.registerTool(
    name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.inputSchema,
      outputSchema: spec.outputSchema,
      annotations: spec.annotations,
    } as never,
    // The SDK gives the callback a different arity depending on whether an
    // inputSchema was declared: (args, ctx) with a schema, (ctx) without.
    (spec.inputSchema
      ? async (args: unknown, ctx: ServerContext) =>
          runTool(args as I, ctx)
      : async (ctx: ServerContext) => runTool(undefined as I, ctx)) as never,
  );

  async function runTool(args: I, ctx: ServerContext) {
    try {
      const out = await handler(args, getBackend(ctx));
      // Handlers that build non-text content (attachments) return a full
      // result; everything else becomes structuredContent + text JSON.
      if (out && typeof out === "object" && "content" in out) {
        return out;
      }
      return okResult(out as Record<string, unknown>);
    } catch (err) {
      return errorResult(err);
    }
  }
}

// ---------- shared input primitives ----------

const ADDRESS_RE = /^(?:([^<>"\n]*?)\s*)?<?([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>?$/;

export function toAddress(v: string | { name?: string; email: string }): AddressIn {
  if (typeof v === "object") return { name: v.name, email: v.email };
  const m = ADDRESS_RE.exec(v.trim());
  if (!m) {
    throw new Error(
      `Invalid recipient "${v}". Use "name@domain" or "Name <name@domain>".`,
    );
  }
  return { name: m[1]?.trim() || undefined, email: m[2] };
}

export const zAddress = z
  .union([
    z
      .string()
      .describe('Either "name@domain" or "Name <name@domain>"'),
    z.object({ name: z.string().optional(), email: z.string() }),
  ])
  .describe("Recipient address");

export const zIdList = (what: string) =>
  z
    .array(z.string().min(1))
    .max(100)
    .describe(`${what}; at most 100 ids per call`);

export const zTargets = z
  .object({
    threadIds: zIdList("Thread ids").optional(),
    messageIds: zIdList("Message ids").optional(),
  })
  .refine(
    (v) =>
      (v.threadIds?.length ?? 0) + (v.messageIds?.length ?? 0) > 0 &&
      (v.threadIds?.length ?? 0) + (v.messageIds?.length ?? 0) <= 100,
    { message: "Pass 1 to 100 total ids across threadIds and messageIds" },
  );

export const zLimit = z
  .number()
  .int()
  .min(1)
  .max(100)
  .default(25)
  .describe("Maximum items to return (1-100, default 25)");

export const zCursor = z
  .string()
  .nullish()
  .describe("Pagination cursor from a previous list call");

export const zIdempotency = {
  idempotencyKey: z
    .string()
    .optional()
    .describe(
      "Unique key per intended send. Retries with the same key never send twice. Strongly recommended.",
    ),
  allowDuplicate: z
    .boolean()
    .optional()
    .describe("Send even when identical content was sent in the last 10 minutes"),
};

export const zSendAttachment = z.union([
  z.object({
    filename: z.string(),
    contentType: z.string(),
    contentBase64: z
      .string()
      .describe("Base64 encoded content; attachments total at most 25 MB"),
  }),
  z.object({
    messageId: z.string(),
    attachmentId: z
      .string()
      .describe("Attachment id from a message attachment list"),
  }),
]);

// ---------- shared output helpers ----------

export const zAddressOut = z.object({
  name: z.string().optional(),
  email: z.string(),
});

export const zAttachmentOut = z.object({
  id: z.string(),
  filename: z.string(),
  contentType: z.string(),
  size: z.number(),
});

export const zCategoryOut = z.object({
  id: z.string(),
  name: z.string(),
});

export const zMessageOut = z.object({
  id: z.string(),
  threadId: z.string(),
  accountId: z.string(),
  folder: z.enum(["inbox", "junk", "sent", "drafts", "archive", "trash", "local"]),
  from: zAddressOut,
  to: z.array(zAddressOut),
  cc: z.array(zAddressOut),
  bcc: z.array(zAddressOut),
  replyTo: z.array(zAddressOut),
  subject: z.string(),
  date: z.string(),
  snippet: z.string(),
  unread: z.boolean(),
  starred: z.boolean(),
  answered: z.boolean(),
  inbox: z.enum(["primary", "other"]).optional(),
  categories: z.array(zCategoryOut),
  attachments: z.array(zAttachmentOut),
  body: z
    .object({
      text: z.string().optional(),
      html: z.string().optional(),
      quotedText: z.string().optional(),
      quotedHtml: z.string().optional(),
      truncated: z.boolean(),
    })
    .optional(),
});

export const zThreadOut = z.object({
  id: z.string(),
  accountId: z.string(),
  accountEmail: z.string().optional(),
  subject: z.string(),
  participants: z.array(zAddressOut),
  snippet: z.string(),
  lastMessageAt: z.string(),
  messageCount: z.number(),
  unread: z.boolean(),
  unreadCount: z.number(),
  starred: z.boolean(),
  hasAttachments: z.boolean(),
  location: z.enum(["inbox", "archive", "trash", "none"]),
  inbox: z.enum(["primary", "other"]),
  snoozedUntil: z.string().optional(),
  categories: z.array(zCategoryOut),
});

export const zListOut = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });

export const zSendResult = z.object({
  rejectedRecipients: z.array(z.string()).optional().describe("Partial delivery: these recipients were rejected. Do not retry recipients who already received the message."),
  messageId: z.string().nullable(),
  threadId: z.string().nullable(),
  sentAt: z.string().nullable(),
  deduplicated: z
    .boolean()
    .describe("True when an earlier send with the same idempotency key was returned instead of sending again"),
});

export const zUpdated = z.object({
  updated: z.number(),
  threadIds: z.array(z.string()),
});

// Maps message ids to their thread ids so bulk responses can report the
// threads actually touched.
export async function resolveThreadIds(
  backend: PostBackend,
  threadIds: string[] | undefined,
  messageIds: string[] | undefined,
): Promise<string[]> {
  const out = new Set<string>(threadIds ?? []);
  for (const id of messageIds ?? []) {
    const m = await backend.getMessage(id);
    out.add(m.threadId);
  }
  return [...out];
}
