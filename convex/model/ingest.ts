import { MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import type { Address } from "../lib/types";
import { recomputeThread } from "./threads";
import { resolveThread } from "./threading";

export interface IngestInput {
  userId: string;
  accountId: Id<"accounts">;
  folderId: Id<"folders"> | null;
  folderRole:
    | "inbox"
    | "sent"
    | "drafts"
    | "archive"
    | "trash"
    | "junk"
    | "local";
  uid?: number;
  messageIdHeader: string;
  inReplyTo?: string;
  references?: string[];
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  replyTo: Address[];
  date: number;
  snippet: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  isOutbound: boolean;
  hasAttachments: boolean;
  attachments?: {
    id: string;
    filename: string;
    contentType: string;
    size: number;
    cid?: string;
    inline: boolean;
  }[];
  size?: number;
  inbox?: "primary" | "other";
  categoryIds?: Id<"categories">[];
  classifiedBy?: "jev" | "heuristic" | "manual" | "inherited";
  needsClassification?: boolean;
  classifyAttempts?: number;
  bulk?: boolean;
  postDraftId?: string;
}

export function buildSearchText(input: {
  subject: string;
  from: Address;
  to: Address[];
  cc: Address[];
  snippet: string;
}): string {
  const parts = [
    input.subject,
    input.from.name ?? "",
    input.from.email,
    ...input.to.map((a) => a.email),
    ...input.cc.map((a) => a.email),
    input.snippet,
  ];
  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 2000);
}

function patchIfChanged(
  doc: Doc<"messages">,
  fields: Record<string, unknown>,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  const rec = doc as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (JSON.stringify(rec[k]) !== JSON.stringify(v)) patch[k] = v;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

export interface IngestResult {
  messageId: Id<"messages">;
  threadId: Id<"threads">;
  deduped: boolean;
}

// Inserts one message. Dedupes on (folderId, uid); a local-only placeholder
// (folderRole "local") with the same Message-ID is upgraded in place instead
// of duplicated. Recomputes the owning thread afterwards.
export async function ingestMessage(
  ctx: MutationCtx,
  input: IngestInput,
): Promise<IngestResult> {
  if (input.folderId && input.uid !== undefined) {
    const existing = await ctx.db
      .query("messages")
      .withIndex("by_folder_uid", (q) =>
        q.eq("folderId", input.folderId!).eq("uid", input.uid!),
      )
      .unique();
    if (existing) {
      const patch = patchIfChanged(existing, {
        seen: input.seen,
        flagged: input.flagged,
        answered: input.answered,
        snippet: input.snippet.slice(0, 240),
        size: input.size,
        hasAttachments: input.hasAttachments,
        attachments: input.attachments ?? [],
      });
      if (patch) await ctx.db.patch(existing._id, patch);
      if (patch && ("seen" in patch || "flagged" in patch)) {
        await recomputeThread(ctx, existing.threadId);
      }
      return { messageId: existing._id, threadId: existing.threadId, deduped: true };
    }
  }

  if (input.messageIdHeader) {
    const sameId = await ctx.db
      .query("messages")
      .withIndex("by_account_msgid", (q) =>
        q
          .eq("accountId", input.accountId)
          .eq("messageIdHeader", input.messageIdHeader),
      )
      .collect();
    const localPlaceholder = sameId.find((m) => m.folderRole === "local");
    if (localPlaceholder && input.folderRole !== "local") {
      const patch = patchIfChanged(localPlaceholder, {
        folderId: input.folderId,
        folderRole: input.folderRole,
        uid: input.uid,
        inReplyTo: input.inReplyTo,
        references: (input.references ?? []).slice(-30),
        to: input.to,
        cc: input.cc,
        bcc: input.bcc,
        replyTo: input.replyTo,
        seen: input.seen,
        flagged: input.flagged,
        answered: input.answered,
        size: input.size,
        hasAttachments: input.hasAttachments,
        attachments: input.attachments ?? [],
      });
      if (patch) await ctx.db.patch(localPlaceholder._id, patch);
      await recomputeThread(ctx, localPlaceholder.threadId);
      return {
        messageId: localPlaceholder._id,
        threadId: localPlaceholder.threadId,
        deduped: true,
      };
    }
    if (input.folderRole === "local") {
      const dup = sameId.find(
        (m) =>
          m.folderRole === "local" &&
          m.folderId === input.folderId,
      );
      if (dup) {
        return { messageId: dup._id, threadId: dup.threadId, deduped: true };
      }
    }
  }

  const threadId = await resolveThread(ctx, input.userId, input.accountId, {
    messageIdHeader: input.messageIdHeader,
    inReplyTo: input.inReplyTo,
    references: input.references,
  });

  let inbox = input.inbox;
  let classifiedBy = input.classifiedBy;
  const thread = await ctx.db.get(threadId);
  if (thread?.inboxManual && !input.isOutbound && input.inbox !== thread.inbox) {
    inbox = thread.inbox;
    classifiedBy = "inherited";
  }

  const messageId = await ctx.db.insert("messages", {
    userId: input.userId,
    accountId: input.accountId,
    threadId,
    folderId: input.folderId,
    folderRole: input.folderRole,
    uid: input.uid,
    messageIdHeader: input.messageIdHeader,
    inReplyTo: input.inReplyTo,
    references: (input.references ?? []).slice(-30),
    subject: input.subject,
    from: input.from,
    to: input.to,
    cc: input.cc,
    bcc: input.bcc,
    replyTo: input.replyTo,
    date: input.date,
    snippet: input.snippet.slice(0, 240),
    seen: input.seen,
    flagged: input.flagged,
    answered: input.answered,
    isOutbound: input.isOutbound,
    hasAttachments: input.hasAttachments,
    attachments: (input.attachments ?? []).slice(0, 25),
    size: input.size,
    inbox,
    categoryIds: input.categoryIds ?? [],
    classifiedBy,
    needsClassification: input.needsClassification ?? false,
    classifyAttempts: input.classifyAttempts ?? 0,
    bulk: input.bulk ?? false,
    postDraftId: input.postDraftId,
    searchText: buildSearchText(input),
  });

  await recomputeThread(ctx, threadId);
  return { messageId, threadId, deduped: false };
}
