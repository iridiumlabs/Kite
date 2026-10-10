import { describe, expect, test } from "vitest";
import {
  displayName,
  formatAddress,
  formatAddressList,
  initials,
  isOwner,
  normalizeMessageId,
  parseAddressList,
  parseMessageIdList,
} from "../../convex/lib/addresses";

describe("normalizeMessageId", () => {
  test("strips brackets, trims, lowercases", () => {
    expect(normalizeMessageId("  <ABC@Mail.Com> ")).toBe("abc@mail.com");
    expect(normalizeMessageId("abc@mail.com")).toBe("abc@mail.com");
    expect(normalizeMessageId("<Mixed@Case>")).toBe("mixed@case");
    expect(normalizeMessageId("")).toBe("");
    expect(normalizeMessageId(undefined)).toBe("");
  });
});

describe("parseMessageIdList", () => {
  test("extracts all bracketed ids", () => {
    expect(parseMessageIdList("<a@x> <B@y>\t<c@z>")).toEqual([
      "a@x",
      "b@y",
      "c@z",
    ]);
  });
  test("falls back to bare id", () => {
    expect(parseMessageIdList("single@id")).toEqual(["single@id"]);
    expect(parseMessageIdList("")).toEqual([]);
  });
});

describe("parseAddressList", () => {
  test("parses mixed formats", () => {
    expect(
      parseAddressList('"Doe, Jane" <jane@x.com>, bob@y.com, Ann <ann@z.com>'),
    ).toEqual([
      { name: "Doe, Jane", email: "jane@x.com" },
      { email: "bob@y.com" },
      { name: "Ann", email: "ann@z.com" },
    ]);
  });

  test("lowercases emails and drops empties", () => {
    expect(parseAddressList("Bob@Y.com, , not-an-email")).toEqual([
      { email: "bob@y.com" },
    ]);
  });

  test("handles commas inside quoted names and empty input", () => {
    expect(parseAddressList("")).toEqual([]);
    expect(parseAddressList(undefined)).toEqual([]);
    expect(parseAddressList('"A, B" <ab@x.com>')).toEqual([
      { name: "A, B", email: "ab@x.com" },
    ]);
  });
});

describe("formatAddress", () => {
  test("formats plain and quoted names", () => {
    expect(formatAddress({ email: "a@b.com" })).toBe("a@b.com");
    expect(formatAddress({ name: "Ann", email: "a@b.com" })).toBe(
      "Ann <a@b.com>",
    );
    expect(formatAddress({ name: "Doe, Jane", email: "a@b.com" })).toBe(
      '"Doe, Jane" <a@b.com>',
    );
    expect(formatAddress({ name: 'Say "hi"', email: "a@b.com" })).toBe(
      '"Say \\"hi\\"" <a@b.com>',
    );
  });

  test("formatAddressList joins", () => {
    expect(
      formatAddressList([{ email: "a@b" }, { name: "C", email: "c@d" }]),
    ).toBe("a@b, C <c@d>");
  });
});

describe("isOwner / displayName / initials", () => {
  test("owner detection is case insensitive", () => {
    expect(isOwner("A@B.com", ["a@b.com"])).toBe(true);
    expect(isOwner({ email: "c@d.com" }, ["a@b.com"])).toBe(false);
  });

  test("displayName falls back to local part", () => {
    expect(displayName({ name: "Maya", email: "m@x.com" })).toBe("Maya");
    expect(displayName({ email: "maya.okafor@x.com" })).toBe("maya okafor");
    expect(displayName({ email: "m@x.com" })).toBe("m");
  });

  test("initials", () => {
    expect(initials("Maya Okafor")).toBe("MO");
    expect(initials("Arham")).toBe("A");
    expect(initials("mary jane watson")).toBe("MW");
    expect(initials("  ")).toBe("?");
  });
});
