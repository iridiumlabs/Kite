"use client";

import { useEffect, useRef } from "react";

export interface ShortcutHandlers {
  onNext: () => void;
  onPrev: () => void;
  onOpen: () => void;
  onClose: () => void;
  onArchive: () => void;
  onTrash: () => void;
  onStar: () => void;
  onToggleRead: () => void;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onCompose: () => void;
  onSearch: () => void;
  onSettings: () => void;
  onHelp: () => void;
  onUndo: () => void;
  onGo: (key: string) => void;
}

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return !!target.closest(".ProseMirror");
}

export function useMailShortcuts(h: ShortcutHandlers) {
  const handlers = useRef(h);
  useEffect(() => {
    handlers.current = h;
  });
  const gPending = useRef(false);
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;

      // modifier shortcuts work even while typing
      if (mod && key.toLowerCase() === "k") {
        e.preventDefault();
        handlers.current.onSearch();
        return;
      }
      if (mod && key === ",") {
        e.preventDefault();
        handlers.current.onSettings();
        return;
      }
      if (mod && key === "Enter") {
        return; // handled inside compose
      }
      if (key === "Escape") {
        handlers.current.onClose();
        return;
      }
      if (isTyping(e.target)) return;

      // g-sequence
      if (gPending.current) {
        gPending.current = false;
        if (gTimer.current) clearTimeout(gTimer.current);
        if ("posdat".includes(key)) {
          e.preventDefault();
          handlers.current.onGo(key);
          return;
        }
      }

      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (key) {
        case "j":
        case "ArrowDown":
          e.preventDefault();
          handlers.current.onNext();
          break;
        case "k":
        case "ArrowUp":
          e.preventDefault();
          handlers.current.onPrev();
          break;
        case "Enter":
        case "o":
          e.preventDefault();
          handlers.current.onOpen();
          break;
        case "e":
          e.preventDefault();
          handlers.current.onArchive();
          break;
        case "#":
        case "Delete":
        case "Backspace":
          e.preventDefault();
          handlers.current.onTrash();
          break;
        case "s":
          e.preventDefault();
          handlers.current.onStar();
          break;
        case "u":
          e.preventDefault();
          handlers.current.onToggleRead();
          break;
        case "r":
          e.preventDefault();
          handlers.current.onReply();
          break;
        case "a":
          e.preventDefault();
          handlers.current.onReplyAll();
          break;
        case "f":
          e.preventDefault();
          handlers.current.onForward();
          break;
        case "c":
          e.preventDefault();
          handlers.current.onCompose();
          break;
        case "/":
          e.preventDefault();
          handlers.current.onSearch();
          break;
        case "?":
          e.preventDefault();
          handlers.current.onHelp();
          break;
        case "z":
          e.preventDefault();
          handlers.current.onUndo();
          break;
        case "[":
          e.preventDefault();
          handlers.current.onPrev();
          break;
        case "]":
          e.preventDefault();
          handlers.current.onNext();
          break;
        case "g":
          gPending.current = true;
          if (gTimer.current) clearTimeout(gTimer.current);
          gTimer.current = setTimeout(() => {
            gPending.current = false;
          }, 800);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
