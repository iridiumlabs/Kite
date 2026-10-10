export type Address = { name?: string; email: string };

export type FolderRole =
  | "inbox"
  | "sent"
  | "drafts"
  | "archive"
  | "trash"
  | "junk";

export type MessageFolderRole = FolderRole | "local";

export type InboxBucket = "primary" | "other";

export type ThreadLocation = "inbox" | "archive" | "trash" | "none";

export type ListKey =
  | "primary"
  | "other"
  | "archive"
  | "trash"
  | "snoozed"
  | "none";

export const FLAG_SEEN = 1;
export const FLAG_FLAGGED = 2;
export const FLAG_ANSWERED = 4;
