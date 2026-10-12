import type { ViewKind } from "./types";

const THREAD_VIEWS: ReadonlySet<ViewKind> = new Set([
  "primary", "other", "archive", "trash", "snoozed", "starred", "account", "category",
]);

// Sent represents outbound copies and Drafts represents draft IDs, not
// the inbound thread targets used by archive/trash/read/snooze mutations.
export function isThreadListView(view: ViewKind): boolean {
  return THREAD_VIEWS.has(view);
}
