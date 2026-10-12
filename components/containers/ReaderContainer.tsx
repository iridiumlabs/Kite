"use client";

import { expandedMessageIds, toggleMessageExpansion } from "@/lib/ui/messageExpansion";

import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Reader } from "@/components/mail/Reader";
import {
  TagPopover,
  SnoozePopover,
  MoreMenu,
} from "@/components/mail/ToolbarPopovers";
import { useUI } from "@/lib/ui/store";
import type {
  AttachmentInfo,
  CategoryInfo,
  MessageContent,
  MessageItem,
  ThreadItem,
} from "@/lib/ui/types";
import {
  getCached,
  setCached,
  markInflight,
  clearInflight,
  evictCached,
  subscribeContent,
  contentSnapshot,
  serverContentSnapshot,
} from "@/lib/ui/contentCache";
import { ArrowLeft } from "lucide-react";

function toMessageItem(m: Doc<"messages">): MessageItem {
  return {
    id: m._id,
    threadId: m.threadId,
    from: m.from,
    to: m.to,
    cc: m.cc,
    subject: m.subject,
    date: m.date,
    snippet: m.snippet,
    unread: !m.seen,
    own: m.isOutbound,
  };
}

export function ReaderContainer({
  threadId,
  categories,
  threads,
  onClose,
  onNavigateThread,
  mobileBack,
  dark,
}: {
  threadId: Id<"threads">;
  categories: CategoryInfo[];
  threads: ThreadItem[];
  onClose: () => void;
  onNavigateThread: (id: string) => void;
  mobileBack?: () => void;
  dark?: boolean;
}) {
  const data = useQuery(api.mail.getThread, { threadId });
  const getContent = useAction(api.content.getMessageContent);
  const settings = useQuery(api.settings.get, {});
  const loadRemoteImages = settings?.loadRemoteImages ?? false;
  const setRead = useMutation(api.mail.setRead);
  const setStarred = useMutation(api.mail.setStarred);
  const archive = useMutation(api.mail.archive);
  const trash = useMutation(api.mail.trash);
  const restore = useMutation(api.mail.restore);
  const moveToInbox = useMutation(api.mail.moveToInbox);
  const snooze = useMutation(api.mail.snooze);
  const deleteForever = useMutation(api.mail.deleteForever);
  const assignCategories = useMutation(api.mail.assignCategories);
  const openCompose = useUI((s) => s.openCompose);

  const messages = useMemo(
    () => (data?.messages ?? []).map(toMessageItem),
    [data],
  );

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());
  const [extraIds, setExtraIds] = useState<Set<string>>(new Set());
  const contentVersion = useSyncExternalStore(subscribeContent, contentSnapshot, serverContentSnapshot);
  const [remoteImageIds, setRemoteImageIds] = useState<Set<string>>(new Set());
  const [now] = useState(() => Date.now());

  // reset per-thread expansion state when the thread changes
  const [prevThread, setPrevThread] = useState(threadId);
  if (prevThread !== threadId) {
    setPrevThread(threadId);
    setCollapsedIds(new Set());
    setExtraIds(new Set());
    setRemoteImageIds(new Set());
  }

  // default expansion: latest + all unread
  const defaultExpanded = useMemo(() => {
    const s = new Set<string>();
    for (const m of data?.messages ?? []) {
      if (!m.seen) s.add(m._id);
    }
    const last = data?.messages?.[data.messages.length - 1];
    if (last) s.add(last._id);
    return s;
  }, [data]);

  const expandedIds = useMemo(
    () => expandedMessageIds(defaultExpanded, collapsedIds, extraIds),
    [defaultExpanded, collapsedIds, extraIds],
  );

  const onToggleMessage = useCallback((id: string) => {
    const next = toggleMessageExpansion(id, expandedIds, collapsedIds, extraIds);
    setCollapsedIds(next.collapsed);
    setExtraIds(next.extra);
  }, [expandedIds, collapsedIds, extraIds]);

  // mark read on open
  const marked = useRef<string | null>(null);
  useEffect(() => {
    if (!data || marked.current === threadId) return;
    if (data.messages.some((m) => !m.seen)) {
      marked.current = threadId;
      void setRead({ threadIds: [threadId], read: true });
    }
  }, [data, threadId, setRead]);

  // load content for expanded messages (async fetch, cached in module LRU).
  // Fetches are capped at ~20s: on timeout or failure the message renders an
  // inline error with Retry instead of a permanent skeleton.
  useEffect(() => {
    for (const m of messages) {
      if (!expandedIds.has(m.id)) continue;
      const allowRemote = loadRemoteImages || remoteImageIds.has(m.id);
      if (getCached(m.id, allowRemote)) continue;
      if (!markInflight(m.id, allowRemote)) continue;
      let timer: ReturnType<typeof setTimeout>;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Timed out while loading this message.")),
          20_000,
        );
      });
      Promise.race([
        getContent({
          messageId: m.id as Id<"messages">,
          loadRemoteImages: allowRemote,
        }),
        timeout,
      ])
        .then((res) => {
          setCached(m.id, res as MessageContent, allowRemote);
        })
        .catch((e) => {
          const msg =
            e instanceof Error && /moved/i.test(e.message)
              ? "This message moved. Refreshing the mailbox, try again shortly."
              : e instanceof Error && /timed out/i.test(e.message)
                ? e.message
                : "This message could not be loaded.";
          setCached(m.id, { error: msg }, allowRemote);
        })
        .finally(() => {
          clearTimeout(timer);
          clearInflight(m.id, allowRemote);
        });
    }
  }, [expandedIds, messages, getContent, contentVersion, remoteImageIds, loadRemoteImages]);

  const onRetryContent = useCallback((id: string) => {
    evictCached(id);
  }, []);

  // prefetch latest message content of neighbors
  const idx = threads.findIndex((t) => t.id === threadId);
  const prevId = idx > 0 ? threads[idx - 1].id : undefined;
  const nextId =
    idx >= 0 && idx + 1 < threads.length ? threads[idx + 1].id : undefined;

  const thread = data?.thread;
  const inTrash = thread?.location === "trash";
  const snoozed =
    thread?.snoozedUntil !== undefined && thread.snoozedUntil > now;

  const undoToast = useCallback(
    (label: string, undo: () => void) => {
      toast(label, { action: { label: "Undo", onClick: undo } });
      useUI.getState().setLastAction(undo);
    },
    [],
  );

  const onArchive = useCallback(() => {
    void archive({ threadIds: [threadId] });
    undoToast("Archived", () => void restore({ threadIds: [threadId] }));
    onClose();
  }, [archive, restore, threadId, undoToast, onClose]);

  const onTrash = useCallback(() => {
    void trash({ threadIds: [threadId] });
    const targetRole = data?.thread.location === "archive" ? "archive" : "inbox";
    undoToast("Moved to Trash", () => void restore({ threadIds: [threadId], targetRole }));
    onClose();
  }, [trash, restore, threadId, undoToast, onClose, data?.thread.location]);

  const onMarkUnread = useCallback(() => {
    void setRead({ threadIds: [threadId], read: false });
    onClose();
  }, [setRead, threadId, onClose]);

  const onStar = useCallback(() => {
    void setStarred({
      threadIds: [threadId],
      starred: !thread?.starred,
    });
  }, [setStarred, threadId, thread]);

  const onSnooze = useCallback(
    (until: number) => {
      void snooze({ threadIds: [threadId], until });
      undoToast("Snoozed", () =>
        void snooze({ threadIds: [threadId], until: null }),
      );
      onClose();
    },
    [snooze, threadId, undoToast, onClose],
  );

  const onMoveToInbox = useCallback(
    (inbox: "primary" | "other") => {
      void moveToInbox({ threadIds: [threadId], inbox });
    },
    [moveToInbox, threadId],
  );

  const onToggleCategory = useCallback(
    (catId: string) => {
      const current = new Set(thread?.categoryIds ?? []);
      const add = !current.has(catId as Id<"categories">);
      void assignCategories({
        threadIds: [threadId],
        add: add ? [catId as Id<"categories">] : undefined,
        remove: add ? undefined : [catId as Id<"categories">],
      });
    },
    [assignCategories, threadId, thread],
  );

  const latest = messages[messages.length - 1];

  const onReply = useCallback(
    (m: MessageItem) =>
      openCompose({
        mode: "reply",
        replyToMessageId: m.id,
        threadId,
      }),
    [openCompose, threadId],
  );
  const onReplyAll = useCallback(
    (m: MessageItem) =>
      openCompose({
        mode: "replyAll",
        replyToMessageId: m.id,
        threadId,
      }),
    [openCompose, threadId],
  );
  const onForward = useCallback(
    (m: MessageItem) =>
      openCompose({
        mode: "forward",
        replyToMessageId: m.id,
        threadId,
      }),
    [openCompose, threadId],
  );

  // keyboard reply shortcuts dispatched from MailApp
  useEffect(() => {
    const r = () => latest && onReply(latest);
    const ra = () => latest && onReplyAll(latest);
    const f = () => latest && onForward(latest);
    window.addEventListener("kite:reply", r);
    window.addEventListener("kite:replyAll", ra);
    window.addEventListener("kite:forward", f);
    return () => {
      window.removeEventListener("kite:reply", r);
      window.removeEventListener("kite:replyAll", ra);
      window.removeEventListener("kite:forward", f);
    };
  }, [latest, onReply, onReplyAll, onForward]);

  const onDownloadAttachment = useCallback(
    (m: MessageItem, a: AttachmentInfo) => {
      const url = `/api/attachments/${m.id}/${encodeURIComponent(a.id)}`;
      const link = document.createElement("a");
      link.href = url;
      link.download = a.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    },
    [],
  );

  const contentFor = useCallback(
    (id: string): MessageContent | undefined => {
      void contentVersion;
      return getCached(id, loadRemoteImages || remoteImageIds.has(id));
    },
    [contentVersion, loadRemoteImages, remoteImageIds],
  );

  if (data === undefined) {
    return (
      <div className="flex flex-col grow basis-0 h-full bg-app min-w-0">
        <div className="h-13 border-b border-divider" />
        <div className="flex flex-col pt-8 px-14 gap-4">
          <div className="skeleton h-7 w-2/3" />
          <div className="skeleton h-4 w-1/3" />
          <div className="skeleton h-4 w-full mt-6" />
          <div className="skeleton h-4 w-11/12" />
          <div className="skeleton h-4 w-4/5" />
        </div>
      </div>
    );
  }
  if (data === null || !data.thread) {
    return (
      <div className="flex flex-col items-center justify-center grow gap-3 bg-app">
        <div className="font-semibold text-primary text-[15px]/4.5">
          Thread not found
        </div>
        <div className="text-tertiary text-[13px]/4">
          It may have moved or been deleted.
        </div>
        <button
          onClick={onClose}
          className="pressable h-8 px-3 rounded-lg bg-accent text-white font-semibold text-[13px]/4"
        >
          Back to list
        </button>
      </div>
    );
  }

  return (
    <Reader
      subject={data.thread.subject}
      messageCount={messages.length}
      accountEmail={
        thread?.accountId
          ? undefined
          : undefined
      }
      messages={messages}
      contentFor={contentFor}
      expandedIds={expandedIds}
      onToggleMessage={onToggleMessage}
      inTrash={inTrash}
      starred={data.thread.starred}
      onArchive={onArchive}
      onTrash={onTrash}
      onTag={
        <TagPopover
          inbox={data.thread.inbox}
          categories={categories}
          assignedIds={new Set(data.thread.categoryIds)}
          onMoveToInbox={onMoveToInbox}
          onToggleCategory={onToggleCategory}
          onNewCategory={() => useUI.getState().openSettings("categories")}
        />
      }
      onSnooze={
        <SnoozePopover
          snoozed={snoozed}
          onSnooze={onSnooze}
          onUnsnooze={() =>
            void snooze({ threadIds: [threadId], until: null })
          }
        />
      }
      onMarkUnread={onMarkUnread}
      onStar={onStar}
      onMore={
        <MoreMenu
          inTrash={inTrash}
          onReply={() => latest && onReply(latest)}
          onReplyAll={() => latest && onReplyAll(latest)}
          onForward={() => latest && onForward(latest)}
          onMoveToInbox={onMoveToInbox}
          onMarkUnread={onMarkUnread}
          onDeleteForever={
            inTrash
              ? () => {
                  void deleteForever({ threadIds: [threadId] });
                  onClose();
                }
              : undefined
          }
        />
      }
      onPrevThread={prevId ? () => onNavigateThread(prevId) : undefined}
      onNextThread={nextId ? () => onNavigateThread(nextId) : undefined}
      hasPrev={!!prevId}
      hasNext={!!nextId}
      onReply={onReply}
      onReplyAll={onReplyAll}
      onForward={onForward}
      onDownloadAttachment={onDownloadAttachment}
      onRetryContent={onRetryContent}
      onLoadRemote={(id) => {
        setRemoteImageIds(previous => new Set(previous).add(id));
        evictCached(id);
      }}
      dark={dark}
      recipientSummary={(m) => {
        const names = m.to.map((t) => t.name ?? t.email);
        return names.length ? `to ${names.join(", ")}` : "";
      }}
      headerLeft={
        mobileBack ? (
          <button
            aria-label="Back"
            onClick={mobileBack}
            className="icon-btn w-8 h-7"
          >
            <ArrowLeft size={17} strokeWidth={1.7} />
          </button>
        ) : undefined
      }
    />
  );
}
