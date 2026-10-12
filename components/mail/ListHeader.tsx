"use client";

import { Menu } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import { SearchIcon, FilterLines } from "@/components/icons";

export type ListFilter = "all" | "unread" | "starred" | "attachments";

const FILTER_LABELS: Record<ListFilter, string> = {
  all: "All",
  unread: "Unread",
  starred: "Starred",
  attachments: "Has attachments",
};

export function SearchField({
  wide,
  onOpen,
}: {
  wide?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className={
        "flex items-center h-7.5 pr-2 pl-2.25 rounded-lg gap-1.75 bg-search-field text-left " +
        (wide ? "w-75 shrink-0" : "grow basis-0")
      }
    >
      <SearchIcon className="text-tertiary" />
      <div className="grow basis-0 text-tertiary text-[13px]/4">Search</div>
      <div className="kbd">⌘K</div>
    </button>
  );
}

function FilterMenu({
  filter,
  onChange,
  onGoView,
}: {
  filter: ListFilter;
  onChange: (f: ListFilter) => void;
  onGoView?: (v: "starred" | "snoozed") => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Filter"
        className="icon-btn w-7.5 h-7.5 text-secondary outline-none"
      >
        <FilterLines />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={6} className="z-50">
          <Menu.Popup
            className="menu-popup min-w-40 p-1.25 rounded-[11px] bg-menu-bg outline-none"
            style={{ boxShadow: "var(--shadow-menu)" }}
          >
            <div className="flex flex-col py-0.5 gap-px">
              {(Object.keys(FILTER_LABELS) as ListFilter[]).map((f) => (
                <Menu.Item
                  key={f}
                  onClick={() => onChange(f)}
                  className="flex items-center h-7 px-2 rounded-md gap-2.5 data-[highlighted]:bg-hover-strong outline-none cursor-default"
                >
                  <div className="grow text-[13px]/4 text-primary">
                    {FILTER_LABELS[f]}
                  </div>
                  {filter === f && (
                    <div className="text-accent text-xs/4">✓</div>
                  )}
                </Menu.Item>
              ))}
            </div>
            {onGoView && (
              <>
                <div className="h-px bg-separator mx-2 my-1" />
                <div className="flex flex-col py-0.5 gap-px">
                  {(["starred", "snoozed"] as const).map((v) => (
                    <Menu.Item
                      key={v}
                      onClick={() => onGoView(v)}
                      className="flex items-center h-7 px-2 rounded-md gap-2.5 data-[highlighted]:bg-hover-strong outline-none cursor-default"
                    >
                      <div className="grow text-[13px]/4 text-primary">
                        {v === "starred" ? "Starred" : "Snoozed"}
                      </div>
                    </Menu.Item>
                  ))}
                </div>
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function ListHeader({
  title,
  unread,
  wide,
  filter,
  onFilterChange,
  onGoView,
  onOpenSearch,
  extra,
}: {
  title: ReactNode;
  unread?: number;
  wide?: boolean;
  filter: ListFilter;
  onFilterChange: (f: ListFilter) => void;
  onGoView?: (v: "starred" | "snoozed") => void;
  onOpenSearch: () => void;
  extra?: ReactNode;
}) {
  return (
    <div
      className={
        "flex items-center justify-between h-13 shrink-0 " +
        (wide ? "pr-6 pl-12" : "pr-3 pl-5")
      }
    >
      <div className="flex items-baseline gap-2 min-w-0">
        <div className="tracking-[-0.012em] font-bold text-primary text-[15px]/4.5 line-clamp-1">
          {title}
        </div>
        {unread !== undefined && unread > 0 && (
          <div className="tnum text-tertiary text-xs/4 shrink-0">
            {unread} unread
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {wide && <SearchField wide onOpen={onOpenSearch} />}
        {extra}
        <FilterMenu
          filter={filter}
          onChange={onFilterChange}
          onGoView={onGoView}
        />
      </div>
    </div>
  );
}
