// Response shaping for the Post MCP server: Convex docs -> stable wire
// shapes. Everything here is pure and dependency-free so it can be unit
// tested under any runtime.

export interface AddressIn {
  name?: string;
  email: string;
}

export interface AccountDoc {
  _id: string;
  email: string;
  displayName: string;
  status: string;
  lastError?: string;
  lastSyncedAt?: number;
  initialSyncDone: boolean;
}

export interface ThreadCategoryLite {
  _id: string;
  name: string;
  color?: string;
}

export interface ThreadDoc {
  _id: string;
  accountId: string;
  subject: string;
  participants: AddressIn[];
  messageCount: number;
  unreadCount: number;
  unread: boolean;
  starred: boolean;
  hasAttachments: boolean;
  snippet: string;
  lastMessageAt: number;
  location: "inbox" | "archive" | "trash" | "none";
  inbox: "primary" | "other";
  snoozedUntil?: number;
  categoryIds: string[];
  // Present when the query already resolved categories (listThreads).
  categories?: ThreadCategoryLite[];
}

export interface AttachmentMeta {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  cid?: string;
  inline?: boolean;
}

export interface MessageDoc {
  _id: string;
  threadId: string;
  accountId: string;
  folderRole:
    | "inbox"
    | "junk"
    | "sent"
    | "drafts"
    | "archive"
    | "trash"
    | "local";
  subject: string;
  from: AddressIn;
  to: AddressIn[];
  cc: AddressIn[];
  bcc: AddressIn[];
  replyTo: AddressIn[];
  date: number;
  snippet: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  isOutbound: boolean;
  hasAttachments: boolean;
  attachments: AttachmentMeta[];
  inbox?: "primary" | "other";
  categoryIds: string[];
}

export interface MessageContent {
  html?: string;
  text?: string;
  quotedHtml?: string;
  quotedText?: string;
  attachments: {
    attachmentId?: string;
    id?: string;
    filename?: string;
    contentType?: string;
    size?: number;
  }[];
  headers?: Record<string, unknown>;
  remoteImagesBlocked?: number;
}

export interface DraftDoc {
  _id: string;
  accountId: string;
  threadId?: string;
  replyToMessageId?: string;
  mode: "new" | "reply" | "replyAll" | "forward";
  to: AddressIn[];
  cc: AddressIn[];
  bcc: AddressIn[];
  subject: string;
  html: string;
  text: string;
  attachments: { filename: string; contentType: string; size: number }[];
  scheduledAt?: number;
  status: "editing" | "scheduled" | "sending" | "failed";
  sendError?: string;
  updatedAt: number;
}

export interface CategoryDoc {
  _id: string;
  name: string;
  description: string;
  color: string;
}

export function iso(ms: number | undefined): string | undefined {
  return ms === undefined ? undefined : new Date(ms).toISOString();
}

export function formatAccount(a: AccountDoc) {
  return {
    id: a._id,
    email: a.email,
    displayName: a.displayName,
    status: a.status,
    lastError: a.lastError,
    lastSyncedAt: iso(a.lastSyncedAt),
    initialSyncDone: a.initialSyncDone,
  };
}

export function formatThread(
  t: ThreadDoc,
  accountEmail: string | undefined,
  categoryNames: Map<string, { id: string; name: string }>,
) {
  return {
    id: t._id,
    accountId: t.accountId,
    accountEmail,
    subject: t.subject,
    participants: t.participants.map((p) => ({ name: p.name, email: p.email })),
    snippet: t.snippet,
    lastMessageAt: new Date(t.lastMessageAt).toISOString(),
    messageCount: t.messageCount,
    unread: t.unread,
    unreadCount: t.unreadCount,
    starred: t.starred,
    hasAttachments: t.hasAttachments,
    location: t.location,
    inbox: t.inbox,
    snoozedUntil: iso(t.snoozedUntil),
    categories: (t.categories
      ? t.categories.map((c) => ({ id: c._id, name: c.name }))
      : t.categoryIds
          .map((id) => categoryNames.get(id))
          .filter((c): c is { id: string; name: string } => !!c)
    ),
  };
}

export interface BodyFormatOpts {
  format: "text" | "html" | "both";
  maxBodyChars: number;
  includeQuoted: boolean;
}

export function clipped(s: string | undefined, max: number) {
  if (s === undefined) return { value: undefined, truncated: false };
  if (s.length <= max) return { value: s, truncated: false };
  return { value: s.slice(0, max), truncated: true };
}

export function formatMessage(
  m: MessageDoc,
  categoryNames: Map<string, { id: string; name: string }>,
  content?: MessageContent,
  body?: BodyFormatOpts,
) {
  const out: Record<string, unknown> = {
    id: m._id,
    threadId: m.threadId,
    accountId: m.accountId,
    folder: m.folderRole,
    from: m.from,
    to: m.to,
    cc: m.cc,
    bcc: m.bcc,
    replyTo: m.replyTo,
    subject: m.subject,
    date: new Date(m.date).toISOString(),
    snippet: m.snippet,
    unread: !m.seen,
    starred: m.flagged,
    answered: m.answered,
    inbox: m.inbox,
    categories: m.categoryIds
      .map((id) => categoryNames.get(id))
      .filter((c): c is { id: string; name: string } => !!c),
    attachments: m.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
    })),
  };
  if (content && body) {
    let truncated = false;
    const bodyOut: Record<string, unknown> = {};
    if (body.format === "text" || body.format === "both") {
      const t = clipped(content.text, body.maxBodyChars);
      if (t.value !== undefined) bodyOut.text = t.value;
      truncated ||= t.truncated;
      if (body.includeQuoted) {
        const qt = clipped(content.quotedText, body.maxBodyChars);
        if (qt.value !== undefined) bodyOut.quotedText = qt.value;
        truncated ||= qt.truncated;
      }
    }
    if (body.format === "html" || body.format === "both") {
      const h = clipped(content.html, body.maxBodyChars);
      if (h.value !== undefined) bodyOut.html = h.value;
      truncated ||= h.truncated;
      if (body.includeQuoted) {
        const qh = clipped(content.quotedHtml, body.maxBodyChars);
        if (qh.value !== undefined) bodyOut.quotedHtml = qh.value;
        truncated ||= qh.truncated;
      }
    }
    bodyOut.truncated = truncated;
    out.body = bodyOut;
    if (content.attachments.length > 0) {
      out.attachments = content.attachments.map((a, i) => ({
        id: a.attachmentId ?? a.id ?? String(i),
        filename: a.filename ?? "attachment",
        contentType: a.contentType ?? "application/octet-stream",
        size: a.size ?? 0,
      }));
    }
  }
  return out;
}

export function formatDraft(d: DraftDoc) {
  return {
    id: d._id,
    accountId: d.accountId,
    mode: d.mode,
    to: d.to,
    cc: d.cc,
    bcc: d.bcc,
    subject: d.subject,
    text: d.text,
    html: d.html,
    attachments: d.attachments.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      size: a.size,
    })),
    status: d.status,
    scheduledAt: iso(d.scheduledAt),
    updatedAt: new Date(d.updatedAt).toISOString(),
    replyToMessageId: d.replyToMessageId,
    threadId: d.threadId,
    sendError: d.sendError,
  };
}

export function formatCategory(c: CategoryDoc) {
  return {
    id: c._id,
    name: c.name,
    description: c.description,
    color: c.color,
  };
}

// Convex action/query errors arrive as a generic Error whose message embeds
// the server's own "Uncaught Error: ..." line. Surface that one line.
export function friendlyMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/Uncaught (?:Convex )?Error: ([^\n]+)/);
  if (m) return m[1].trim();
  const first = msg.split("\n").find((l) => l.trim().length > 0) ?? msg;
  return first.trim();
}
