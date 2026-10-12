import { describe, expect, test } from "vitest";
import {
  addUid,
  addUids,
  containsUid,
  diffUidSets,
  emptyFlags,
  formatUidSet,
  getFlags,
  maxUid,
  minUid,
  parseUidSet,
  realignFlags,
  removeUid,
  removeUids,
  setFlags,
  uidCount,
  uids,
} from "../../convex/lib/uidset";

describe("parse/format", () => {
  test("roundtrips a range string", () => {
    const r = parseUidSet("1-40,42,50-61");
    expect(r).toEqual([
      [1, 40],
      [42, 42],
      [50, 61],
    ]);
    expect(formatUidSet(r)).toBe("1-40,42,50-61");
  });

  test("normalizes unordered and overlapping input", () => {
    expect(formatUidSet(parseUidSet("50-51,1-5,4-10,7"))).toBe("1-10,50-51");
  });

  test("empty string parses to empty set", () => {
    expect(parseUidSet("")).toEqual([]);
    expect(formatUidSet([])).toBe("");
  });
});

describe("add/remove", () => {
  test("addUid merges adjacent", () => {
    const r = parseUidSet("1-3,7-9");
    expect(formatUidSet(addUid(r, 4))).toBe("1-4,7-9");
    expect(formatUidSet(addUid(addUid(r, 4), 6))).toBe("1-4,6-9");
    expect(formatUidSet(addUid(addUid(addUid(r, 4), 6), 5))).toBe("1-9");
  });

  test("addUids is idempotent for existing uids", () => {
    const r = parseUidSet("1-3");
    expect(formatUidSet(addUids(r, [2, 3, 8]))).toBe("1-3,8");
  });

  test("removeUid splits a range", () => {
    const r = parseUidSet("1-10");
    expect(formatUidSet(removeUid(r, 5))).toBe("1-4,6-10");
    expect(formatUidSet(removeUid(r, 1))).toBe("2-10");
    expect(formatUidSet(removeUid(r, 10))).toBe("1-9");
    expect(formatUidSet(removeUid(r, 99))).toBe("1-10");
  });

  test("removeUids removes scattered uids", () => {
    const r = parseUidSet("1-10,20-25");
    expect(formatUidSet(removeUids(r, [1, 2, 5, 10, 21]))).toBe(
      "3-4,6-9,20,22-25",
    );
  });
});

describe("diff", () => {
  test("vanished = stored minus server, added = server minus stored", () => {
    const stored = parseUidSet("1-10,15-20,30");
    const server = parseUidSet("5-16,30,40-42");
    const d = diffUidSets(stored, server);
    expect(formatUidSet(d.vanished)).toBe("1-4,17-20");
    expect(formatUidSet(d.added)).toBe("11-14,40-42");
  });

  test("identical sets produce empty diff", () => {
    const r = parseUidSet("1-5,9");
    const d = diffUidSets(r, parseUidSet("1-5,9"));
    expect(d.vanished).toEqual([]);
    expect(d.added).toEqual([]);
  });
});

describe("iteration and lookup", () => {
  test("uids iterate ascending", () => {
    expect([...uids(parseUidSet("3-5,1,10-11"))]).toEqual([1, 3, 4, 5, 10, 11]);
  });

  test("count/contains/min/max", () => {
    const r = parseUidSet("1-5,10,20-30");
    expect(uidCount(r)).toBe(17);
    expect(containsUid(r, 10)).toBe(true);
    expect(containsUid(r, 6)).toBe(false);
    expect(minUid(r)).toBe(1);
    expect(maxUid(r)).toBe(30);
    expect(minUid([])).toBeUndefined();
    expect(maxUid([])).toBeUndefined();
  });
});

describe("flags codec", () => {
  test("emptyFlags is all zeros aligned to the set", () => {
    expect(emptyFlags(parseUidSet("1-3,7"))).toBe("0000");
  });

  test("get/set flag bits per uid", () => {
    const r = parseUidSet("1-3,7");
    let flags = emptyFlags(r);
    flags = setFlags(flags, r, 2, 3);
    flags = setFlags(flags, r, 7, 7);
    expect(flags).toBe("0307");
    expect(getFlags(flags, r, 2)).toBe(3);
    expect(getFlags(flags, r, 7)).toBe(7);
    expect(getFlags(flags, r, 1)).toBe(0);
    expect(setFlags(flags, r, 99, 1)).toBe(flags);
  });

  test("realign preserves bits across adds and removes", () => {
    const oldR = parseUidSet("1-5");
    const flags = setFlags(setFlags("00000", oldR, 2, 1), oldR, 4, 5);
    const newR = parseUidSet("1,3-6");
    expect(realignFlags(flags, oldR, newR)).toBe("00500");
  });

  test("handles 10k+ uids", () => {
    const big = parseUidSet("1-12000");
    expect(uidCount(big)).toBe(12000);
    const removed = removeUids(
      big,
      Array.from({ length: 1000 }, (_, i) => i * 10 + 1),
    );
    expect(uidCount(removed)).toBe(11000);
    const flags = realignFlags(emptyFlags(big), big, removed);
    expect(flags.length).toBe(11000);
    const withBits = setFlags(flags, removed, 6000, 7);
    expect(getFlags(withBits, removed, 6000)).toBe(7);
  });
});
