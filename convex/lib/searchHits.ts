/** Bound synced and unsynced server hits together, newest UID first. */
export function selectSearchHits(uids: number[], synced: Set<number>, limit: number) {
  const selected = [...new Set(uids)].sort((a, b) => b - a).slice(0, Math.max(0, limit));
  return {
    synced: selected.filter(uid => synced.has(uid)),
    unsynced: selected.filter(uid => !synced.has(uid)),
  };
}
