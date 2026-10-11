import { expect, test, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { Reader, type ReaderProps } from "../../components/mail/Reader";
import { expandedMessageIds, toggleMessageExpansion } from "../../lib/ui/messageExpansion";

function find(node: unknown, predicate: (el: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>> | undefined {
  if (Array.isArray(node)) return node.map(child => find(child, predicate)).find(Boolean);
  if (!isValidElement(node)) return undefined;
  const el = node as ReactElement<Record<string, unknown>>;
  return predicate(el) ? el : find(el.props.children, predicate);
}

test.each(["latest", "unread", "older"])("message %s can expand, collapse, and reopen through real Reader controls", id => {
  const defaults = new Set(["latest", "unread"]);
  let collapsed = new Set<string>(); let extra = new Set<string>();
  const props: ReaderProps = {
    subject: "Conversation", messageCount: 3,
    messages: ["older", "unread", "latest"].map(id => ({
      id, threadId: "thread", subject: "Conversation", from: { name: id, email: `${id}@x.com` },
      to: [], date: 0, snippet: "Snippet", unread: id === "unread",
    })),
    contentFor: () => ({ text: "Body" }), expandedIds: new Set(),
    onToggleMessage: messageId => {
      const next = toggleMessageExpansion(messageId, expandedMessageIds(defaults, collapsed, extra), collapsed, extra);
      collapsed = next.collapsed; extra = next.extra;
    },
    onArchive: vi.fn(), onTrash: vi.fn(), onTag: null, onSnooze: null,
    onMarkUnread: vi.fn(), onStar: vi.fn(), onMore: null,
    onReply: vi.fn(), onReplyAll: vi.fn(), onForward: vi.fn(), onDownloadAttachment: vi.fn(),
  };
  function control(label: string) {
    props.expandedIds = expandedMessageIds(defaults, collapsed, extra);
    const tree = Reader(props);
    const row = find(tree, el => (el.props.message as { id?: string } | undefined)?.id === id)!;
    const render = row.type as (props: Record<string, unknown>) => ReactElement;
    return find(render(row.props), el => el.type === "button" && el.props["aria-label"] === label)!;
  }
  const click = (button: ReactElement<Record<string, unknown>>) => (button.props.onClick as () => void)();
  if (id === "older") {
    const expand = control(`Expand message from ${id}`);
    expect(expand.props["aria-expanded"]).toBe(false);
    click(expand);
  }
  const collapse = control(`Collapse message from ${id}`);
  expect(collapse.props["aria-expanded"]).toBe(true);
  click(collapse);
  expect(expandedMessageIds(defaults, collapsed, extra).has(id)).toBe(false);
  click(control(`Expand message from ${id}`));
  expect(expandedMessageIds(defaults, collapsed, extra).has(id)).toBe(true);
  expect(props.onReply).not.toHaveBeenCalled();
});

test("an explicit collapse wins even when a message later becomes unread", () => {
  expect(expandedMessageIds(new Set(["older"]), new Set(["older"]), new Set(["older"])).has("older")).toBe(false);
});
