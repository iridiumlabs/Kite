"use client";

import type { ReactNode } from "react";
import {
  Archive,
  Trash,
  Mail,
  Star,
  StarFilled,
  ChevronUp,
  ChevronDown,
  ReplyIcon,
  ReplyAllIcon,
  ForwardIcon,
} from "@/components/icons";
import { Avatar } from "./Avatar";
import { MessageBody } from "./MessageBody";
import { AttachmentCard } from "./AttachmentCard";
import type {
  AttachmentInfo,
  MessageContent,
  MessageItem,
} from "@/lib/ui/types";
import { formatListDate, formatMessageDate } from "@/lib/ui/dates";
import { senderDisplay } from "@/lib/ui/avatars";

export interface ReaderProps {
  subject: string;
  messageCount: number;
  accountEmail?: string;
  messages: MessageItem[];
  contentFor: (id: string) => MessageContent | undefined;
  expandedIds: Set<string>;
  onToggleMessage: (id: string) => void;
  // toolbar
  inTrash?: boolean;
  starred?: boolean;
  onArchive: () => void;
  onTrash: () => void;
  onTag: ReactNode;
  onSnooze: ReactNode;
  onMarkUnread: () => void;
  onStar: () => void;
  onMore: ReactNode;
  onPrevThread?: () => void;
  onNextThread?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
  // message actions
  onReply: (m: MessageItem) => void;
  onReplyAll: (m: MessageItem) => void;
  onForward: (m: MessageItem) => void;
  onDownloadAttachment: (m: MessageItem, a: AttachmentInfo) => void;
  onRetryContent?: (id: string) => void;
  onLoadRemote?: () => void;
  dark?: boolean;
  recipientSummary?: (m: MessageItem) => string;
  headerLeft?: ReactNode;
}

function ToolbarButton({
  label,
  onClick,
  children,
  disabled,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      data-disabled={disabled || undefined}
      className="icon-btn w-8 h-7"
    >
      {children}
    </button>
  );
}

const Sep = () => <div className="w-px h-4 shrink-0 bg-separator" />;

function CollapsedRow({
  message,
  onOpen,
}: {
  message: MessageItem;
  onOpen: () => void;
}) {
  return (
    <button
      onClick={onOpen}
      className="mail-row flex items-center h-13 gap-3 shrink-0 border-t border-divider w-full text-left"
    >
      <Avatar
        name={senderDisplay(message.from)}
        email={message.from.email}
        size={28}
        self={message.own}
      />
      <div className="shrink-0 w-24 font-semibold text-primary text-[13px]/4 line-clamp-1">
        {senderDisplay(message.from)}
      </div>
      <div className="grow basis-0 min-w-0 text-tertiary text-[13px]/4 line-clamp-1">
        {message.snippet}
      </div>
      <div className="tnum shrink-0 text-tertiary text-xs/4">
        {formatListDate(message.date)}
      </div>
    </button>
  );
}

function recipients(m: MessageItem, summary?: (m: MessageItem) => string) {
  if (summary) return summary(m);
  const names = m.to.map(senderDisplay);
  return names.length ? `to ${names.join(", ")}` : "";
}

function ExpandedMessage({
  message,
  content,
  dark,
  onReply,
  onReplyAll,
  onForward,
  onDownloadAttachment,
  onRetryContent,
  onLoadRemote,
  recipientSummary,
}: {
  message: MessageItem;
  content?: MessageContent;
  dark?: boolean;
  onReply: () => void;
  onReplyAll: () => void;
  onForward: () => void;
  onDownloadAttachment: (a: AttachmentInfo) => void;
  onRetryContent?: () => void;
  onLoadRemote?: () => void;
  recipientSummary?: (m: MessageItem) => string;
}) {
  const attachments = (content?.attachments ?? []).filter((a) => !a.inline);
  return (
    <div className="flex flex-col pt-5 gap-4.5 border-t border-divider">
      <div className="flex items-start gap-3">
        <Avatar
          name={senderDisplay(message.from)}
          email={message.from.email}
          size={36}
          self={message.own}
        />
        <div className="flex flex-col grow basis-0 pt-px gap-0.5 min-w-0">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <div className="font-semibold text-primary text-sm/4.5 line-clamp-1">
              {senderDisplay(message.from)}
            </div>
            <div className="text-tertiary text-[13px]/4 line-clamp-1">
              {message.from.email}
            </div>
          </div>
          <button
            className="flex items-center gap-1 w-max"
            aria-label="Message details"
          >
            <div className="text-tertiary text-xs/4 line-clamp-1">
              {recipients(message, recipientSummary)}
            </div>
            <ChevronDown size={10} className="text-quaternary" />
          </button>
        </div>
        <div className="flex items-center pt-0.5 gap-2.5 shrink-0">
          <div className="tnum text-tertiary text-xs/4">
            {formatMessageDate(message.date)}
          </div>
          <button
            aria-label="Reply"
            onClick={onReply}
            className="icon-btn text-tertiary"
          >
            <ReplyIcon size={15} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      {content?.remoteImagesBlocked ? (
        <div className="flex items-center pl-12 gap-2">
          <div className="text-tertiary text-xs/4">
            Remote images are hidden
          </div>
          <button
            onClick={onLoadRemote}
            className="text-accent text-xs/4 font-medium pressable"
          >
            Load images
          </button>
        </div>
      ) : null}
      <div className="flex flex-col max-w-175 pl-12">
        <MessageBody
          content={content}
          dark={dark}
          onRetry={onRetryContent}
        />
      </div>
      {attachments.length > 0 && (
        <div className="flex flex-wrap pl-12 gap-2">
          {attachments.map((a) => (
            <AttachmentCard
              key={a.id}
              attachment={a}
              onDownload={() => onDownloadAttachment(a)}
            />
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center pt-2.5 pl-12 gap-2 pb-1">
        <ActionButton icon={<ReplyIcon size={14} strokeWidth={1.9} />} kbd="R" onClick={onReply}>
          Reply
        </ActionButton>
        <ActionButton icon={<ReplyAllIcon />} kbd="A" onClick={onReplyAll}>
          Reply All
        </ActionButton>
        <ActionButton icon={<ForwardIcon />} kbd="F" onClick={onForward}>
          Forward
        </ActionButton>
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  kbd,
  onClick,
  children,
}: {
  icon: ReactNode;
  kbd?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className="pressable flex items-center h-7.5 px-2.5 rounded-lg gap-1.75 border border-[#0000001A] dark:border-[#FFFFFF1F]"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <span className="text-icon-strong inline-flex">{icon}</span>
      <div className="font-medium text-primary text-[13px]/4">{children}</div>
      {kbd && (
        <div className="pl-0.5 max-[767px]:hidden">
          <div className="font-medium text-quaternary text-[11px]/3.5">
            {kbd}
          </div>
        </div>
      )}
    </button>
  );
}

export function Reader(p: ReaderProps) {
  return (
    <div className="flex flex-col grow basis-0 h-full bg-app min-w-0">
      <div className="flex items-center justify-between h-13 shrink-0 px-12 max-[1200px]:px-6 max-[767px]:px-3">
        <div className="flex items-center gap-1">
          {p.headerLeft}
          <ToolbarButton label="Archive" onClick={p.onArchive}>
            <Archive strokeWidth={1.7} />
          </ToolbarButton>
          <ToolbarButton label="Trash" onClick={p.onTrash}>
            <Trash strokeWidth={1.7} />
          </ToolbarButton>
          <Sep />
          {p.onTag}
          {p.onSnooze}
          <ToolbarButton label="Mark as unread" onClick={p.onMarkUnread}>
            <Mail />
          </ToolbarButton>
        </div>
        <div className="flex items-center gap-1">
          <ToolbarButton
            label={p.starred ? "Unstar" : "Star"}
            onClick={p.onStar}
          >
            {p.starred ? <StarFilled /> : <Star />}
          </ToolbarButton>
          {p.onMore}
          <Sep />
          <button
            aria-label="Previous thread"
            onClick={p.onPrevThread}
            disabled={!p.hasPrev}
            data-disabled={!p.hasPrev || undefined}
            className="icon-btn size-7"
          >
            <ChevronUp />
          </button>
          <button
            aria-label="Next thread"
            onClick={p.onNextThread}
            disabled={!p.hasNext}
            data-disabled={!p.hasNext || undefined}
            className="icon-btn size-7"
          >
            <ChevronDown size={17} strokeWidth={1.8} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col pt-3.5 pb-10 px-14 max-[1200px]:px-8 max-[767px]:px-4">
          <div className="flex flex-col pb-5.5 gap-1.5">
            <h1 className="tracking-[-0.021em] font-bold text-primary text-[22px]/7">
              {p.subject}
            </h1>
            <div className="flex items-center gap-1.5">
              <div className="text-tertiary text-xs/4">
                {p.messageCount}{" "}
                {p.messageCount === 1 ? "message" : "messages"}
              </div>
              {p.accountEmail && (
                <>
                  <div className="text-tertiary text-xs/4">·</div>
                  <div className="text-tertiary text-xs/4">{p.accountEmail}</div>
                </>
              )}
            </div>
          </div>
          {p.messages.map((m) => {
            const expanded = p.expandedIds.has(m.id);
            return expanded ? (
              <ExpandedMessage
                key={m.id}
                message={m}
                content={p.contentFor(m.id)}
                dark={p.dark}
                onReply={() => p.onReply(m)}
                onReplyAll={() => p.onReplyAll(m)}
                onForward={() => p.onForward(m)}
                onDownloadAttachment={(a) => p.onDownloadAttachment(m, a)}
                onRetryContent={() => p.onRetryContent?.(m.id)}
                onLoadRemote={p.onLoadRemote}
                recipientSummary={p.recipientSummary}
              />
            ) : (
              <CollapsedRow
                key={m.id}
                message={m}
                onOpen={() => p.onToggleMessage(m.id)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
