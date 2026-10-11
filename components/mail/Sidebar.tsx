"use client";

import clsx from "clsx";
import type { ReactNode } from "react";
import {
  Inbox,
  Layers,
  Send,
  FileText,
  Archive,
  Trash,
  StarSidebar,
  SnoozeSidebar,
  ChevronDown,
  Plus,
  SquarePen,
} from "@/components/icons";
import { ProfileMenu, type ProfileMenuProps } from "./ProfileMenu";
import type { AccountInfo, CategoryInfo, UserInfo, ViewKind } from "@/lib/ui/types";

export interface SidebarProps {
  user: UserInfo;
  profile: Omit<ProfileMenuProps, "user">;
  view: ViewKind;
  viewId?: string;
  counts: {
    primaryUnread: number;
    otherUnread: number;
    drafts: number;
  };
  categories: CategoryInfo[];
  accounts: AccountInfo[];
  collapsed: { categories: boolean; accounts: boolean };
  onNavigate: (view: ViewKind, id?: string) => void;
  onCompose: () => void;
  onToggleSection: (section: "categories" | "accounts") => void;
  onAddCategory: () => void;
  onEditCategory: (id: string) => void;
  onAddAccount: () => void;
  onReconnectAccount: (id: string) => void;
}

function NavRow({
  selected,
  onClick,
  icon,
  label,
  count,
  countClass,
}: {
  selected?: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  count?: number;
  countClass?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "flex items-center h-7 pr-2.5 pl-2 rounded-md gap-2.5 shrink-0 w-full text-left mail-row",
        selected && "bg-sidebar-selected",
      )}
    >
      {icon}
      <div
        className={clsx(
          "grow basis-0 text-[13px]/4 text-primary min-w-0",
          selected ? "font-medium" : "font-normal",
        )}
      >
        {label}
      </div>
      {count !== undefined && count > 0 && (
        <div className={clsx("tnum text-xs/4", countClass ?? "text-tertiary")}>
          {count}
        </div>
      )}
    </button>
  );
}

function SectionHeader({
  title,
  collapsed,
  onToggle,
  onAdd,
  addLabel,
}: {
  title: string;
  collapsed: boolean;
  onToggle: () => void;
  onAdd: () => void;
  addLabel: string;
}) {
  return (
    <div className="flex items-center justify-between h-6.5 pr-1 pl-2 shrink-0">
      <button
        onClick={onToggle}
        className="flex items-center gap-1"
        aria-expanded={!collapsed}
      >
        <div className="tracking-[0.01em] font-semibold text-tertiary text-[11px]/3.5">
          {title}
        </div>
        <span
          className="inline-flex transition-transform duration-150 ease-out"
          style={{ transform: collapsed ? "rotate(-90deg)" : "none" }}
        >
          <ChevronDown className="text-quaternary" />
        </span>
      </button>
      <button
        onClick={onAdd}
        aria-label={addLabel}
        className="icon-btn rounded-[5px] size-5 text-tertiary"
      >
        <Plus />
      </button>
    </div>
  );
}

export function Sidebar(p: SidebarProps) {
  const nav = (
    <div className="flex flex-col gap-px pt-1.5">
      <NavRow
        selected={p.view === "primary"}
        onClick={() => p.onNavigate("primary")}
        icon={<Inbox className="text-accent" />}
        label="Primary"
        count={p.counts.primaryUnread}
        countClass="font-medium text-secondary"
      />
      <NavRow
        selected={p.view === "other"}
        onClick={() => p.onNavigate("other")}
        icon={<Layers className="text-accent" />}
        label="Other"
        count={p.counts.otherUnread}
      />
      <NavRow
        selected={p.view === "sent"}
        onClick={() => p.onNavigate("sent")}
        icon={<Send className="text-accent" />}
        label="Sent"
      />
      <NavRow
        selected={p.view === "drafts"}
        onClick={() => p.onNavigate("drafts")}
        icon={<FileText className="text-accent" />}
        label="Drafts"
        count={p.counts.drafts}
      />
      <NavRow
        selected={p.view === "archive"}
        onClick={() => p.onNavigate("archive")}
        icon={<Archive className="text-accent" />}
        label="Archive"
      />
      <NavRow
        selected={p.view === "snoozed"}
        onClick={() => p.onNavigate("snoozed")}
        icon={<SnoozeSidebar className="text-accent" />}
        label="Snoozed"
      />
      <NavRow
        selected={p.view === "starred"}
        onClick={() => p.onNavigate("starred")}
        icon={<StarSidebar className="text-accent" />}
        label="Starred"
      />
      <NavRow
        selected={p.view === "trash"}
        onClick={() => p.onNavigate("trash")}
        icon={<Trash className="text-accent" />}
        label="Trash"
      />
    </div>
  );

  const categories = (
    <div className="flex flex-col pt-4.5 gap-px">
      <SectionHeader
        title="Categories"
        collapsed={p.collapsed.categories}
        onToggle={() => p.onToggleSection("categories")}
        onAdd={p.onAddCategory}
        addLabel="New category"
      />
      {!p.collapsed.categories &&
        p.categories.map((c) => (
          <div key={c.id} className="group relative">
            <button
              onClick={() => p.onNavigate("category", c.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                p.onEditCategory(c.id);
              }}
              className={clsx(
                "flex items-center h-7 pr-2.5 pl-2 rounded-md gap-2.5 shrink-0 w-full text-left mail-row",
                p.view === "category" && p.viewId === c.id && "bg-sidebar-selected",
              )}
            >
              <div className="flex items-center justify-center shrink-0 size-4">
                <div
                  className="rounded-sm shrink-0 size-2"
                  style={{ background: c.color }}
                />
              </div>
              <div className="grow basis-0 text-[13px]/4 text-primary min-w-0 line-clamp-1">
                {c.name}
              </div>
              {c.unread !== undefined && c.unread > 0 && (
                <div className="tnum text-tertiary text-xs/4">{c.unread}</div>
              )}
            </button>
          </div>
        ))}
    </div>
  );

  const accounts = (
    <div className="flex flex-col pt-4.5 gap-px">
      <SectionHeader
        title="Accounts"
        collapsed={p.collapsed.accounts}
        onToggle={() => p.onToggleSection("accounts")}
        onAdd={p.onAddAccount}
        addLabel="Connect account"
      />
      {!p.collapsed.accounts &&
        p.accounts.map((a) => (
          <button
            key={a.id}
            onClick={() => p.onNavigate("account", a.id)}
            className={clsx(
              "flex items-center h-7 pr-2.5 pl-2 rounded-md gap-2.5 shrink-0 w-full text-left mail-row",
              p.view === "account" && p.viewId === a.id && "bg-sidebar-selected",
            )}
          >
            <div className="flex items-center justify-center shrink-0 rounded-lg bg-badge-bg size-4">
              <div className="flex font-bold text-badge-text text-[9px]/3">
                {a.email.slice(0, 1).toUpperCase()}
              </div>
            </div>
            <div className="grow basis-0 text-[13px]/4 text-primary min-w-0 line-clamp-1">
              {a.email}
            </div>
            {a.syncing && (
              <span
                className="size-3 rounded-full border border-tertiary border-t-transparent animate-spin"
                aria-label="Syncing"
              />
            )}
            {!a.syncing && a.status !== "active" && (
              <span
                className="size-1.5 rounded-full bg-danger"
                title={a.lastError ?? "Connection issue"}
              />
            )}
            {a.unread !== undefined && a.unread > 0 && (
              <div className="tnum text-tertiary text-xs/4">{a.unread}</div>
            )}
          </button>
        ))}
    </div>
  );

  return (
    <div className="flex flex-col w-60 h-full shrink-0 px-2.5 bg-sidebar border-r border-sidebar-border">
      <div className="flex items-center gap-1.5 shrink-0 h-13">
        <div className="relative grow basis-0 min-w-0">
          <ProfileMenu user={p.user} {...p.profile} />
        </div>
        <button
          onClick={p.onCompose}
          aria-label="Compose"
          className="icon-btn w-7.5 h-7.5 rounded-[7px] shrink-0 text-icon-strong"
        >
          <SquarePen />
        </button>
      </div>
      {nav}
      <div className="flex-1 overflow-y-auto">
        {categories}
        {accounts}
      </div>
    </div>
  );
}
