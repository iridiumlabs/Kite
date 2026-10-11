import { describe, expect, test } from "vitest";
import {
  replyRecipients,
  threadingHeaders,
  replySubjectFor,
  forwardSubjectFor,
  newMessageId,
  wroteAttribution,
  quoteHtml,
  quoteText,
  forwardHeaderBlock,
  htmlToText,
  appendOriginalQuote,
  type ComposeOriginal,
} from "../../convex/lib/compose";

const OWNER = ["me@x.com", "alt@x.com"];

function original(over: Partial<ComposeOriginal> = {}): ComposeOriginal {
  return {
    messageIdHeader: "orig@x.com",
    references: ["root@x.com"],
    subject: "Quarterly plan",
    from: { name: "Ada", email: "ada@x.com" },
    to: [{ email: "me@x.com" }, { email: "bob@x.com" }],
    cc: [{ email: "carol@x.com" }],
    replyTo: [],
    date: 1_700_000_000_000,
    ...over,
  };
}

test("shared draft quoting preserves both alternatives and escapes plaintext originals", () => {
  const reply = appendOriginalQuote("reply", original(), { text: "Original <unsafe> & text" }, { html: "<p>Thanks</p>" });
  expect(reply.html).toContain("<p>Thanks</p>");
  expect(reply.html).toContain("&lt;unsafe&gt; &amp; text");
  expect(reply.text).toContain("Thanks");
  expect(reply.text).toContain("> Original <unsafe> & text");
  const forward = appendOriginalQuote("forward", original(), { html: "<p>Original body</p>" }, { text: "For your review" });
  expect(forward.html).toContain("Forwarded message");
  expect(forward.html).toContain("<p>Original body</p>");
  expect(forward.text).toContain("For your review");
  expect(forward.text).toContain("Original body");
});

describe("replyRecipients", () => {
  test("reply goes to From", () => {
    const r = replyRecipients(original(), false, OWNER);
    expect(r.to).toEqual([{ name: "Ada", email: "ada@x.com" }]);
    expect(r.cc).toEqual([]);
  });

  test("Reply-To wins over From", () => {
    const r = replyRecipients(
      original({ replyTo: [{ email: "list@x.com" }] }),
      false,
      OWNER,
    );
    expect(r.to).toEqual([{ email: "list@x.com" }]);
  });

  test("reply-all excludes owner addresses and dedupes", () => {
    const r = replyRecipients(
      original({
        to: [
          { email: "me@x.com" },
          { email: "alt@x.com" },
          { email: "bob@x.com" },
        ],
        cc: [{ email: "bob@x.com" }, { email: "carol@x.com" }],
      }),
      true,
      OWNER,
    );
    expect(r.cc.map((a) => a.email).sort()).toEqual([
      "bob@x.com",
      "carol@x.com",
    ]);
  });

  test("reply-all keeps the original sender in To", () => {
    const r = replyRecipients(original(), true, OWNER);
    expect(r.to[0].email).toBe("ada@x.com");
  });
});

describe("threadingHeaders", () => {
  test("In-Reply-To is the original id, references appended", () => {
    const h = threadingHeaders(original());
    expect(h.inReplyTo).toBe("orig@x.com");
    expect(h.references).toEqual(["root@x.com", "orig@x.com"]);
  });

  test("references are capped to the last 30", () => {
    const h = threadingHeaders(
      original({ references: Array.from({ length: 40 }, (_, i) => `r${i}`) }),
    );
    expect(h.references).toHaveLength(30);
    expect(h.references.at(-1)).toBe("orig@x.com");
  });
});

describe("subjects and message id", () => {
  test("Re: is not doubled", () => {
    expect(replySubjectFor(original())).toBe("Re: Quarterly plan");
    expect(replySubjectFor(original({ subject: "Re: Quarterly plan" }))).toBe(
      "Re: Quarterly plan",
    );
  });

  test("Fwd: prefix", () => {
    expect(forwardSubjectFor(original())).toBe("Fwd: Quarterly plan");
    expect(
      forwardSubjectFor(original({ subject: "Fwd: Quarterly plan" })),
    ).toBe("Fwd: Quarterly plan");
  });

  test("newMessageId is <uuid@domain> shaped", () => {
    const id = newMessageId("x.com");
    expect(id).toMatch(/^[^@\s]+@x\.com$/);
    expect(newMessageId("x.com")).not.toBe(id);
  });
});

describe("quotes and forwards", () => {
  test("wroteAttribution renders name and email", () => {
    const s = wroteAttribution(1_700_000_000_000, {
      name: "Ada",
      email: "ada@x.com",
    });
    expect(s).toContain("Ada <ada@x.com>");
    expect(s).toMatch(/^On /);
  });

  test("quoteText prefixes >", () => {
    expect(quoteText("a\nb")).toBe("> a\n> b");
  });

  test("quoteHtml wraps in a cite blockquote and escapes text", () => {
    expect(quoteHtml("<b>x</b>", false)).toContain("&lt;b&gt;");
    expect(quoteHtml("<b>x</b>", true)).toContain("<b>x</b>");
    expect(quoteHtml("x", true)).toMatch(/^<blockquote type="cite"/);
  });

  test("forwardHeaderBlock carries From/Date/Subject/To", () => {
    const f = forwardHeaderBlock(original(), [{ email: "me@x.com" }]);
    expect(f.text).toContain("Forwarded message");
    expect(f.text).toContain("From: Ada <ada@x.com>");
    expect(f.text).toContain("Subject: Quarterly plan");
    expect(f.text).toContain("To: me@x.com");
    expect(f.html).toContain("Quarterly plan");
  });
});

describe("htmlToText", () => {
  test("strips tags and entities", () => {
    expect(htmlToText("<p>Hello <b>world</b> &amp; co</p>")).toBe(
      "Hello world & co",
    );
  });
  test("drops script and style content", () => {
    expect(htmlToText("<style>x{}</style><script>y()</script>ok")).toBe("ok");
  });
  test("block tags become newlines", () => {
    expect(htmlToText("<div>a</div><div>b</div>")).toBe("a\nb");
  });
});
