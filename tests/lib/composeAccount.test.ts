import { expect, test } from "vitest";
import { composeAccount } from "../../lib/ui/composeAccount";
import type { AccountInfo } from "../../lib/ui/types";

const accounts = [{ id: "first" }, { id: "second" }] as AccountInfo[];

test("new messages use the configured default sender", () => {
  expect(composeAccount(accounts, undefined, "second")).toBe(accounts[1]);
});

test("explicit draft, reply or manual sender overrides the default", () => {
  expect(composeAccount(accounts, "first", "second")).toBe(accounts[0]);
});

test("missing or removed defaults fall back to the first mailbox", () => {
  expect(composeAccount(accounts)).toBe(accounts[0]);
  expect(composeAccount(accounts, undefined, "removed")).toBe(accounts[0]);
  expect(composeAccount([], undefined, "second")).toBeUndefined();
});
