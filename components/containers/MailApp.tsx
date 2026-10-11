"use client";

import {
  useAction,
  useMutation,
  usePaginatedQuery,
  useQuery,
} from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useParams, useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { Sidebar } from "@/components/mail/Sidebar";
import { ListHeader } from "@/components/mail/ListHeader";
import { ThreadList } from "@/components/mail/ThreadList";
import { CommandPalette } from "@/components/mail/CommandPalette";
import { useUI, type SettingsTab } from "@/lib/ui/store";
import { useAppUser, DEV_AUTH } from "@/components/providers";
import { useMediaQuery } from "@/lib/ui/useMediaQuery";
import type {
  AccountInfo,
  CategoryInfo,
  ThreadItem,
  ViewKind,
} from "@/lib/ui/types";
import { VIEW_LABELS } from "@/lib/ui/types";
import { patchThreads, removeThreads } from "@/lib/ui/optimistic";
import { ReaderContainer } from "./ReaderContainer";
import { ComposeLayer } from "./ComposeLayer";
import { SettingsHost } from "./SettingsHost";
import { ConnectAccountDialog } from "@/components/settings/ConnectAccountDialog";
import { CategoryDialog } from "@/components/settings/CategoryDialog";
import { useMailShortcuts } from "@/lib/ui/useShortcuts";
import { PanelLeft } from "lucide-react";
import { Dialog } from "@base-ui/react/dialog";
import { SignOutListener } from "@/components/SignOutListener";

const THREAD_VIEWS = new Set([
  "primary",
  "other",
  "archive",
  "trash",
  "snoozed",
  "starred",
  "account",
  "category",
]);

function parseSlug(slug?: string[]): {
  view: ViewKind;
  viewId?: string;
  threadId?: string;
} {
  if (!slug || slug.length === 0) return { view: "primary" };
  const tIdx = slug.indexOf("t");
  const threadId =
    tIdx >= 0 && slug[tIdx + 1] ? (slug[tIdx + 1] as Id<"threads">) : undefined;
  const head = slug[0];
  if (head === "category" || head === "account") {
    return { view: head, viewId: slug[1], threadId };
  }
  if (
    [
      "primary",
      "other",
      "sent",
      "drafts",
      "archive",
      "trash",
      "snoozed",
      "starred",
    ].includes(head)
  ) {
    return { view: head as ViewKind, threadId };
  }
  return { view: "primary" };
}

function viewPath(view: ViewKind, viewId?: string): string {
  if (view === "category" || view === "account") {
    return `/mail/${view}/${viewId}`;
  }
  return `/mail/${view}`;
}

function toAccountInfo(a: Doc<"accounts">, unread?: number): AccountInfo {
  return {
    id: a._id,
    email: a.email,
    displayName: a.displayName,
    status: a.status,
    lastError: a.lastError,
    unread,
    syncing: (!a.initialSyncDone || a.status === "syncing") && a.status !== "error" && a.status !== "auth_error",
  };
}

function toThreadItem(
  t: Doc<"threads"> & {
    categories?: { _id: string; name: string; color: string }[];
  },
): ThreadItem {
  return {
    id: t._id,
    subject: t.subject,
    participants: t.participants,
    snippet: t.snippet,
    lastMessageAt: t.lastMessageAt,
    messageCount: t.messageCount,
    unread: t.unread,
    unreadCount: t.unreadCount,
    starred: t.starred,
    hasAttachments: t.hasAttachments,
    categories: t.categories?.map((c) => ({
      id: c._id,
      name: c.name,
      color: c.color,
    })),
  };
}

export function MailApp() {
  const params = useParams<{ slug?: string[] }>();
  const router = useRouter();
  const { view, viewId, threadId } = parseSlug(params.slug);
  const { theme, setTheme, resolvedTheme } = useTheme();
  const appUser = useAppUser();
  const ui = useUI();
  const isNarrow = useMediaQuery("(max-width: 1099px)");
  const isMobile = useMediaQuery("(max-width: 767px)");

  // ---- data ----
  const accounts = useQuery(api.accounts.list, {});
  const categories = useQuery(api.categories.list, {});
  const counts = useQuery(api.mail.counts, {});
  const settings = useQuery(api.settings.get, {});

  const filterArgs = useMemo(() => {
    if (ui.filter === "all") return undefined;
    return {
      unread: ui.filter === "unread" ? true : undefined,
      starred: ui.filter === "starred" ? true : undefined,
      hasAttachments: ui.filter === "attachments" ? true : undefined,
    };
  }, [ui.filter]);

  const isThreadView = THREAD_VIEWS.has(view);
  const listArgs = useMemo(
    () => ({
      view: (view === "account" || view === "category" ? view : view) as never,
      accountId:
        view === "account" ? (viewId as Id<"accounts">) : undefined,
      categoryId:
        view === "category" ? (viewId as Id<"categories">) : undefined,
      filter: filterArgs,
    }),
    [view, viewId, filterArgs],
  );

  const threadsQuery = usePaginatedQuery(
    api.mail.listThreads,
    isThreadView ? (listArgs as never) : "skip",
    { initialNumItems: 50 },
  );
  const sentQuery = usePaginatedQuery(
    api.mail.listMessagesByRole,
    view === "sent" ? { role: "sent" } : "skip",
    { initialNumItems: 50 },
  );
  const draftsQuery = usePaginatedQuery(
    api.drafts.list,
    view === "drafts" ? {} : "skip",
    { initialNumItems: 50 },
  );

  // ---- mutations ----
  const setRead = useMutation(api.mail.setRead).withOptimisticUpdate(
    (store, args) => {
      patchThreads(store, args.threadIds ?? [], args.read
        ? { unread: false, unreadCount: 0 }
        : { unread: true, unreadCount: 1 });
    },
  );
  const setStarred = useMutation(api.mail.setStarred).withOptimisticUpdate(
    (store, args) => {
      patchThreads(store, args.threadIds ?? [], { starred: args.starred });
    },
  );
  const archive = useMutation(api.mail.archive).withOptimisticUpdate(
    (store, args) => {
      removeThreads(store, args.threadIds ?? []);
    },
  );
  const trash = useMutation(api.mail.trash).withOptimisticUpdate(
    (store, args) => {
      removeThreads(store, args.threadIds ?? []);
    },
  );
  const restore = useMutation(api.mail.restore).withOptimisticUpdate(
    (store, args) => {
      removeThreads(store, args.threadIds ?? []);
    },
  );
  const snooze = useMutation(api.mail.snooze).withOptimisticUpdate(
    (store, args) => {
      removeThreads(store, args.threadIds ?? []);
    },
  );
  const syncNow = useMutation(api.accounts.syncNow);
  const loadOlder = useAction(api.mail.loadOlder);
  const deepSearch = useAction(api.mail.deepSearch);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [serverResults, setServerResults] = useState<ThreadItem[]>([]);
  const searchQuery = useQuery(
    api.mail.search,
    paletteQuery ? { query: paletteQuery } : "skip",
  );

  // ---- undo bookkeeping ----
  const threadMeta = useRef(
    new Map<string, { listKey: string; accountId: string; inbox: string }>(),
  );

  // ---- derived data ----
  const accountInfos = useMemo(
    () =>
      (accounts ?? []).map((a) =>
        toAccountInfo(a, counts?.[`unread:acct:${a._id}`]),
      ),
    [accounts, counts],
  );
  const categoryInfos: CategoryInfo[] = useMemo(
    () =>
      (categories ?? []).map((c) => ({
        id: c._id,
        name: c.name,
        color: c.color,
        description: c.description,
        unread: counts?.[`unread:cat:${c._id}`],
      })),
    [categories, counts],
  );

  const threads: ThreadItem[] = useMemo(() => {
    if (view === "sent") {
      const sentThreads = new Map<string, ThreadItem>();
      for (const m of sentQuery.results ?? []) {
        const existing = sentThreads.get(m.threadId);
        if (existing) {
          existing.messageCount++;
          existing.hasAttachments ||= m.hasAttachments;
        } else {
          sentThreads.set(m.threadId, {
            id: m.threadId, subject: m.subject,
            participants: m.to.length ? m.to : [m.from], snippet: m.snippet,
            lastMessageAt: m.date, messageCount: 1, unread: false,
            hasAttachments: m.hasAttachments,
          });
        }
      }
      return [...sentThreads.values()];
    }
    if (view === "drafts") {
      return (draftsQuery.results ?? []).map((d) => ({
        id: d._id as string,
        subject: d.subject || "(no subject)",
        participants: d.to.length
          ? d.to
          : [{ name: "No recipient", email: "" }],
        snippet: d.text.slice(0, 120),
        lastMessageAt: d.updatedAt,
        messageCount: 1,
        unread: false,
        hasAttachments: d.attachments.length > 0,
      }));
    }
    return (threadsQuery.results ?? []).map(toThreadItem);
  }, [view, sentQuery.results, draftsQuery.results, threadsQuery.results]);

  // keep thread meta for undo/counters
  useEffect(() => {
    for (const t of threadsQuery.results ?? []) {
      threadMeta.current.set(t._id, {
        listKey: t.listKey,
        accountId: t.accountId,
        inbox: t.inbox,
      });
    }
  }, [threadsQuery.results]);

  const listLoading =
    (isThreadView && threadsQuery.status === "LoadingFirstPage") ||
    (view === "sent" && sentQuery.status === "LoadingFirstPage") ||
    (view === "drafts" && draftsQuery.status === "LoadingFirstPage");
  const listDone =
    (isThreadView && threadsQuery.status === "Exhausted") ||
    (view === "sent" && sentQuery.status === "Exhausted") ||
    (view === "drafts" && draftsQuery.status === "Exhausted");
  const loadMore = isThreadView
    ? threadsQuery.loadMore
    : view === "sent"
      ? sentQuery.loadMore
      : draftsQuery.loadMore;
  // Backfill only on demand and only for the current view. Pending folders
  // mean older mail exists, not that a request is running.
  const olderArgs = useMemo(() => ({
    accountId: view === "account" ? viewId as Id<"accounts"> : undefined,
    includeJunk: view === "other" || view === "category",
    role: view === "sent" ? "sent" as const
      : view === "archive" ? "archive" as const
      : view === "trash" ? "trash" as const
      : view === "account" || view === "starred" ? undefined : "inbox" as const,
  }), [view, viewId]);
  const backfill = useQuery(api.mail.backfillStatus, view === "drafts" ? "skip" : olderArgs);
  const backfillPending = (backfill?.pending ?? 0) > 0;
  const [olderInFlight, setOlderInFlight] = useState(false);
  const requestOlder = async () => {
    if (olderInFlight) return;
    setOlderInFlight(true);
    try {
      const result = await loadOlder(olderArgs);
      if (!result.scheduled) toast("Mailbox is busy. Try loading older mail again.");
    }
    catch { toast.error("Older mail could not be loaded. Try again."); }
    finally { setOlderInFlight(false); }
  };

  // window focus -> sync, throttled 60s
  const lastSync = useRef(0);
  useEffect(() => {
    const onFocus = () => {
      if (Date.now() - lastSync.current < 60_000) return;
      lastSync.current = Date.now();
      void syncNow({}).catch(() => {});
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [syncNow]);

  // document title
  const primaryUnread = counts?.["unread:primary"] ?? 0;
  useEffect(() => {
    document.title = primaryUnread > 0 ? `(${primaryUnread}) Post` : "Post";
  }, [primaryUnread]);

  // apply stored theme once
  const themeApplied = useRef(false);
  useEffect(() => {
    if (themeApplied.current || settings === undefined) return;
    themeApplied.current = true;
    if (settings.theme && settings.theme !== theme) setTheme(settings.theme);
  }, [settings, theme, setTheme]);

  // ---- navigation ----
  const navigate = useCallback(
    (v: ViewKind, id?: string) => {
      router.push(viewPath(v, id));
      ui.setSidebarOpen(false);
    },
    [router, ui],
  );

  const openThread = useCallback(
    (t: ThreadItem) => {
      if (view === "drafts") {
        ui.openCompose({ mode: "draft", draftId: t.id });
        return;
      }
      router.push(`${viewPath(view, viewId)}/t/${t.id}`);
    },
    [router, view, viewId, ui],
  );

  const closeThread = useCallback(() => {
    router.push(viewPath(view, viewId));
  }, [router, view, viewId]);

  // ---- actions with undo ----
  const undoable = useCallback(
    (label: string, undo: () => void) => {
      toast(label, {
        action: {
          label: "Undo",
          onClick: () => undo(),
        },
      });
      useUI.getState().setLastAction(undo);
    },
    [],
  );

  const doArchive = useCallback(
    (t: ThreadItem) => {
      void archive({ threadIds: [t.id as Id<"threads">] });
      undoable("Archived", () => {
        void restore({ threadIds: [t.id as Id<"threads">] });
      });
      if (threadId === t.id) closeThread();
    },
    [archive, restore, undoable, threadId, closeThread],
  );

  const doTrash = useCallback(
    (t: ThreadItem) => {
      void trash({ threadIds: [t.id as Id<"threads">] });
      undoable("Moved to Trash", () => {
        void restore({ threadIds: [t.id as Id<"threads">] });
      });
      if (threadId === t.id) closeThread();
    },
    [trash, restore, undoable, threadId, closeThread],
  );

  const doToggleRead = useCallback(
    (t: ThreadItem) => {
      void setRead({
        threadIds: [t.id as Id<"threads">],
        read: t.unread,
      });
    },
    [setRead],
  );

  const doSnooze = useCallback(
    (t: ThreadItem, until?: number) => {
      const at = until ?? Date.now() + 4 * 3600_000;
      void snooze({ threadIds: [t.id as Id<"threads">], until: at });
      undoable("Snoozed", () => {
        void snooze({ threadIds: [t.id as Id<"threads">], until: null });
      });
    },
    [snooze, undoable],
  );

  const doStar = useCallback(
    (t: ThreadItem) => {
      void setStarred({
        threadIds: [t.id as Id<"threads">],
        starred: !t.starred,
      });
    },
    [setStarred],
  );

  // keyboard navigation state
  const ids = threads.map((t) => t.id);
  const focusedId = ui.focusedThreadId;
  const focusAt = useCallback(
    (dir: 1 | -1) => {
      if (ids.length === 0) return;
      const idx = focusedId ? ids.indexOf(focusedId) : -1;
      const next = idx + dir;
      if (next < 0 || next >= ids.length) return;
      ui.setFocusedThreadId(ids[next]);
    },
    [ids, focusedId, ui],
  );

  const focusedThread = threads.find((t) => t.id === focusedId);

  useMailShortcuts({
    onNext: () => {
      if (threadId) {
        // navigate threads in reader
        const idx = ids.indexOf(threadId);
        if (idx >= 0 && idx + 1 < ids.length) {
          router.push(`${viewPath(view, viewId)}/t/${ids[idx + 1]}`);
        }
      } else {
        focusAt(1);
      }
    },
    onPrev: () => {
      if (threadId) {
        const idx = ids.indexOf(threadId);
        if (idx > 0) {
          router.push(`${viewPath(view, viewId)}/t/${ids[idx - 1]}`);
        }
      } else {
        focusAt(-1);
      }
    },
    onOpen: () => {
      if (focusedThread) openThread(focusedThread);
    },
    onClose: () => {
      if (ui.paletteOpen) ui.setPaletteOpen(false);
      else if (ui.settingsOpen) ui.closeSettings();
      else if (threadId) closeThread();
    },
    onArchive: () => {
      const t = threadId ? threads.find((x) => x.id === threadId) : focusedThread;
      if (t) doArchive(t);
      else if (threadId) {
        void archive({ threadIds: [threadId as Id<"threads">] });
        closeThread();
      }
    },
    onTrash: () => {
      const t = threadId ? threads.find((x) => x.id === threadId) : focusedThread;
      if (t) doTrash(t);
    },
    onStar: () => {
      const t = threadId ? threads.find((x) => x.id === threadId) : focusedThread;
      if (t) doStar(t);
    },
    onToggleRead: () => {
      const t = threadId ? threads.find((x) => x.id === threadId) : focusedThread;
      if (t) doToggleRead(t);
    },
    onReply: () => {
      // handled inside reader; opens compose for latest message
      const ev = new CustomEvent("post:reply");
      window.dispatchEvent(ev);
    },
    onReplyAll: () => {
      window.dispatchEvent(new CustomEvent("post:replyAll"));
    },
    onForward: () => {
      window.dispatchEvent(new CustomEvent("post:forward"));
    },
    onCompose: () => ui.openCompose({ mode: "new" }),
    onSearch: () => ui.setPaletteOpen(true),
    onSettings: () => ui.openSettings(),
    onHelp: () => ui.setShortcutHelpOpen(true),
    onUndo: () => {
      const fn = useUI.getState().lastAction;
      if (fn) {
        fn();
        useUI.getState().setLastAction(null);
      }
    },
    onGo: (key) => {
      const map: Record<string, ViewKind> = {
        p: "primary",
        o: "other",
        s: "sent",
        d: "drafts",
        a: "archive",
        t: "trash",
        z: "snoozed",
        "*": "starred",
      };
      if (map[key]) navigate(map[key]);
    },
  });

  const paletteResults: ThreadItem[] = useMemo(() => {
    if (!paletteQuery) return [];
    if (serverResults.length) return serverResults;
    const seen = new Set<string>();
    const out: ThreadItem[] = [];
    for (const m of searchQuery ?? []) {
      if (seen.has(m.threadId)) continue;
      seen.add(m.threadId);
      out.push({
        id: m.threadId,
        subject: m.subject,
        participants: [m.from],
        snippet: m.snippet,
        lastMessageAt: m.date,
        messageCount: 1,
        unread: !m.seen,
        hasAttachments: m.hasAttachments,
      });
    }
    return out;
  }, [paletteQuery, searchQuery, serverResults]);

  const runServerSearch = useCallback(async () => {
    if (!paletteQuery) return;
    try {
      const docs = (await deepSearch({
        query: paletteQuery,
      })) as Doc<"messages">[];
      const seen = new Set<string>();
      setServerResults(
        docs
          .filter((m) => !seen.has(m.threadId) && seen.add(m.threadId))
          .map((m) => ({
            id: m.threadId,
            subject: m.subject,
            participants: [m.from],
            snippet: m.snippet,
            lastMessageAt: m.date,
            messageCount: 1,
            unread: !m.seen,
            hasAttachments: m.hasAttachments,
          })),
      );
    } catch {
      toast.error("Server search failed");
    }
  }, [paletteQuery, deepSearch]);

  const commands = useMemo(
    () => [
      {
        id: "compose",
        label: "Compose new message",
        hint: "C",
        onSelect: () => {
          ui.setPaletteOpen(false);
          ui.openCompose({ mode: "new" });
        },
      },
      ...(
        [
          "primary",
          "other",
          "sent",
          "drafts",
          "archive",
          "trash",
          "snoozed",
          "starred",
        ] as const
      ).map((v) => ({
        id: `go-${v}`,
        label: `Go to ${VIEW_LABELS[v]}`,
        onSelect: () => {
          ui.setPaletteOpen(false);
          navigate(v);
        },
      })),
      ...categoryInfos.map((c) => ({
        id: `go-cat-${c.id}`,
        label: `Go to ${c.name}`,
        onSelect: () => {
          ui.setPaletteOpen(false);
          navigate("category", c.id);
        },
      })),
      ...accountInfos.map((a) => ({
        id: `go-acct-${a.id}`,
        label: `Go to ${a.email}`,
        onSelect: () => {
          ui.setPaletteOpen(false);
          navigate("account", a.id);
        },
      })),
      {
        id: "settings",
        label: "Settings",
        hint: "⌘,",
        onSelect: () => {
          ui.setPaletteOpen(false);
          ui.openSettings();
        },
      },
      {
        id: "sync",
        label: "Sync now",
        onSelect: () => {
          ui.setPaletteOpen(false);
          void syncNow({});
          toast("Syncing mailboxes");
        },
      },
      {
        id: "theme-dark",
        label: "Switch to dark theme",
        onSelect: () => {
          ui.setPaletteOpen(false);
          setTheme("dark");
        },
      },
      {
        id: "theme-light",
        label: "Switch to light theme",
        onSelect: () => {
          ui.setPaletteOpen(false);
          setTheme("light");
        },
      },
    ],
    [ui, navigate, categoryInfos, accountInfos, syncNow, setTheme],
  );

  // ---- empty states ----
  const noAccounts = accounts !== undefined && accounts.length === 0;
  const loading = accounts === undefined || categories === undefined;

  // dialog state
  const [connectOpen, setConnectOpen] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState<
    | { mode: "create" }
    | { mode: "edit"; category: CategoryInfo }
    | null
  >(null);

  // sidebar section collapse, persisted
  const [collapsed, setCollapsed] = useState(() => {
    try {
      if (typeof localStorage === "undefined") {
        return { categories: false, accounts: false };
      }
      const raw = localStorage.getItem("post.sidebar");
      if (raw) return JSON.parse(raw);
    } catch {}
    return { categories: false, accounts: false };
  });
  const toggleSection = useCallback(
    (section: "categories" | "accounts") => {
      setCollapsed((prev: { categories: boolean; accounts: boolean }) => {
        const next = { ...prev, [section]: !prev[section] };
        try {
          localStorage.setItem("post.sidebar", JSON.stringify(next));
        } catch {}
        return next;
      });
    },
    [],
  );

  const user = appUser ?? { name: "Account", initial: "A" };

  const sidebarEl = (
    <Sidebar
      user={{
        name: user.name,
        initial: user.initial,
        accountsConnected: accountInfos.length,
      }}
      profile={{
        theme: theme ?? "system",
        onOpenSettings: (tab) => ui.openSettings(tab as SettingsTab),
        onSetTheme: setTheme,
        onSignOut: () => {
          if (DEV_AUTH) {
            toast("Sign out is disabled in dev mode");
          } else {
            window.dispatchEvent(new Event("post:signout"));
          }
        },
      }}
      view={view}
      viewId={viewId}
      counts={{
        primaryUnread: counts?.["unread:primary"] ?? 0,
        otherUnread: counts?.["unread:other"] ?? 0,
        drafts: counts?.["drafts"] ?? 0,
      }}
      categories={categoryInfos}
      accounts={accountInfos}
      collapsed={collapsed}
      onNavigate={navigate}
      onCompose={() => ui.openCompose({ mode: "new" })}
      onToggleSection={toggleSection}
      onAddCategory={() => setCategoryDialog({ mode: "create" })}
      onEditCategory={(id) => {
        const c = categoryInfos.find((x) => x.id === id);
        if (c) setCategoryDialog({ mode: "edit", category: c });
      }}
      onAddAccount={() => setConnectOpen(true)}
      onReconnectAccount={() => setConnectOpen(true)}
    />
  );

  const listHeaderTitle = (() => {
    if (view === "category") {
      return categoryInfos.find((c) => c.id === viewId)?.name ?? "Category";
    }
    if (view === "account") {
      return (
        accountInfos.find((a) => a.id === viewId)?.email ?? "Account"
      );
    }
    return VIEW_LABELS[view] ?? "Mail";
  })();

  const listUnread =
    view === "primary"
      ? (counts?.["unread:primary"] ?? 0)
      : view === "other"
        ? (counts?.["unread:other"] ?? 0)
        : view === "category"
          ? (counts?.[`unread:cat:${viewId}`] ?? 0)
          : view === "account"
            ? (counts?.[`unread:acct:${viewId}`] ?? 0)
            : undefined;

  const rowActions = {
    onArchive: doArchive,
    onTrash: doTrash,
    onSnooze: (t: ThreadItem) => doSnooze(t),
    onToggleRead: doToggleRead,
  };

  const loadingRows = (
    <div className="flex flex-col pb-6 px-4">
      <div className="pl-8 py-1.5">
        <div className="skeleton h-4 w-14" />
      </div>
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center h-11 pr-3.5 pl-2.5 gap-3 shrink-0"
        >
          <div className="w-2.5 shrink-0" />
          <div className="skeleton h-3.5 w-45 shrink-0" />
          <div className="skeleton h-3.5 grow" />
          <div className="skeleton h-3.5 w-16 shrink-0" />
        </div>
      ))}
    </div>
  );

  const emptyState = (
    <div className="flex flex-col items-center justify-center grow gap-3 py-20">
      <div className="font-semibold text-primary text-[15px]/4.5">
        {view === "primary" || view === "other"
          ? "You're all caught up"
          : `Nothing in ${VIEW_LABELS[view]?.toLowerCase() ?? "this view"}`}
      </div>
      <div className="text-tertiary text-[13px]/4">
        {view === "primary" || view === "other"
          ? "New mail will show up here after your next sync."
          : "Threads you move here will appear in this list."}
      </div>
    </div>
  );

  const listFooter =
    listDone && (olderInFlight || backfillPending) ? (
      <button disabled={olderInFlight} onClick={() => void requestOlder()}
        className="py-3 text-center text-tertiary text-xs/4 disabled:cursor-wait">
        {olderInFlight ? "Loading older mail…" : "Load older mail"}
      </button>
    ) : !listDone && !listLoading ? (
    <button
      className="py-3 text-center text-tertiary text-xs/4"
      onClick={() => loadMore(50)}
    >
      Load more
    </button>
  ) : null;

  // layout branches
  const showSidebarOverlay = isNarrow && !isMobile;
  const wideLayout = !threadId && !isMobile;

  const listPane = (
    <div
      className={
        wideLayout || isMobile
          ? "flex flex-col grow basis-0 h-full min-w-0 bg-app"
          : "flex flex-col w-95 h-full shrink-0 bg-app border-r border-sidebar-border"
      }
    >
      <ListHeader
        title={listHeaderTitle}
        unread={listUnread}
        wide={wideLayout}
        filter={ui.filter}
        onFilterChange={ui.setFilter}
        onGoView={(v) => navigate(v)}
        onOpenSearch={() => ui.setPaletteOpen(true)}
        extra={
          showSidebarOverlay || isMobile ? (
            <button
              aria-label="Mailboxes"
              onClick={() => ui.setSidebarOpen(true)}
              className="icon-btn w-7.5 h-7.5 text-secondary"
            >
              <PanelLeft size={16} strokeWidth={1.8} />
            </button>
          ) : undefined
        }
      />
      {!wideLayout && (
        <div className="flex shrink-0 pb-2.5 px-3">
          <button
            onClick={() => ui.setPaletteOpen(true)}
            className="flex items-center grow basis-0 h-7.5 pr-2 pl-2.25 rounded-lg gap-1.75 bg-search-field text-left"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" className="text-tertiary">
              <circle cx="11" cy="11" r="7.5" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
              <path d="m20.5 20.5-4.2-4.2" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
            </svg>
            <div className="grow basis-0 text-tertiary text-[13px]/4">
              Search
            </div>
            <div className="kbd">⌘K</div>
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {loading || listLoading ? (
          loadingRows
        ) : threads.length === 0 ? (
          <div className="flex flex-col">
            {emptyState}
            {listFooter}
          </div>
        ) : (
          <ThreadList
            threads={threads}
            layout={wideLayout ? "wide" : "compact"}
            selectedId={threadId}
            focusedId={focusedId ?? undefined}
            onOpen={openThread}
            actions={wideLayout ? rowActions : undefined}
            footer={listFooter}
          />
        )}
      </div>
    </div>
  );

  return (
    <div className="relative flex h-dvh w-full overflow-clip bg-app antialiased">
      {!DEV_AUTH && <SignOutListener />}
      {/* Sidebar: fixed at >=1100, overlay drawer below */}
      {!isNarrow && sidebarEl}
      {isNarrow && (
        <Dialog.Root open={ui.sidebarOpen} onOpenChange={ui.setSidebarOpen}>
          <Dialog.Portal>
            <Dialog.Backdrop className="fixed inset-0 z-45 bg-black/20 dialog-backdrop" />
            <Dialog.Popup className="fixed inset-y-0 left-0 z-46 dialog-popup">
              <Dialog.Title className="sr-only">Mailboxes</Dialog.Title>
              {sidebarEl}
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      {/* Content */}
      {noAccounts && !loading ? (
        <div className="flex flex-col items-center justify-center grow gap-4">
          <div className="font-semibold text-primary text-[15px]/4.5">
            Connect your Spacemail mailbox
          </div>
          <div className="text-tertiary text-[13px]/4 max-w-80 text-center">
            Post syncs your mail over IMAP and SMTP. Add your first account to
            get started.
          </div>
          <button
            onClick={() => setConnectOpen(true)}
            className="pressable h-8 px-3 rounded-lg bg-accent text-white font-semibold text-[13px]/4"
          >
            Connect account
          </button>
        </div>
      ) : isMobile && threadId ? (
        <ReaderContainer
          threadId={threadId as Id<"threads">}
          categories={categoryInfos}
          threads={threads}
          onClose={closeThread}
          onNavigateThread={(id) =>
            router.push(`${viewPath(view, viewId)}/t/${id}`)
          }
          mobileBack={closeThread}
          dark={resolvedTheme === "dark"}
        />
      ) : (
        <>
          {listPane}
          {threadId && (
            <ReaderContainer
              threadId={threadId as Id<"threads">}
              categories={categoryInfos}
              threads={threads}
              onClose={closeThread}
              onNavigateThread={(id) =>
                router.push(`${viewPath(view, viewId)}/t/${id}`)
              }
              dark={resolvedTheme === "dark"}
            />
          )}
        </>
      )}

      <CommandPalette
        open={ui.paletteOpen}
        onClose={() => ui.setPaletteOpen(false)}
        query={paletteQuery}
        onQueryChange={(q) => {
          setPaletteQuery(q);
          setServerResults([]);
        }}
        results={paletteResults}
        searching={paletteQuery.length > 0 && searchQuery === undefined}
        onOpenThread={(t) => {
          ui.setPaletteOpen(false);
          openThread(t);
        }}
        onServerSearch={runServerSearch}
        commands={commands}
      />

      <ComposeLayer categories={categoryInfos} accounts={accountInfos} />
      <SettingsHost
        categories={categoryInfos}
        accounts={accountInfos}
        onConnectAccount={() => setConnectOpen(true)}
      />
      <ConnectAccountDialog
        open={connectOpen}
        onClose={() => setConnectOpen(false)}
      />
      {categoryDialog && (
        <CategoryDialog
          mode={categoryDialog.mode}
          category={
            categoryDialog.mode === "edit" ? categoryDialog.category : undefined
          }
          onClose={() => setCategoryDialog(null)}
        />
      )}
    </div>
  );
}
