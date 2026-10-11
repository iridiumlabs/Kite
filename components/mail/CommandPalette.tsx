"use client";

import { Command } from "cmdk";
import { useEffect, useRef } from "react";
import { SearchIcon } from "@/components/icons";
import type { ThreadItem } from "@/lib/ui/types";
import { senderDisplay } from "@/lib/ui/avatars";
import { formatListDate } from "@/lib/ui/dates";

export interface PaletteCommand {
  id: string;
  label: string;
  hint?: string;
  onSelect: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  results: ThreadItem[];
  searching?: boolean;
  onOpenThread: (t: ThreadItem) => void;
  onServerSearch: () => void;
  commands: PaletteCommand[];
}

export function CommandPalette(p: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (p.open) {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [p.open]);

  if (!p.open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/20"
      onClick={p.onClose}
      role="presentation"
    >
      <div
        className="dialog-popup w-[560px] max-w-[92vw] rounded-xl bg-menu-bg overflow-clip"
        style={{ boxShadow: "var(--shadow-compose)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <Command label="Search mail" shouldFilter={false} loop>
          <div className="flex items-center h-12 px-4 gap-2.5 border-b border-divider">
            <SearchIcon className="text-tertiary shrink-0" />
            <Command.Input
              ref={inputRef}
              value={p.query}
              onValueChange={p.onQueryChange}
              placeholder="Search mail or type a command"
              className="grow bg-transparent outline-none text-[14px]/5 text-primary placeholder:text-quaternary"
            />
            <div className="kbd">esc</div>
          </div>
          <Command.List className="max-h-[380px] overflow-y-auto p-2">
            {p.query.length === 0 ? (
              <Command.Group
                heading={
                  <div className="px-2 py-1 text-[11px]/3.5 font-semibold tracking-[0.01em] text-tertiary">
                    Commands
                  </div>
                }
              >
                {p.commands.map((c) => (
                  <Command.Item
                    key={c.id}
                    value={c.id}
                    onSelect={c.onSelect}
                    className="flex items-center h-8 px-2 rounded-md gap-2.5 cursor-default data-[selected=true]:bg-hover-strong"
                  >
                    <div className="grow text-[13px]/4 text-primary">
                      {c.label}
                    </div>
                    {c.hint && (
                      <div className="text-quaternary text-xs/4">{c.hint}</div>
                    )}
                  </Command.Item>
                ))}
              </Command.Group>
            ) : (
              <>
                <Command.Group
                  heading={
                    <div className="px-2 py-1 text-[11px]/3.5 font-semibold tracking-[0.01em] text-tertiary">
                      Threads
                    </div>
                  }
                >
                  {p.results.map((t) => (
                    <Command.Item
                      key={t.id}
                      value={t.id}
                      onSelect={() => p.onOpenThread(t)}
                      className="flex items-center gap-2.5 px-2 py-1.5 rounded-md cursor-default data-[selected=true]:bg-hover-strong"
                    >
                      <div className="w-40 shrink-0 text-[13px]/4 font-medium text-primary line-clamp-1">
                        {t.participants.map(senderDisplay).join(", ")}
                      </div>
                      <div className="flex items-center grow min-w-0 gap-2">
                        <div className="shrink-0 text-[13px]/4 text-icon-strong line-clamp-1">
                          {t.subject}
                        </div>
                        <div className="grow min-w-0 text-[13px]/4 text-tertiary line-clamp-1">
                          {t.snippet}
                        </div>
                      </div>
                      <div className="tnum shrink-0 text-tertiary text-xs/4">
                        {formatListDate(t.lastMessageAt)}
                      </div>
                    </Command.Item>
                  ))}
                  {!p.searching && p.results.length === 0 && (
                    <div className="px-2 py-3 text-[13px]/4 text-tertiary">
                      No results in synced mail
                    </div>
                  )}
                </Command.Group>
                <Command.Item
                  value="__server-search"
                  onSelect={p.onServerSearch}
                  className="flex items-center h-8 px-2 rounded-md gap-2.5 cursor-default data-[selected=true]:bg-hover-strong"
                >
                  <div className="grow text-[13px]/4 text-primary">
                    Search all mail on the server
                  </div>
                  <div className="text-quaternary text-xs/4">IMAP</div>
                </Command.Item>
              </>
            )}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
