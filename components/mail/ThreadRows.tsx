"use client";

import clsx from "clsx";
import {
  Archive,
  Trash,
  Clock,
  MailOpen,
  Mail,
  PaperclipIcon,
} from "@/components/icons";
import type { ThreadItem } from "@/lib/ui/types";
import { senderDisplay } from "@/lib/ui/avatars";
import { formatListDate } from "@/lib/ui/dates";

export interface RowActionHandlers {
  onArchive: (t: ThreadItem) => void;
  onTrash: (t: ThreadItem) => void;
  onSnooze: (t: ThreadItem) => void;
  onToggleRead: (t: ThreadItem) => void;
}

function CategoryTag({ name, color }: { name: string; color: string }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div
        className="rounded-[3px] shrink-0 size-1.5"
        style={{ background: color }}
      />
      <div className="text-secondary text-xs/4">{name}</div>
    </div>
  );
}

/** Wide 44px row used in the two-column (no selection) layout */
export function ThreadRowWide({
  thread,
  selected,
  focused,
  onOpen,
  actions,
}: {
  thread: ThreadItem;
  selected?: boolean;
  focused?: boolean;
  onOpen: (t: ThreadItem) => void;
  actions?: RowActionHandlers;
}) {
  const sender = thread.participants.map(senderDisplay).join(", ");
  const cat = thread.categories?.[0];
  return (
    <div
      role="option"
      aria-selected={!!selected}
      tabIndex={-1}
      data-focused={focused || undefined}
      onClick={() => onOpen(thread)}
      className={clsx(
        "mail-row flex items-center h-11 pr-3.5 pl-2.5 rounded-lg gap-3 shrink-0 cursor-default outline-none",
        selected && "bg-list-selected",
        focused && "ring-2 ring-accent ring-inset",
      )}
    >
      <div className="flex justify-center w-2.5 shrink-0">
        {thread.unread && (
          <div className="rounded-sm shrink-0 bg-accent size-2" />
        )}
      </div>
      <div className="flex items-center w-45 shrink-0 gap-1.5 min-w-0">
        <div
          className={clsx(
            "w-max max-w-full line-clamp-1 text-[13px]/4 text-primary",
            thread.unread ? "font-semibold" : "font-medium",
          )}
        >
          {sender}
        </div>
        {thread.messageCount > 1 && (
          <div className="tnum text-tertiary text-xs/4 shrink-0">
            {thread.messageCount}
          </div>
        )}
      </div>
      <div className="flex items-center grow basis-0 min-w-0 gap-2">
        <div
          className={clsx(
            "shrink-0 w-max max-w-[60%] line-clamp-1 text-[13px]/4",
            thread.unread
              ? "font-medium text-primary"
              : "text-icon-strong",
          )}
        >
          {thread.subject}
        </div>
        <div className="grow basis-0 min-w-0 text-tertiary text-[13px]/4 line-clamp-1">
          {thread.snippet}
        </div>
      </div>
      <div className="flex items-center justify-end w-42.5 shrink-0 gap-2.5">
        <div className="row-meta flex items-center justify-end gap-2.5">
          {cat && <CategoryTag name={cat.name} color={cat.color} />}
          {thread.hasAttachments && (
            <PaperclipIcon className="text-tertiary" />
          )}
          <div className="tnum w-16 text-right shrink-0 text-tertiary text-xs/4">
            {formatListDate(thread.lastMessageAt)}
          </div>
        </div>
        {actions && (
          <div className="row-actions justify-end">
            <button
              aria-label="Archive"
              className="icon-btn size-7"
              onClick={(e) => {
                e.stopPropagation();
                actions.onArchive(thread);
              }}
            >
              <Archive size={15} strokeWidth={1.8} />
            </button>
            <button
              aria-label="Trash"
              className="icon-btn size-7"
              onClick={(e) => {
                e.stopPropagation();
                actions.onTrash(thread);
              }}
            >
              <Trash size={15} strokeWidth={1.8} />
            </button>
            <button
              aria-label="Snooze"
              className="icon-btn size-7"
              onClick={(e) => {
                e.stopPropagation();
                actions.onSnooze(thread);
              }}
            >
              <Clock size={15} strokeWidth={1.8} />
            </button>
            <button
              aria-label={thread.unread ? "Mark as read" : "Mark as unread"}
              className="icon-btn size-7"
              onClick={(e) => {
                e.stopPropagation();
                actions.onToggleRead(thread);
              }}
            >
              {thread.unread ? <MailOpen /> : <Mail size={15} />}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** Compact 3-line row used in the three-column middle pane */
export function ThreadRowCompact({
  thread,
  selected,
  focused,
  onOpen,
}: {
  thread: ThreadItem;
  selected?: boolean;
  focused?: boolean;
  onOpen: (t: ThreadItem) => void;
}) {
  const sender = thread.participants.map(senderDisplay).join(", ");
  const cat = thread.categories?.[0];
  const metaColor = selected ? "text-secondary" : "text-tertiary";
  return (
    <div
      role="option"
      aria-selected={!!selected}
      tabIndex={-1}
      data-focused={focused || undefined}
      onClick={() => onOpen(thread)}
      className={clsx(
        "mail-row flex pr-3 pl-1.5 rounded-[9px] gap-1.5 py-2.5 cursor-default outline-none",
        selected && "bg-list-selected",
        focused && "ring-2 ring-accent ring-inset",
      )}
    >
      <div className="flex justify-center w-2.5 shrink-0 pt-1.25">
        {thread.unread && (
          <div className="rounded-sm shrink-0 bg-accent size-2" />
        )}
      </div>
      <div className="flex flex-col grow basis-0 min-w-0 gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <div
              className={clsx(
                "line-clamp-1 text-[13px]/4 text-primary",
                thread.unread ? "font-semibold" : "font-medium",
              )}
            >
              {sender}
            </div>
            {thread.messageCount > 1 && (
              <div className="tnum text-secondary text-xs/4 shrink-0">
                {thread.messageCount}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.75 shrink-0">
            {cat && (
              <div
                className="rounded-[3px] shrink-0 size-1.5"
                style={{ background: cat.color }}
              />
            )}
            {thread.hasAttachments && (
              <PaperclipIcon size={12} className="text-tertiary" />
            )}
            <div className={clsx("tnum text-xs/4", metaColor)}>
              {formatListDate(thread.lastMessageAt)}
            </div>
          </div>
        </div>
        <div
          className={clsx(
            "line-clamp-1 text-[13px]/4",
            selected
              ? "text-primary"
              : thread.unread
                ? "font-medium text-primary"
                : "text-icon-strong",
          )}
        >
          {thread.subject}
        </div>
        <div
          className={clsx(
            "line-clamp-1 text-[13px]/4",
            selected ? "text-secondary" : "text-tertiary",
          )}
        >
          {thread.snippet}
        </div>
      </div>
    </div>
  );
}
