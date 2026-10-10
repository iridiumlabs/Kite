import { isOwner } from "./addresses";
import { normalizeSubject } from "./subject";
import type {
  Address,
  InboxBucket,
  ListKey,
  ThreadLocation,
} from "./types";

export interface SummaryMessage {
  folderRole: string;
  date: number;
  seen: boolean;
  flagged: boolean;
  isOutbound: boolean;
  inbox?: InboxBucket;
  categoryIds: string[];
  subject: string;
  snippet: string;
  from: Address;
  hasAttachments: boolean;
}

export interface ThreadSummaryInput {
  inboxManual: boolean;
  inbox?: InboxBucket;
  snoozedUntil?: number;
}

export interface ThreadSummary {
  subject: string;
  participants: Address[];
  messageCount: number;
  unreadCount: number;
  unread: boolean;
  starred: boolean;
  hasAttachments: boolean;
  hasDraft: boolean;
  hasSent: boolean;
  snippet: string;
  lastMessageAt: number;
  location: ThreadLocation;
  inbox: InboxBucket;
  categoryIds: string[];
  listKey: ListKey;
}

const INBOX_LOCATION_ROLES = new Set(["inbox", "junk"]);

export function computeLocation(roles: Iterable<string>): ThreadLocation {
  let archive = false;
  let trash = false;
  for (const role of roles) {
    if (INBOX_LOCATION_ROLES.has(role)) return "inbox";
    if (role === "archive") archive = true;
    else if (role === "trash") trash = true;
  }
  if (archive) return "archive";
  if (trash) return "trash";
  return "none";
}

export function computeListKey(
  location: ThreadLocation,
  inbox: InboxBucket,
  snoozedUntil: number | undefined,
  now: number,
): ListKey {
  if (location !== "inbox") return location;
  if (snoozedUntil !== undefined && snoozedUntil > now) return "snoozed";
  return inbox;
}

export function summarizeThread(
  messages: SummaryMessage[],
  existing: ThreadSummaryInput,
  ownerEmails: string[],
  now: number,
): ThreadSummary {
  const sorted = [...messages].sort((a, b) => a.date - b.date);
  const nonDraft = sorted.filter((m) => m.folderRole !== "drafts");
  const inbound = sorted.filter((m) => !m.isOutbound);

  const location = computeLocation(sorted.map((m) => m.folderRole));

  const lastInboundInInbox = [...inbound]
    .reverse()
    .find((m) => INBOX_LOCATION_ROLES.has(m.folderRole) && m.inbox);
  const lastInboundWithInbox = [...inbound].reverse().find((m) => m.inbox);
  const inbox: InboxBucket =
    lastInboundInInbox?.inbox ??
    lastInboundWithInbox?.inbox ??
    existing.inbox ??
    "primary";

  const categoryIds: string[] = [];
  for (const m of sorted) {
    if (m.isOutbound) continue;
    for (const id of m.categoryIds) {
      if (!categoryIds.includes(id)) categoryIds.push(id);
    }
  }

  const unreadCount =
    location === "trash"
      ? 0
      : inbound.filter((m) => !m.seen && m.folderRole !== "trash").length;

  const latest = nonDraft[nonDraft.length - 1] ?? sorted[sorted.length - 1];
  const lastMessageAt = latest?.date ?? 0;

  const participants: Address[] = [];
  const seenEmails = new Set<string>();
  const owner: Address[] = [];
  for (const m of [...sorted].reverse()) {
    const email = m.from.email.toLowerCase();
    if (seenEmails.has(email)) continue;
    seenEmails.add(email);
    if (isOwner(email, ownerEmails)) owner.push(m.from);
    else participants.push(m.from);
  }
  const allParticipants = [...participants, ...owner].slice(0, 4);

  return {
    subject: normalizeSubject(latest?.subject ?? ""),
    participants: allParticipants,
    messageCount: messages.length,
    unreadCount,
    unread: unreadCount > 0,
    starred: sorted.some((m) => m.flagged),
    hasAttachments: sorted.some((m) => m.hasAttachments),
    hasDraft: sorted.some((m) => m.folderRole === "drafts"),
    hasSent: sorted.some((m) => m.folderRole === "sent"),
    snippet: (latest?.snippet ?? "").slice(0, 200),
    lastMessageAt,
    location,
    inbox,
    categoryIds,
    listKey: computeListKey(location, inbox, existing.snoozedUntil, now),
  };
}
