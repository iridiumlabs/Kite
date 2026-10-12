// Sending tools: new mail, replies, forwards. All send for real over SMTP.
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";
import type { KiteBackend, SendResult } from "../backend";
import {
  addTool,
  toAddress,
  zAddress,
  zIdempotency,
  zSendAttachment,
  zSendResult,
  type BackendFor,
} from "./common";

async function sendOutcome(
  backend: KiteBackend,
  res: SendResult,
): Promise<{
  messageId: string | null;
  threadId: string | null;
  sentAt: string | null;
  deduplicated: boolean;
  rejectedRecipients?: string[];
}> {
  let threadId: string | null = null;
  let sentAt: string | null = null;
  if (res.messageId) {
    try {
      const doc = await backend.getMessage(res.messageId);
      threadId = doc.threadId;
      sentAt = new Date(doc.date).toISOString();
    } catch {
      // Local copy not visible yet; still report the send succeeded.
    }
  }
  return {
    messageId: res.messageId ?? null,
    threadId,
    sentAt,
    deduplicated: res.deduped,
    ...(res.rejectedRecipients?.length ? { rejectedRecipients: res.rejectedRecipients } : {}),
  };
}

const zTextOrHtml = {
  text: z.string().optional().describe("Plain text body"),
  html: z.string().optional().describe("HTML body; text is derived from it when text is omitted"),
};

export function registerSendingTools(server: McpServer, getBackend: BackendFor) {
  addTool(
    server,
    getBackend,
    "send_email",
    {
      title: "Send email",
      description:
        "Sends a real email over SMTP right now from the account given by accountId or fromEmail. Pass a unique idempotencyKey so a retried call can never send twice. Attachments: inline base64 or references to attachments on existing messages; 25 MB total.",
      inputSchema: z.object({
        accountId: z
          .string()
          .optional()
          .describe("Account id from list_accounts; either this or fromEmail is required"),
        fromEmail: z
          .string()
          .optional()
          .describe("Connected mailbox address; either this or accountId is required"),
        to: z.array(zAddress).min(1),
        cc: z.array(zAddress).optional(),
        bcc: z.array(zAddress).optional(),
        subject: z.string(),
        ...zTextOrHtml,
        attachments: z.array(zSendAttachment).optional(),
        ...zIdempotency,
      }),
      outputSchema: zSendResult,
      annotations: { idempotentHint: false },
    },
    async (args, backend) => {
      let accountId = args.accountId;
      if (!accountId) {
        if (!args.fromEmail) {
          throw new Error("Pass accountId or fromEmail");
        }
        const accounts = await backend.listAccounts();
        const match = accounts.find(
          (a) => a.email.toLowerCase() === args.fromEmail!.toLowerCase(),
        );
        if (!match) {
          throw new Error(`No connected mailbox with address ${args.fromEmail}`);
        }
        accountId = match._id;
      }
      const res = await backend.sendMessage({
        accountId,
        to: args.to.map(toAddress),
        cc: args.cc?.map(toAddress),
        bcc: args.bcc?.map(toAddress),
        subject: args.subject,
        text: args.text,
        html: args.html,
        attachments: args.attachments as never,
        idempotencyKey: args.idempotencyKey,
        allowDuplicate: args.allowDuplicate,
      });
      return sendOutcome(backend, res);
    },
  );

  addTool(
    server,
    getBackend,
    "reply_to_email",
    {
      title: "Reply to email",
      description:
        "Replies to a message, threading it into the same conversation and marking the original answered on the server. replyAll also cc's the other recipients, excluding your own addresses. The quoted original is appended unless includeQuote is false. Pass a unique idempotencyKey for retry safety.",
      inputSchema: z.object({
        messageId: z.string(),
        replyAll: z.boolean().default(false),
        ...zTextOrHtml,
        includeQuote: z.boolean().default(true),
        attachments: z.array(zSendAttachment).optional(),
        ...zIdempotency,
      }),
      outputSchema: zSendResult,
      annotations: { idempotentHint: false },
    },
    async (args, backend) => {
      const res = await backend.reply({
        messageId: args.messageId,
        replyAll: args.replyAll,
        text: args.text,
        html: args.html,
        includeQuote: args.includeQuote,
        attachments: args.attachments as never,
        idempotencyKey: args.idempotencyKey,
        allowDuplicate: args.allowDuplicate,
      });
      return sendOutcome(backend, res);
    },
  );

  addTool(
    server,
    getBackend,
    "forward_email",
    {
      title: "Forward email",
      description:
        "Forwards a message to new recipients with its body and, unless includeAttachments is false, its attachments. Pass a unique idempotencyKey for retry safety.",
      inputSchema: z.object({
        messageId: z.string(),
        to: z.array(zAddress).min(1),
        cc: z.array(zAddress).optional(),
        bcc: z.array(zAddress).optional(),
        ...zTextOrHtml,
        includeAttachments: z.boolean().default(true),
        attachments: z.array(zSendAttachment).optional(),
        ...zIdempotency,
      }),
      outputSchema: zSendResult,
      annotations: { idempotentHint: false },
    },
    async (args, backend) => {
      const res = await backend.forward({
        messageId: args.messageId,
        to: args.to.map(toAddress),
        cc: args.cc?.map(toAddress),
        bcc: args.bcc?.map(toAddress),
        text: args.text,
        html: args.html,
        includeAttachments: args.includeAttachments,
        attachments: args.attachments as never,
        idempotencyKey: args.idempotencyKey,
        allowDuplicate: args.allowDuplicate,
      });
      return sendOutcome(backend, res);
    },
  );
}
