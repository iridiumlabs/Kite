import { expect, test } from "vitest";
import { selectSearchHits } from "../../convex/lib/searchHits";

test("already-synced hits count against the server-search limit", () => {
  const uids = Array.from({ length: 1000 }, (_, i) => i + 1);
  const selected = selectSearchHits(uids, new Set(uids), 20);
  expect(selected.synced).toHaveLength(20);
  expect(selected.synced[0]).toBe(1000);
  expect(selected.unsynced).toEqual([]);
});

test("mixed hits share one budget and are grouped for batched lookups", () => {
  const selected = selectSearchHits([1, 2, 3, 4, 5, 5], new Set([2, 4]), 3);
  expect(selected).toEqual({ synced: [4], unsynced: [5, 3] });
  expect(selectSearchHits([1], new Set(), 0)).toEqual({ synced: [], unsynced: [] });
});
