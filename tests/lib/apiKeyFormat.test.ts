import { describe, expect, test } from "vitest";
import {
  displayPrefix,
  generateApiKey,
  hashApiKey,
  randomBase62,
} from "../../convex/lib/apiKeyFormat";

describe("generateApiKey", () => {
  test("produces kite_sk_ keys with hash and display prefix", async () => {
    const { key, hash, prefix } = await generateApiKey();
    expect(key.startsWith("kite_sk_")).toBe(true);
    expect(key.length).toBe("kite_sk_".length + 32);
    expect(/^[0-9a-zA-Z]+$/.test(key.slice(8))).toBe(true);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).toBe(await hashApiKey(key));
    expect(prefix).toBe(displayPrefix(key));
    expect(prefix).toMatch(/^kite_sk_.{4}\.\.\..{4}$/);
    expect(prefix).not.toBe(key);
  });

  test("keys are unique", async () => {
    const a = await generateApiKey();
    const b = await generateApiKey();
    expect(a.key).not.toBe(b.key);
  });
});

describe("randomBase62", () => {
  test("only emits base62 chars at requested length", () => {
    for (let i = 0; i < 10; i++) {
      expect(randomBase62(32)).toMatch(/^[0-9a-zA-Z]{32}$/);
    }
  });
});
