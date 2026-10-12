import { describe, expect, test } from "vitest";
import { sendContentHash, sha256Hex } from "../../convex/lib/idempotency";

const BASE = {
  accountId: "acct1",
  to: [{ email: "A@x.com" }, { email: "b@x.com" }],
  cc: [],
  bcc: [],
  subject: "Hello",
  text: "hi there",
  attachments: [{ filename: "a.pdf", size: 10 }],
};

describe("sha256Hex", () => {
  test("is 64 hex chars and deterministic", async () => {
    const h = await sha256Hex("kite");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex("kite")).toBe(h);
    expect(await sha256Hex("kite2")).not.toBe(h);
  });
});

describe("sendContentHash", () => {
  test("recipient order and case do not matter", async () => {
    const a = await sendContentHash(BASE);
    const b = await sendContentHash({
      ...BASE,
      to: [{ email: "b@x.com" }, { email: "a@X.com" }],
    });
    expect(a).toBe(b);
  });

  test("whitespace-normalized body does not matter", async () => {
    const a = await sendContentHash(BASE);
    const b = await sendContentHash({ ...BASE, text: " hi   there \n" });
    expect(a).toBe(b);
  });

  test("subject, body, recipients, account and attachments matter", async () => {
    const a = await sendContentHash(BASE);
    expect(await sendContentHash({ ...BASE, subject: "Other" })).not.toBe(a);
    expect(await sendContentHash({ ...BASE, text: "different" })).not.toBe(a);
    expect(await sendContentHash({ ...BASE, to: [] })).not.toBe(a);
    expect(await sendContentHash({ ...BASE, accountId: "acct2" })).not.toBe(a);
    expect(
      await sendContentHash({
        ...BASE,
        attachments: [{ filename: "b.pdf", size: 10 }],
      }),
    ).not.toBe(a);
    expect(
      await sendContentHash({
        ...BASE,
        attachments: [{ filename: "a.pdf", size: 11 }],
      }),
    ).not.toBe(a);
  });
});
