import { expect, test, vi } from "vitest";
import { isValidElement } from "react";
import { isThreadListView } from "../../lib/ui/threadViews";
import { ThreadRowWide } from "../../components/mail/ThreadRows";
import type { ThreadItem, ViewKind } from "../../lib/ui/types";

function buttons(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(buttons);
  if (!isValidElement<{ children?: unknown; "aria-label"?: string }>(node)) return [];
  return node.type === "button" ? [node.props["aria-label"] ?? ""] : buttons(node.props.children);
}

test.each(["sent", "drafts", "primary", "archive"] as ViewKind[])("%s rows expose actions only for valid thread targets", view => {
  const thread: ThreadItem = { id: "row", subject: "Subject", participants: [], snippet: "", lastMessageAt: 0, unread: false, messageCount: 1 };
  const actions = { onArchive: vi.fn(), onTrash: vi.fn(), onSnooze: vi.fn(), onToggleRead: vi.fn() };
  const row = ThreadRowWide({ thread, onOpen: vi.fn(), actions: isThreadListView(view) ? actions : undefined });
  const labels = buttons(row);
  if (view === "sent" || view === "drafts") expect(labels).toEqual([]);
  else expect(labels).toContain("Archive");
});
