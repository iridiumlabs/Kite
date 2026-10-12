import { describe, expect, test } from "vitest";
import { counterKeys, diffCounters } from "../../convex/lib/counters";

describe("counterKeys", () => {
  test("unread inbox thread contributes list, account and category keys", () => {
    const keys = counterKeys({
      listKey: "primary",
      unread: true,
      accountId: "acct1",
      categoryIds: ["c1", "c2"],
    });
    expect(keys.sort()).toEqual(
      [
        "unread:primary",
        "unread:acct:acct1",
        "unread:cat:c1",
        "unread:cat:c2",
      ].sort(),
    );
  });

  test("other bucket works the same", () => {
    expect(
      counterKeys({
        listKey: "other",
        unread: true,
        accountId: "a",
        categoryIds: [],
      }),
    ).toEqual(["unread:other", "unread:acct:a"]);
  });

  test("read threads and non-inbox list keys contribute nothing", () => {
    expect(
      counterKeys({
        listKey: "primary",
        unread: false,
        accountId: "a",
        categoryIds: ["c"],
      }),
    ).toEqual([]);
    for (const listKey of ["archive", "trash", "snoozed", "none"] as const) {
      expect(
        counterKeys({ listKey, unread: true, accountId: "a", categoryIds: [] }),
      ).toEqual([]);
    }
  });
});

describe("diffCounters", () => {
  const t = (over: object) => ({
    listKey: "primary" as const,
    unread: true,
    accountId: "a",
    categoryIds: ["c1"],
    ...over,
  });

  test("create adds keys, delete removes", () => {
    expect(diffCounters(null, t({}))).toEqual(
      new Map([
        ["unread:primary", 1],
        ["unread:acct:a", 1],
        ["unread:cat:c1", 1],
      ]),
    );
    expect(diffCounters(t({}), null)).toEqual(
      new Map([
        ["unread:primary", -1],
        ["unread:acct:a", -1],
        ["unread:cat:c1", -1],
      ]),
    );
  });

  test("transition primary -> other moves only the list key", () => {
    const d = diffCounters(t({}), t({ listKey: "other" }));
    expect(d).toEqual(
      new Map([
        ["unread:primary", -1],
        ["unread:other", 1],
      ]),
    );
  });

  test("read transition drops all keys; zero deltas removed", () => {
    const d = diffCounters(t({}), t({ unread: false }));
    expect(d.get("unread:primary")).toBe(-1);
    expect(d.size).toBe(3);
    expect(diffCounters(t({}), { ...t({}) }).size).toBe(0);
    expect(diffCounters(null, null).size).toBe(0);
  });
});
