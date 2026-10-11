"use client";

import clsx from "clsx";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  MinusIcon,
  ExpandIcon,
  RestoreIcon,
  XIcon,
  Send,
  TypeIcon,
  PaperclipIcon,
  LinkIcon,
  Trash,
  ChevronDown,
} from "@/components/icons";
import { avatarColors, initials } from "@/lib/ui/avatars";
import { formatBytes } from "@/lib/ui/dates";
import { useMediaQuery } from "@/lib/ui/useMediaQuery";
import { animateComposeResize } from "@/lib/ui/composeResize";

export interface RecipientChip {
  email: string;
  name?: string;
  invalid?: boolean;
}

export interface ComposeAttachment {
  uploadId?: string;
  filename: string;
  contentType: string;
  size: number;
  uploading?: boolean;
  progress?: number;
}

export interface ComposeWindowProps {
  subject: string;
  status: "idle" | "saving" | "saved" | "scheduled" | "error";
  scheduledLabel?: string;
  // fields
  fromLabel: ReactNode;
  to: RecipientChip[];
  cc: RecipientChip[];
  bcc: RecipientChip[];
  showCc: boolean;
  showBcc: boolean;
  toInput: ReactNode;
  ccInput?: ReactNode;
  bccInput?: ReactNode;
  onShowCc?: () => void;
  onShowBcc?: () => void;
  subjectInput: ReactNode;
  // body
  editor: ReactNode;
  quoted?: ReactNode;
  sendError?: string;
  sendResolution?: ReactNode;
  attachments: ComposeAttachment[];
  onRemoveAttachment?: (i: number) => void;
  formatBar?: ReactNode;
  // chrome
  onMinimize: () => void;
  onExpand: () => void;
  onClose: () => void;
  // footer
  onSend: () => void;
  onAttach: () => void;
  onInsertLink: () => void;
  onSchedule: ReactNode;
  onToggleFormat?: () => void;
  formatOpen?: boolean;
  onDiscard: () => void;
  sendDisabled?: boolean;
  expanded?: boolean;
  mobile?: boolean;
}

export function RecipientChipView({ chip }: { chip: RecipientChip }) {
  const { bg, fg } = avatarColors(chip.email);
  const label = chip.name?.trim() || chip.email;
  return (
    <div
      className={clsx(
        "flex items-center h-6 pr-2 pl-0.75 rounded-xl gap-1.5",
        chip.invalid ? "bg-[#FF3B301A]" : "bg-list-selected",
      )}
    >
      <div
        className="flex items-center justify-center w-4.5 h-4.5 rounded-[9px] shrink-0"
        style={{ background: bg }}
      >
        <div
          className="flex font-semibold text-[9px]/3"
          style={{ color: fg }}
        >
          {initials(label)}
        </div>
      </div>
      <div
        className={clsx(
          "font-medium text-[13px]/4",
          chip.invalid ? "text-danger" : "text-[#0A5BC4] dark:text-[#5E9FFF]",
        )}
      >
        {label}
      </div>
    </div>
  );
}

export function AttachmentChip({
  att,
  onRemove,
}: {
  att: ComposeAttachment;
  onRemove?: () => void;
}) {
  const ext = att.filename.split(".").pop()?.slice(0, 3).toUpperCase() ?? "FILE";
  return (
    <div className="flex items-center h-11 pr-2 pl-2.5 rounded-[10px] gap-2.5 border border-border-card w-max max-w-full">
      <div className="flex items-center justify-center w-6.5 h-7.5 rounded-sm shrink-0 bg-[#FFEDEB] dark:bg-[#3A2624]">
        <div className="tracking-[0.02em] font-bold text-[8px]/2.5 text-[#D93A2B] dark:text-[#FF8A80]">
          {ext}
        </div>
      </div>
      <div className="flex flex-col gap-px min-w-0">
        <div className="font-medium text-primary text-xs/4 line-clamp-1">
          {att.filename}
        </div>
        <div className="tnum text-tertiary text-[11px]/3.5">
          {att.uploading
            ? `Uploading… ${Math.round((att.progress ?? 0) * 100)}%`
            : formatBytes(att.size)}
        </div>
      </div>
      {onRemove && (
        <button
          aria-label={`Remove ${att.filename}`}
          onClick={onRemove}
          className="icon-btn w-5.5 h-5.5 ml-1 rounded-[5px] text-tertiary"
        >
          <XIcon size={12} strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}

function FieldRow({
  label,
  children,
  right,
  tall,
}: {
  label: string;
  children: ReactNode;
  right?: ReactNode;
  tall?: boolean;
}) {
  return (
    <div
      className={clsx(
        "flex items-center gap-2.5 shrink-0 border-b border-divider",
        tall ? "h-11" : "min-h-10.5 py-1",
      )}
    >
      <div className="w-13 shrink-0 text-tertiary text-[13px]/4">{label}</div>
      <div className="flex items-center grow basis-0 gap-1.5 min-w-0 flex-wrap">
        {children}
      </div>
      {right}
    </div>
  );
}

// Collapsed preview of the original message that will be appended as a quote
// by the send action; not editable.
export function QuotedPreview({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 shrink-0 rounded-lg border border-divider">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center w-full h-8 px-2.5 gap-2 text-left rounded-lg mail-row"
      >
        <span className="tracking-[0.08em] text-tertiary text-xs/4">•••</span>
        <span className="grow text-tertiary text-xs/4">Quoted text</span>
        <span
          className="inline-flex disclosure-icon"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
        >
          <ChevronDown className="text-quaternary" />
        </span>
      </button>
      {open && (
        <div className="max-h-48 overflow-y-auto px-3 pb-3">
          <div className="whitespace-pre-wrap border-l-2 border-separator pl-2.5 text-secondary text-[13px]/5">
            {text}
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_LABEL: Record<string, string | undefined> = {
  saving: "Saving…",
  saved: "Draft saved",
  error: "Could not save",
  scheduled: undefined,
};

export function ComposeWindow(p: ComposeWindowProps) {
  const windowRef = useRef<HTMLDivElement>(null);
  const resizeFrom = useRef<DOMRect | null>(null);
  const resizeAnimation = useRef<Animation | null>(null);
  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");

  useLayoutEffect(() => {
    const from = resizeFrom.current;
    resizeFrom.current = null;
    // Cancel after measuring the live rectangle, so a rapid reverse never jumps
    // back to the previous target. This never controls mounting or visibility.
    resizeAnimation.current?.cancel();
    const node = windowRef.current;
    if (node && from) {
      const keyboard = document.documentElement.getAttribute("data-motion-input") === "keyboard";
      resizeAnimation.current = animateComposeResize(node, from, reduced || !!p.mobile || keyboard);
    }
    return () => resizeAnimation.current?.cancel();
  }, [p.expanded, p.mobile, reduced]);

  const toggleExpanded = () => {
    resizeFrom.current = windowRef.current?.getBoundingClientRect() ?? null;
    p.onExpand();
  };

  return (
    <div
      ref={windowRef}
      className={clsx(
        "flex flex-col overflow-clip bg-app origin-bottom-right",
        p.mobile
          ? "w-full h-full rounded-none"
          : p.expanded
            ? "w-[min(56rem,92vw)] h-[min(46rem,92vh)] rounded-xl"
            : "w-160 h-184 max-w-full rounded-xl",
      )}
      style={p.mobile ? undefined : { boxShadow: "var(--shadow-compose)" }}
      role="dialog"
      aria-label={p.subject || "New message"}
    >
      <div className="flex items-center justify-between h-11 shrink-0 pr-2 pl-4 bg-compose-header border-b border-divider">
        <div className="font-semibold text-primary text-[13px]/4 line-clamp-1 min-w-0">
          {p.subject || "New message"}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <div className="pr-2">
            <div className="text-quaternary text-xs/4">
              {p.status === "scheduled"
                ? (p.scheduledLabel ?? "Scheduled")
                : STATUS_LABEL[p.status]}
            </div>
          </div>
          <button
            aria-label="Minimize"
            onClick={p.onMinimize}
            className="icon-btn size-7 text-secondary"
          >
            <MinusIcon />
          </button>
          <button
            aria-label={p.expanded ? "Restore size" : "Expand"}
            title={p.expanded ? "Restore size" : "Expand"}
            aria-pressed={!!p.expanded}
            onClick={toggleExpanded}
            className="icon-btn size-7 text-secondary"
          >
            {p.expanded ? <RestoreIcon /> : <ExpandIcon />}
          </button>
          <button
            aria-label="Close"
            onClick={p.onClose}
            className="icon-btn size-7 text-secondary"
          >
            <XIcon />
          </button>
        </div>
      </div>
      <div className="flex flex-col shrink-0 px-4">
        <FieldRow label="From">
          <div className="flex items-center gap-1.5 min-w-0 mail-row rounded-md px-1 -ml-1">
            {p.fromLabel}
          </div>
        </FieldRow>
        <FieldRow
          label="To"
          right={
            <div className="flex items-center gap-3">
              {!p.showCc && (
                <button
                  onClick={p.onShowCc}
                  className="font-medium text-tertiary text-xs/4 pressable"
                >
                  Cc
                </button>
              )}
              {!p.showBcc && (
                <button
                  onClick={p.onShowBcc}
                  className="font-medium text-tertiary text-xs/4 pressable"
                >
                  Bcc
                </button>
              )}
            </div>
          }
        >
          {p.to.map((chip, i) => (
            <RecipientChipView key={i} chip={chip} />
          ))}
          {p.toInput}
        </FieldRow>
        {p.showCc && (
          <FieldRow label="Cc">
            {p.cc.map((chip, i) => (
              <RecipientChipView key={i} chip={chip} />
            ))}
            {p.ccInput}
          </FieldRow>
        )}
        {p.showBcc && (
          <FieldRow label="Bcc">
            {p.bcc.map((chip, i) => (
              <RecipientChipView key={i} chip={chip} />
            ))}
            {p.bccInput}
          </FieldRow>
        )}
        <div className="flex items-center h-11 gap-2.5 shrink-0 border-b border-divider">
          <div className="w-13 shrink-0 text-tertiary text-[13px]/4">
            Subject
          </div>
          <div className="grow basis-0 min-w-0">{p.subjectInput}</div>
        </div>
      </div>
      {p.sendError && (
        <div role="alert" className="shrink-0 border-b border-divider px-4 py-3 text-red-500 text-[13px]/5">
          {p.sendError}
          {p.sendResolution}
        </div>
      )}
      {p.formatBar}
      <div className="flex flex-col grow basis-0 min-h-0 pt-4.5 pb-4 px-4 overflow-y-auto">
        {p.editor}
        {p.quoted}
      </div>
      {p.attachments.length > 0 && (
        <div className="flex flex-wrap shrink-0 pb-3.5 px-4 gap-2">
          {p.attachments.map((a, i) => (
            <AttachmentChip
              key={i}
              att={a}
              onRemove={
                p.onRemoveAttachment && !a.uploading
                  ? () => p.onRemoveAttachment?.(i)
                  : undefined
              }
            />
          ))}
        </div>
      )}
      <div className="flex items-center justify-between h-14 shrink-0 pr-3 pl-4 border-t border-divider">
        <div className="flex items-center gap-1">
          <button
            onClick={p.onSend}
            disabled={p.sendDisabled}
            className="pressable flex items-center h-8 px-3 rounded-lg gap-2 bg-accent disabled:opacity-50"
            style={{ boxShadow: "0 1px 2px var(--send-shadow)" }}
          >
            <Send size={14} className="text-white [&_path]:stroke-white" />
            <div className="font-semibold text-white text-[13px]/4">Send</div>
            <div className="font-medium text-[#FFFFFFB8] text-[11px]/3.5">
              ⌘↵
            </div>
          </button>
          <div className="w-2 shrink-0" />
          <button
            aria-label="Formatting"
            onClick={p.onToggleFormat}
            className={clsx(
              "icon-btn w-7.5 h-7.5",
              p.formatOpen && "bg-hover-strong",
            )}
          >
            <TypeIcon />
          </button>
          <button
            aria-label="Attach files"
            onClick={p.onAttach}
            className="icon-btn w-7.5 h-7.5"
          >
            <PaperclipIcon size={16} strokeWidth={1.8} />
          </button>
          <button
            aria-label="Insert link"
            onClick={p.onInsertLink}
            className="icon-btn w-7.5 h-7.5"
          >
            <LinkIcon size={16} />
          </button>
          {p.onSchedule}
        </div>
        <button
          aria-label="Discard draft"
          onClick={p.onDiscard}
          className="icon-btn w-7.5 h-7.5 text-tertiary"
        >
          <Trash size={16} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
