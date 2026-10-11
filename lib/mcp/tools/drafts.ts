// Draft tools: list/get/create/update/delete/send. Drafts sync to the
// mailbox Drafts folder about 30 seconds after each change.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import { formatDraft } from "../format";
import {
  addTool,
  toAddress,
  zAddress,
  zAddressOut,
  zCursor,
  zIdempotency,
  zLimit,
  zListOut,
  type BackendFor,
} from "./common";

const zDraftOut = z.object({
  id: z.string(),
  accountId: z.string(),
  mode: z.enum(["new", "reply", "replyAll", "forward"]),
  to: z.array(zAddressOut),
  cc: z.array(zAddressOut),
  bcc: z.array(zAddressOut),
  subject: z.string(),
  text: z.string(),
  html: z.string(),
  attachments: z.array(
    z.object({
      filename: z.string(),
      contentType: z.string(),
      size: z.number(),
    }),
  ),
  status: z.enum(["editing", "scheduled", "sending", "uncertain", "failed"]),
  scheduledAt: z.string().optional(),
  updatedAt: z.string(),
  replyToMessageId: z.string().optional(),
  threadId: z.string().optional(),
  sendError: z.string().optional(),
});

const zDraftFields = {
  to: z.array(zAddress).optional(),
  cc: z.array(zAddress).optional(),
  bcc: z.array(zAddress).optional(),
  subject: z.string().optional(),
  text: z.string().optional(),
  html: z.string().optional(),
};

export function registerDraftTools(server: McpServer, getBackend: BackendFor) {
  addTool(
    server,
    getBackend,
    "list_drafts",
    {
      title: "List drafts",
      description:
        "Lists open drafts newest-edited first. Paginate with nextCursor.",
      inputSchema: z.object({
        accountId: z
          .string()
          .optional()
          .describe("Filter to one account; drafts list covers all accounts by default"),
        limit: zLimit,
        cursor: zCursor,
      }),
      outputSchema: zListOut(zDraftOut),
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args, backend) => {
      const res = await backend.listDrafts({
        accountId: args.accountId,
        numItems: args.limit,
        cursor: args.cursor ?? null,
      });
      return { items: res.items.map(formatDraft), nextCursor: res.nextCursor };
    },
  );

  addTool(
    server,
    getBackend,
    "get_draft",
    {
      title: "Get draft",
      description: "Returns one draft with recipients, body, and attachments. Read only.",
      inputSchema: z.object({ draftId: z.string() }),
      outputSchema: zDraftOut,
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async (args, backend) => {
      const draft = await backend.getDraft(args.draftId);
      if (!draft) throw new Error("Draft not found");
      return formatDraft(draft) as Record<string, unknown>;
    },
  );

  addTool(
    server,
    getBackend,
    "create_draft",
    {
      title: "Create draft",
      description:
        "Creates a draft for one account and mirrors it to the server Drafts folder. Pass replyToMessageId plus mode reply/replyAll/forward to attach it to an existing conversation.",
      inputSchema: z.object({
        accountId: z.string(),
        ...zDraftFields,
        replyToMessageId: z.string().optional(),
        mode: z.enum(["new", "reply", "replyAll", "forward"]).optional(),
      }),
      outputSchema: z.object({ draftId: z.string() }),
      annotations: {},
    },
    async (args, backend) => ({
      draftId: await backend.createDraft({
        accountId: args.accountId,
        to: args.to?.map(toAddress),
        cc: args.cc?.map(toAddress),
        bcc: args.bcc?.map(toAddress),
        subject: args.subject,
        text: args.text,
        html: args.html,
        replyToMessageId: args.replyToMessageId,
        mode: args.mode,
      }),
    }),
  );

  addTool(
    server,
    getBackend,
    "update_draft",
    {
      title: "Update draft",
      description:
        "Replaces the given fields on a draft and schedules a fresh copy to the server Drafts folder, replacing the previous remote version.",
      inputSchema: z.object({
        draftId: z.string(),
        accountId: z.string().optional().describe("Change the sending mailbox"),
        ...zDraftFields,
      }),
      outputSchema: z.object({ ok: z.boolean() }),
      annotations: { idempotentHint: true },
    },
    async (args, backend) => {
      await backend.updateDraft({
        draftId: args.draftId,
        accountId: args.accountId,
        to: args.to?.map(toAddress),
        cc: args.cc?.map(toAddress),
        bcc: args.bcc?.map(toAddress),
        subject: args.subject,
        text: args.text,
        html: args.html,
      });
      return { ok: true };
    },
  );

  addTool(
    server,
    getBackend,
    "delete_draft",
    {
      title: "Delete draft",
      description:
        "Deletes a draft locally and removes its copy from the server Drafts folder. This cannot be undone.",
      inputSchema: z.object({ draftId: z.string() }),
      outputSchema: z.object({ ok: z.boolean() }),
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async (args, backend) => {
      await backend.discardDraft(args.draftId);
      return { ok: true };
    },
  );

  addTool(server, getBackend, "cancel_scheduled_send", {
    title: "Cancel scheduled send",
    description: "Cancels a scheduled draft send and keeps the draft available for editing. Does not delete the draft.",
    inputSchema: z.object({ draftId: z.string() }),
    outputSchema: z.object({ ok: z.boolean() }),
    annotations: { idempotentHint: true },
  }, async (args, backend) => {
    await backend.cancelScheduledDraft(args.draftId);
    return { ok: true };
  });

  addTool(
    server,
    getBackend,
    "send_draft",
    {
      title: "Send draft",
      description:
        "Sends a draft over SMTP right now, or schedules it for later when scheduledAt (ISO 8601) is given. Sending deletes the draft locally and from the server Drafts folder. Pass a unique idempotencyKey for retry safety.",
      inputSchema: z.object({
        draftId: z.string(),
        idempotencyKey: zIdempotency.idempotencyKey,
        allowDuplicate: zIdempotency.allowDuplicate,
        scheduledAt: z
          .string()
          .optional()
          .describe("ISO 8601 time to send at; schedules instead of sending now"),
      }),
      outputSchema: z.object({
        messageId: z.string().nullable(),
        threadId: z.string().nullable(),
        sentAt: z.string().nullable(),
        deduplicated: z.boolean(),
        scheduledAt: z.string().optional(),
        scheduled: z.boolean().optional(),
      }),
      annotations: { idempotentHint: false },
    },
    async (args, backend) => {
      if (args.scheduledAt) {
        const at = Date.parse(args.scheduledAt);
        if (Number.isNaN(at)) {
          throw new Error("scheduledAt must be an ISO 8601 date");
        }
        await backend.scheduleDraft(args.draftId, at);
        return {
          messageId: null,
          threadId: null,
          sentAt: null,
          deduplicated: false,
          scheduled: true,
          scheduledAt: new Date(at).toISOString(),
        };
      }
      const res = await backend.sendDraft({
        draftId: args.draftId,
        idempotencyKey: args.idempotencyKey,
        allowDuplicate: args.allowDuplicate,
      });
      let threadId: string | null = null;
      let sentAt: string | null = null;
      if (res.messageId) {
        try {
          const doc = await backend.getMessage(res.messageId);
          threadId = doc.threadId;
          sentAt = new Date(doc.date).toISOString();
        } catch {
          // Local copy not visible yet.
        }
      }
      return {
        messageId: res.messageId ?? null,
        threadId,
        sentAt,
        deduplicated: res.deduped,
      };
    },
  );
}
