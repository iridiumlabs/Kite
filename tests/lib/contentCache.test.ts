import { expect, test } from "vitest";
import { contentSnapshot, subscribeContent, setCached, getCached, evictCached, markInflight, clearInflight } from "../../lib/ui/contentCache";

test("cache writes and retries notify remounted readers sharing an in-flight request", () => {
  let renders = 0;
  const unsubscribe = subscribeContent(() => renders++);
  const version = contentSnapshot();
  expect(markInflight("shared")).toBe(true);
  expect(markInflight("shared")).toBe(false);
  setCached("shared", { text: "Loaded" });
  clearInflight("shared");
  expect(getCached("shared")?.text).toBe("Loaded");
  expect(contentSnapshot()).toBeGreaterThan(version);
  expect(renders).toBe(2);
  evictCached("shared");
  expect(getCached("shared")).toBeUndefined();
  expect(renders).toBe(3);
  unsubscribe();
});

test("cached bodies and in-flight requests are isolated by image policy", () => {
  setCached("privacy", { html: '<img src="https://tracker.test/">', loadRemoteImages: true });
  expect(getCached("privacy", false)).toBeUndefined();
  expect(markInflight("privacy", false)).toBe(true);
  expect(markInflight("privacy", true)).toBe(true);
  setCached("privacy", { html: "<p>blocked</p>", loadRemoteImages: false });
  // A stale allowed request completing later cannot overwrite the blocked body.
  setCached("privacy", { html: '<img src="https://late-tracker.test/">', loadRemoteImages: true });
  expect(getCached("privacy", false)).toMatchObject({ html: "<p>blocked</p>", loadRemoteImages: false });
  expect(getCached("privacy", true)?.loadRemoteImages).toBe(true);
  clearInflight("privacy", false); clearInflight("privacy", true);
  evictCached("privacy");
  expect(getCached("privacy", false)).toBeUndefined();
  expect(getCached("privacy", true)).toBeUndefined();
});

test("reader cache retains at most fifty bodies with LRU eviction", () => {
  for (let i = 0; i < 50; i++) setCached(`lru-${i}`, { text: String(i) });
  getCached("lru-0");
  setCached("lru-50", { text: "new" });
  expect(getCached("lru-1")).toBeUndefined();
  expect(getCached("lru-0")?.text).toBe("0");
});
