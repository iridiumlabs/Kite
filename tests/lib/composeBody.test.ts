import { expect, test } from "vitest";
import { initialComposeBody } from "../../lib/ui/composeBody";

test.each(["new", "reply", "replyAll", "forward"])("fresh %s composers include the chosen account signature", mode => {
  expect(initialComposeBody(mode, undefined, "<p>Regards, Ada</p>")).toBe("<p></p><p>Regards, Ada</p>");
});

test("saved draft bodies, including intentionally empty bodies, never regain a signature", () => {
  expect(initialComposeBody("draft", "<p>Saved</p>", "<p>Signature</p>")).toBe("<p>Saved</p>");
  expect(initialComposeBody("draft", "", "<p>Signature</p>")).toBe("");
});

test("accounts without a configured signature get an empty body", () => {
  expect(initialComposeBody("new", undefined, undefined)).toBe("");
  expect(initialComposeBody("new", undefined, " ")).toBe("");
});
