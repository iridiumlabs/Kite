import { describe, expect, test } from "vitest";
import { forwardSubject, normalizeSubject, replySubject } from "../../convex/lib/subject";

describe("normalizeSubject", () => {
  test("strips prefixes repeatedly and case insensitively", () => {
    expect(normalizeSubject("Re: Hello")).toBe("Hello");
    expect(normalizeSubject("RE: re: Fwd: Hello")).toBe("Hello");
    expect(normalizeSubject("Fw: Re[2]: Hello")).toBe("Hello");
    expect(normalizeSubject("AW: Betreff")).toBe("Betreff");
    expect(normalizeSubject("WG: Weiterleitung")).toBe("Weiterleitung");
    expect(normalizeSubject("Fwd:AW:Re: x")).toBe("x");
  });

  test("keeps bracketed tags and non-prefix words", () => {
    expect(normalizeSubject("[List] Re: Hello")).toBe("[List] Re: Hello");
    expect(normalizeSubject("Re: [List] Hello")).toBe("[List] Hello");
    expect(normalizeSubject("Reply to this")).toBe("Reply to this");
    expect(normalizeSubject("Award ceremony")).toBe("Award ceremony");
  });

  test("handles empty", () => {
    expect(normalizeSubject("")).toBe("");
    expect(normalizeSubject(undefined)).toBe("");
    expect(normalizeSubject("Re: ")).toBe("");
  });
});

describe("reply/forward builders", () => {
  test("replySubject", () => {
    expect(replySubject("Re: Hello")).toBe("Re: Hello");
    expect(replySubject("Fwd: Hello")).toBe("Re: Hello");
    expect(replySubject("Hello")).toBe("Re: Hello");
  });

  test("forwardSubject", () => {
    expect(forwardSubject("Re: Hello")).toBe("Fwd: Hello");
    expect(forwardSubject("Hello")).toBe("Fwd: Hello");
  });
});
