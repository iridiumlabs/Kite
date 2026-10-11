"use client";

import { create } from "zustand";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "draft";

export interface ComposeOpen {
  mode: ComposeMode;
  draftId?: string;
  accountId?: string;
  threadId?: string;
  replyToMessageId?: string;
  expanded?: boolean;
}

export interface ComposeWindowState extends ComposeOpen {
  id: string;
  minimized: boolean;
  expanded: boolean;
}

export type SettingsTab =
  | "general"
  | "connections"
  | "categories"
  | "appearance"
  | "mcp"
  | "keyboard";

export type ListFilter = "all" | "unread" | "starred" | "attachments";

interface UIState {
  paletteOpen: boolean;
  setPaletteOpen: (v: boolean) => void;
  settingsOpen: boolean;
  settingsTab: SettingsTab;
  openSettings: (tab?: SettingsTab) => void;
  closeSettings: () => void;
  filter: ListFilter;
  setFilter: (f: ListFilter) => void;
  focusedThreadId: string | null;
  setFocusedThreadId: (id: string | null) => void;
  sidebarOpen: boolean;
  setSidebarOpen: (v: boolean) => void;
  compose: ComposeWindowState[];
  openCompose: (opts: ComposeOpen) => string;
  closeCompose: (id: string) => void;
  minimizeCompose: (id: string) => void;
  restoreCompose: (id: string) => void;
  setComposeDraft: (id: string, draftId: string) => void;
  toggleExpandCompose: (id: string) => void;
  lastAction: (() => void) | null;
  setLastAction: (fn: (() => void) | null) => void;
  shortcutHelpOpen: boolean;
  setShortcutHelpOpen: (v: boolean) => void;
}

let composeSeq = 0;

export const useUI = create<UIState>((set, get) => ({
  paletteOpen: false,
  setPaletteOpen: (v) => set({ paletteOpen: v }),
  settingsOpen: false,
  settingsTab: "general",
  openSettings: (tab) =>
    set({ settingsOpen: true, settingsTab: tab ?? "general" }),
  closeSettings: () => set({ settingsOpen: false }),
  filter: "all",
  setFilter: (filter) => set({ filter }),
  focusedThreadId: null,
  setFocusedThreadId: (focusedThreadId) => set({ focusedThreadId }),
  sidebarOpen: false,
  setSidebarOpen: (v) => set({ sidebarOpen: v }),
  compose: [],
  openCompose: (opts) => {
    const existing = get().compose.find(w =>
      opts.mode === "new" ? w.mode === "new"
        : opts.mode === "draft" ? !!opts.draftId && w.draftId === opts.draftId
        : !!opts.replyToMessageId && w.mode === opts.mode && w.replyToMessageId === opts.replyToMessageId);
    if (existing) {
      // Reuse the mounted editor and its unsaved content, restore it if needed,
      // and bring it to the rightmost/front position instead of stacking copies.
      set(s => ({
        compose: [...s.compose.filter(w => w.id !== existing.id), { ...existing, minimized: false }],
      }));
      return existing.id;
    }
    const id = `compose-${++composeSeq}`;
    set((s) => ({
      compose: [
        ...s.compose,
        {
          id,
          minimized: false,
          expanded: opts.expanded ?? false,
          ...opts,
        },
      ],
    }));
    return id;
  },
  closeCompose: (id) =>
    set((s) => ({ compose: s.compose.filter((w) => w.id !== id) })),
  minimizeCompose: (id) =>
    set((s) => ({
      compose: s.compose.map((w) =>
        w.id === id ? { ...w, minimized: true } : w,
      ),
    })),
  restoreCompose: (id) =>
    set((s) => ({
      compose: s.compose.map((w) =>
        w.id === id ? { ...w, minimized: false } : w,
      ),
    })),
  setComposeDraft: (id, draftId) =>
    set((s) => ({
      compose: s.compose.map((w) =>
        w.id === id ? { ...w, draftId, mode: w.mode === "draft" ? "draft" : w.mode } : w,
      ),
    })),
  toggleExpandCompose: (id) =>
    set((s) => ({
      compose: s.compose.map((w) =>
        w.id === id ? { ...w, expanded: !w.expanded } : w,
      ),
    })),
  lastAction: null,
  setLastAction: (fn) => set({ lastAction: fn }),
  shortcutHelpOpen: false,
  setShortcutHelpOpen: (v) => set({ shortcutHelpOpen: v }),
}));
