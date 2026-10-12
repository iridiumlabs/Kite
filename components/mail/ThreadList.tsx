"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import type { ThreadItem } from "@/lib/ui/types";
import { dateGroupLabel, groupKey } from "@/lib/ui/dates";
import {
  ThreadRowWide,
  ThreadRowCompact,
  type RowActionHandlers,
} from "./ThreadRows";

export interface ThreadListProps {
  threads: ThreadItem[];
  layout: "wide" | "compact";
  selectedId?: string;
  focusedId?: string;
  onOpen: (t: ThreadItem) => void;
  actions?: RowActionHandlers;
  footer?: ReactNode;
}

export function ThreadList({
  threads,
  layout,
  selectedId,
  focusedId,
  onOpen,
  actions,
  footer,
}: ThreadListProps) {
  if (layout === "compact") {
    return (
      <div
        role="listbox"
        aria-label="Threads"
        className="flex flex-col px-2 gap-0.5 pb-4"
      >
        {threads.map((t) => (
          <ThreadRowCompact
            key={t.id}
            thread={t}
            selected={t.id === selectedId}
            focused={t.id === focusedId}
            onOpen={onOpen}
          />
        ))}
        {footer}
      </div>
    );
  }

  const groups: { key: string; label: string; items: ThreadItem[] }[] = [];
  for (const t of threads) {
    const key = groupKey(t.lastMessageAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.items.push(t);
    } else {
      groups.push({ key, label: dateGroupLabel(t.lastMessageAt), items: [t] });
    }
  }

  return (
    <div role="listbox" aria-label="Threads" className="flex flex-col pb-6 px-4">
      {groups.map((g, i) => (
        <div key={g.key} className={clsx("flex flex-col", i > 0 && "pt-3")}>
          <div className="pl-8 py-1.5">
            <div className="font-semibold text-tertiary text-xs/4">
              {g.label}
            </div>
          </div>
          {g.items.map((t) => (
            <ThreadRowWide
              key={t.id}
              thread={t}
              selected={t.id === selectedId}
              focused={t.id === focusedId}
              onOpen={onOpen}
              actions={actions}
            />
          ))}
        </div>
      ))}
      {footer}
    </div>
  );
}
