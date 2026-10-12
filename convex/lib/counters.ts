import type { ListKey } from "./types";

export interface CounterThreadLike {
  listKey: ListKey;
  unread: boolean;
  accountId: string;
  categoryIds: string[];
}

// Keys a thread contributes +1 to. Drafts use the separate "drafts" counter
// maintained by the drafts mutations.
export function counterKeys(thread: CounterThreadLike): string[] {
  const keys: string[] = [];
  if (
    (thread.listKey === "primary" || thread.listKey === "other") &&
    thread.unread
  ) {
    keys.push(`unread:${thread.listKey}`);
    keys.push(`unread:acct:${thread.accountId}`);
    for (const id of thread.categoryIds) {
      keys.push(`unread:cat:${id}`);
    }
  }
  return keys;
}

export function diffCounters(
  before: CounterThreadLike | null,
  after: CounterThreadLike | null,
): Map<string, number> {
  const deltas = new Map<string, number>();
  if (before) {
    for (const key of counterKeys(before)) {
      deltas.set(key, (deltas.get(key) ?? 0) - 1);
    }
  }
  if (after) {
    for (const key of counterKeys(after)) {
      deltas.set(key, (deltas.get(key) ?? 0) + 1);
    }
  }
  for (const [k, d] of deltas) {
    if (d === 0) deltas.delete(k);
  }
  return deltas;
}
