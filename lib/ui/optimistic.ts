import type { OptimisticLocalStore } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

type EnrichedThread = {
  _id: Id<"threads">;
  unread: boolean;
  starred: boolean;
  unreadCount: number;
  listKey: string;
  accountId: Id<"accounts">;
  categoryIds: Id<"categories">[];
};

type ThreadPage = {
  page: EnrichedThread[];
  continueCursor: string;
  isDone: boolean;
};

function updateAllThreadPages(
  store: OptimisticLocalStore,
  update: (t: EnrichedThread) => EnrichedThread | null,
) {
  for (const q of store.getAllQueries(api.mail.listThreads)) {
    if (!q.value) continue;
    const value = q.value as ThreadPage;
    store.setQuery(api.mail.listThreads, q.args as never, {
      ...value,
      page: value.page
        .map(update)
        .filter((t): t is EnrichedThread => t !== null),
    } as never);
  }
}

/** Remove threads from every cached listThreads page */
export function removeThreads(store: OptimisticLocalStore, ids: string[]) {
  const idSet = new Set(ids);
  updateAllThreadPages(store, (t) => (idSet.has(t._id) ? null : t));
}

/** Patch a flag on threads in every cached page */
export function patchThreads(
  store: OptimisticLocalStore,
  ids: string[],
  patch: Partial<EnrichedThread>,
) {
  const idSet = new Set(ids);
  updateAllThreadPages(store, (t) =>
    idSet.has(t._id) ? { ...t, ...patch } : t,
  );
}

export function adjustCounters(
  store: OptimisticLocalStore,
  deltas: Record<string, number>,
) {
  const current = store.getQuery(api.mail.counts, {});
  if (current === undefined) return;
  const next: Record<string, number> = { ...(current as object) } as Record<
    string,
    number
  >;
  for (const [k, d] of Object.entries(deltas)) {
    next[k] = Math.max(0, (next[k] ?? 0) + d);
  }
  store.setQuery(api.mail.counts, {}, next as never);
}

/** Optimistically mark read/unread: patch rows and counters */
export function optimisticRead(
  store: OptimisticLocalStore,
  args: {
    threadIds?: Id<"threads">[];
    read: boolean;
    inboxOf: Map<string, { listKey: string; accountId: string }>;
  },
) {
  const ids = args.threadIds ?? [];
  patchThreads(
    store,
    ids,
    args.read
      ? { unread: false, unreadCount: 0 }
      : { unread: true, unreadCount: 1 },
  );
  const deltas: Record<string, number> = {};
  for (const id of ids) {
    const info = args.inboxOf.get(id);
    if (!info) continue;
    if (info.listKey === "primary" || info.listKey === "other") {
      const d = args.read ? -1 : 1;
      deltas[`unread:${info.listKey}`] =
        (deltas[`unread:${info.listKey}`] ?? 0) + d;
      deltas[`unread:acct:${info.accountId}`] =
        (deltas[`unread:acct:${info.accountId}`] ?? 0) + d;
    }
  }
  if (Object.keys(deltas).length) adjustCounters(store, deltas);
}
