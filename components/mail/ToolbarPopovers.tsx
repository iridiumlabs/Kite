"use client";

import { Popover } from "@base-ui/react/popover";
import { Menu } from "@base-ui/react/menu";
import { useState, type ReactNode } from "react";
import clsx from "clsx";
import { Tag, Clock, MoreDots, ChevronRight } from "@/components/icons";
import type { CategoryInfo } from "@/lib/ui/types";

function popoverStyle(): React.CSSProperties {
  return { boxShadow: "var(--shadow-menu)" };
}

const popupCls =
  "menu-popup min-w-56 p-1.25 rounded-[11px] bg-menu-bg outline-none";

function MenuItemRow({
  onClick,
  children,
  right,
}: {
  onClick?: () => void;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <Menu.Item
      onClick={onClick}
      className="flex items-center h-7 px-2 rounded-md gap-2.5 data-[highlighted]:bg-hover-strong outline-none cursor-default"
    >
      <div className="grow text-[13px]/4 text-primary">{children}</div>
      {right}
    </Menu.Item>
  );
}

/** Tag popover: inbox switch + category checkboxes */
export function TagPopover({
  inbox,
  categories,
  assignedIds,
  onMoveToInbox,
  onToggleCategory,
  onNewCategory,
}: {
  inbox?: "primary" | "other";
  categories: CategoryInfo[];
  assignedIds: Set<string>;
  onMoveToInbox: (inbox: "primary" | "other") => void;
  onToggleCategory: (id: string) => void;
  onNewCategory: () => void;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label="Categories"
        className="icon-btn w-8 h-7 outline-none"
      >
        <Tag />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-50"
        >
          <Popover.Popup className={popupCls} style={popoverStyle()}>
            {inbox && (
              <div className="flex items-center p-1 pb-1.5">
                <div className="flex grow rounded-lg bg-hover p-0.5">
                  {(["primary", "other"] as const).map((b) => (
                    <button
                      key={b}
                      onClick={() => onMoveToInbox(b)}
                      className={clsx(
                        "grow h-6 rounded-[6px] text-[13px]/4 capitalize pressable",
                        inbox === b
                          ? "bg-app font-medium text-primary shadow-sm"
                          : "text-secondary",
                      )}
                    >
                      {b}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="flex flex-col gap-px">
              {categories.map((c) => (
                <button
                  key={c.id}
                  onClick={() => onToggleCategory(c.id)}
                  className="flex items-center h-7 px-2 rounded-md gap-2.5 hover:bg-hover-strong text-left"
                >
                  <div
                    className="rounded-sm shrink-0 size-2"
                    style={{ background: c.color }}
                  />
                  <div className="grow text-[13px]/4 text-primary">
                    {c.name}
                  </div>
                  {assignedIds.has(c.id) && (
                    <div className="text-accent text-xs/4">✓</div>
                  )}
                </button>
              ))}
            </div>
            <div className="h-px bg-divider mx-2 my-1" />
            <button
              onClick={onNewCategory}
              className="flex items-center w-full h-7 px-2 rounded-md gap-2.5 hover:bg-hover-strong text-left text-[13px]/4 text-primary"
            >
              New category
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function nextHour(h: number): Date {
  const d = new Date();
  if (d.getHours() < h) {
    d.setHours(h, 0, 0, 0);
  } else {
    d.setDate(d.getDate() + 1);
    d.setHours(h, 0, 0, 0);
  }
  return d;
}

function nextWeekday(target: number, h = 8): Date {
  const d = new Date();
  const diff = (target - d.getDay() + 7) % 7 || 7;
  d.setDate(d.getDate() + diff);
  d.setHours(h, 0, 0, 0);
  return d;
}

export const SNOOZE_PRESETS: { label: string; at: () => number }[] = [
  { label: "Later today", at: () => nextHour(18).getTime() },
  { label: "Tomorrow", at: () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(8, 0, 0, 0);
    return d.getTime();
  } },
  { label: "This weekend", at: () => nextWeekday(6, 8).getTime() },
  { label: "Next week", at: () => nextWeekday(1, 8).getTime() },
];

export function SnoozePopover({
  onSnooze,
  onUnsnooze,
  snoozed,
}: {
  onSnooze: (until: number) => void;
  onUnsnooze?: () => void;
  snoozed?: boolean;
}) {
  const [custom, setCustom] = useState("");
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label="Snooze"
        className="icon-btn w-8 h-7 outline-none"
      >
        <Clock />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={6}
          className="z-50"
        >
          <Popover.Popup className={popupCls} style={popoverStyle()}>
            <div className="flex flex-col gap-px">
              {snoozed && onUnsnooze && (
                <button
                  onClick={onUnsnooze}
                  className="flex items-center h-7 px-2 rounded-md hover:bg-hover-strong text-left text-[13px]/4 text-primary"
                >
                  Unsnooze
                </button>
              )}
              {SNOOZE_PRESETS.map((p) => (
                <button
                  key={p.label}
                  onClick={() => onSnooze(p.at())}
                  className="flex items-center h-7 px-2 rounded-md hover:bg-hover-strong text-left text-[13px]/4 text-primary"
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="h-px bg-divider mx-2 my-1" />
            <div className="flex flex-col gap-1.5 px-2 pb-1.5">
              <div className="text-tertiary text-[11px]/3.5 font-semibold tracking-[0.01em]">
                Pick date & time
              </div>
              <input
                type="datetime-local"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                className="h-7 rounded-md bg-search-field px-2 text-[13px]/4 text-primary outline-none"
              />
              {custom && (
                <button
                  onClick={() => onSnooze(new Date(custom).getTime())}
                  className="h-7 rounded-md bg-accent text-white text-[13px]/4 font-medium pressable"
                >
                  Snooze
                </button>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function MoreMenu({
  inTrash,
  onReply,
  onReplyAll,
  onForward,
  onMoveToInbox,
  onMarkUnread,
  onDeleteForever,
}: {
  inTrash?: boolean;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onMoveToInbox: (inbox: "primary" | "other") => void;
  onMarkUnread: () => void;
  onDeleteForever?: () => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="More"
        className="icon-btn w-8 h-7 outline-none"
      >
        <MoreDots />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
          <Menu.Popup className={popupCls} style={popoverStyle()}>
            <div className="flex flex-col py-0.5 gap-px">
              <MenuItemRow onClick={onReply}>Reply</MenuItemRow>
              <MenuItemRow onClick={onReplyAll}>Reply All</MenuItemRow>
              <MenuItemRow onClick={onForward}>Forward</MenuItemRow>
              <div className="h-px bg-divider mx-2 my-1" />
              <MenuItemRow onClick={() => onMoveToInbox("primary")}>
                Move to Primary
              </MenuItemRow>
              <MenuItemRow onClick={() => onMoveToInbox("other")}>
                Move to Other
              </MenuItemRow>
              <MenuItemRow onClick={onMarkUnread}>
                Mark as unread
              </MenuItemRow>
              {inTrash && onDeleteForever && (
                <>
                  <div className="h-px bg-divider mx-2 my-1" />
                  <MenuItemRow onClick={onDeleteForever}>
                    <span className="text-danger">Delete forever</span>
                  </MenuItemRow>
                </>
              )}
            </div>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

/** Small submenu-style trigger used inside popovers */
export function SubLabel({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center justify-between h-7 px-2 text-[13px]/4 text-secondary">
      {children}
      <ChevronRight className="text-quaternary" />
    </div>
  );
}
