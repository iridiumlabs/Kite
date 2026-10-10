import { describe, expect, test } from "vitest";
import {
  htmlQuoteStart,
  splitHtmlQuote,
  splitTextQuote,
} from "../../convex/lib/quoteSplit";
import { makeSnippet } from "../../convex/lib/snippet";

describe("splitTextQuote", () => {
  test("splits a trailing >-quoted block", () => {
    const r = splitTextQuote("Thanks!\n\n> prior line\n> more prior");
    expect(r.text).toBe("Thanks!");
    expect(r.quotedText).toContain("> prior line\n> more prior");
  });

  test("includes the On ... wrote: introducer", () => {
    const r = splitTextQuote(
      "Sure, works for me.\n\nOn Mon, Jan 1, 2024, Ada <ada@x.com> wrote:\n> hello",
    );
    expect(r.text).toBe("Sure, works for me.");
    expect(r.quotedText).toContain("wrote:");
    expect(r.quotedText).toContain("> hello");
  });

  test("leaves mid-body quoted text alone", () => {
    const r = splitTextQuote("a\n> quoted\nnew content here");
    expect(r.quotedText).toBeUndefined();
    expect(r.text).toBe("a\n> quoted\nnew content here");
  });

  test("Outlook separator line is treated as a quote boundary", () => {
    const r = splitTextQuote(
      "ok\n_________________________________\n> old",
    );
    expect(r.text).toBe("ok");
  });

  test("no quote returns the text untouched", () => {
    const r = splitTextQuote("just a message");
    expect(r).toEqual({ text: "just a message" });
  });
});

describe("splitHtmlQuote / htmlQuoteStart", () => {
  test("splits at gmail_quote", () => {
    const h = '<div>hi</div><div class="gmail_quote">quoted</div>';
    const r = splitHtmlQuote(h);
    expect(r.html).toBe("<div>hi</div>");
    expect(r.quotedHtml).toContain("gmail_quote");
  });

  test("splits at blockquote type=cite", () => {
    const h = '<p>mine</p><blockquote type="cite">old</blockquote>';
    const r = splitHtmlQuote(h);
    expect(r.html).toBe("<p>mine</p>");
    expect(r.quotedHtml).toContain("old");
  });

  test("splits at moz-cite-prefix", () => {
    const h = '<p>x</p><div class="moz-cite-prefix">On 1/1 wrote:</div>';
    expect(htmlQuoteStart(h)).toBeGreaterThan(0);
  });

  test("splits at Outlook divRplyFwdMsg", () => {
    const h = '<div>new</div><div id="divRplyFwdMsg">hdr</div>';
    expect(htmlQuoteStart(h)).toBeGreaterThan(0);
  });

  test("splits at Outlook From:/Sent: header block", () => {
    const h = '<p>new</p><div><b>From:</b> a@x.com<br><b>Sent:</b> Mon</div>';
    expect(htmlQuoteStart(h)).toBeGreaterThan(0);
  });

  test("splits at Apple On ... wrote: before blockquote", () => {
    const h =
      "<div>new</div><div>On March 1, Ada wrote:</div><blockquote>old</blockquote>";
    const r = splitHtmlQuote(h);
    expect(r.quotedHtml).toBeDefined();
  });

  test("plain html returns no quote", () => {
    expect(splitHtmlQuote("<p>hello</p>")).toEqual({ html: "<p>hello</p>" });
  });
});

describe("makeSnippet", () => {
  test("collapses whitespace and caps length", () => {
    expect(makeSnippet("  hello\n   world  ")).toBe("hello world");
    expect(makeSnippet("x".repeat(500))).toHaveLength(240);
  });
  test("strips trailing quoted lines and signatures", () => {
    expect(makeSnippet("Hi there\n> old\n-- \nBob")).toBe("Hi there");
  });
});
