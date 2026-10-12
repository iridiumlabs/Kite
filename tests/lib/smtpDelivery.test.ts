import { expect, test } from "vitest";
import { smtpDelivery } from "../../convex/lib/smtpDelivery";

test("partial SMTP delivery splits accepted and rejected addresses without resending accepted duplicates", () => {
  const a = { email: "Accepted@x.com" }; const b = { email: "rejected@x.com" };
  expect(smtpDelivery({ accepted: ["accepted@x.com"], rejected: [{ address: b.email }, "Accepted@x.com"] }, [a, b])).toEqual({ accepted: [a], rejected: [b] });
});
test("a complete successful SMTP response keeps every recipient", () => {
  const requested = [{ email: "a@x.com" }, { email: "b@x.com" }];
  expect(smtpDelivery({ accepted: requested.map(a => a.email), rejected: [] }, requested)).toEqual({ accepted: requested, rejected: [] });
});
test("incomplete recipient evidence cannot be treated as fully successful", () => {
  expect(() => smtpDelivery({ accepted: ["a@x.com"], rejected: [] }, [{ email: "a@x.com" }, { email: "b@x.com" }])).toThrow("incomplete");
});
