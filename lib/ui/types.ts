export type ViewKind =
  | "primary"
  | "other"
  | "sent"
  | "drafts"
  | "archive"
  | "trash"
  | "snoozed"
  | "starred"
  | "category"
  | "account";

export interface AddressInfo {
  name?: string;
  email: string;
}

export interface CategoryInfo {
  id: string;
  name: string;
  color: string;
  description?: string;
  unread?: number;
}

export interface AccountInfo {
  id: string;
  email: string;
  displayName?: string;
  status: string;
  lastError?: string;
  unread?: number;
  syncing?: boolean;
}

export interface ThreadItem {
  id: string;
  location?: "inbox" | "archive" | "trash" | "none";
  subject: string;
  participants: AddressInfo[];
  snippet: string;
  lastMessageAt: number;
  messageCount: number;
  unread: boolean;
  unreadCount?: number;
  starred?: boolean;
  hasAttachments?: boolean;
  categories?: CategoryInfo[];
  accountEmail?: string;
}

export interface AttachmentInfo {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  inline?: boolean;
}

export interface MessageItem {
  id: string;
  threadId: string;
  from: AddressInfo;
  to: AddressInfo[];
  cc?: AddressInfo[];
  subject: string;
  date: number;
  snippet: string;
  unread: boolean;
  own?: boolean;
}

export interface MessageContent {
  text?: string;
  html?: string;
  quotedText?: string;
  quotedHtml?: string;
  remoteImagesBlocked?: number;
  loadRemoteImages?: boolean;
  attachments?: AttachmentInfo[];
  /** Set when the fetch failed; MessageBody renders an inline error + Retry */
  error?: string;
}

export interface UserInfo {
  name: string;
  initial: string;
  imageUrl?: string;
  accountsConnected: number;
}

export const VIEW_LABELS: Record<string, string> = {
  primary: "Primary",
  other: "Other",
  sent: "Sent",
  drafts: "Drafts",
  archive: "Archive",
  trash: "Trash",
  snoozed: "Snoozed",
  starred: "Starred",
};

export const CATEGORY_COLORS = [
  "#FF3B30",
  "#FF9F0A",
  "#FFCC00",
  "#34C759",
  "#00C7BE",
  "#007AFF",
  "#5856D6",
  "#AF52DE",
  "#FF2D55",
  "#8E8E93",
];
