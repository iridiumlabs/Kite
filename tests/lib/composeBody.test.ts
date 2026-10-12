import { expect, test } from "vitest";
import { initialComposeBody, replacementComposeSignature } from "../../lib/ui/composeBody";

test.each(["new", "reply", "replyAll", "forward"])("fresh %s composers include the chosen account signature", mode => {
  expect(initialComposeBody(mode, undefined, "<p>Regards, Ada</p>")).toBe("<p></p><p>Regards, Ada</p>");
});

test("saved draft bodies, including intentionally empty bodies, never regain a signature", () => {
  expect(initialComposeBody("draft", "<p>Saved</p>", "<p>Signature</p>")).toBe("<p>Saved</p>");
  expect(initialComposeBody("draft", "", "<p>Signature</p>")).toBe("");
});

test("switching senders replaces only the untouched fresh signature, including removing it", () => {
  const current = "<p></p><p>Account A</p>";
  expect(replacementComposeSignature("new", current, current, "<p>Account B</p>")).toBe("<p></p><p>Account B</p>");
  expect(replacementComposeSignature("reply", current, current, undefined)).toBe("");
  expect(replacementComposeSignature("new", "<p></p>", "<p></p>", "<p>B</p>")).toBe("<p></p><p>B</p>");
});

test("sender changes preserve edited bodies, saved drafts, and pre-initialization typing", () => {
  expect(replacementComposeSignature("new", "<p>Typed</p>", "<p>A</p>", "<p>B</p>")).toBeUndefined();
  expect(replacementComposeSignature("draft", "<p>A</p>", "<p>A</p>", "<p>B</p>")).toBeUndefined();
  expect(replacementComposeSignature("forward", "<p>Typed</p>", undefined, "<p>B</p>")).toBeUndefined();
});

test("accounts without a configured signature get an empty body", () => {
  expect(initialComposeBody("new", undefined, undefined)).toBe("");
  expect(initialComposeBody("new", undefined, " ")).toBe("");
});
