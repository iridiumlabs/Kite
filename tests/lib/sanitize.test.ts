// @vitest-environment node
import { describe, expect, test } from "vitest";
import { sanitizeEmailHtml } from "../../convex/node/content";

describe("sanitizeEmailHtml", () => {
  test("strips script tags and contents", () => {
    const out = sanitizeEmailHtml("<p>ok</p><script>alert(1)</script>");
    expect(out).toContain("<p>ok</p>");
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert");
  });

  test("removes onerror handlers", () => {
    const out = sanitizeEmailHtml('<img src="x" onerror="alert(1)">');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert");
  });

  test("blocks javascript: hrefs", () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain("javascript:");
  });

  test("removes svg onload vectors", () => {
    const out = sanitizeEmailHtml(
      '<svg onload="alert(1)"><circle r="1"/></svg>',
    );
    expect(out).not.toContain("onload");
    expect(out).not.toContain("alert");
  });

  test("strips CSS expression() in inline styles", () => {
    const out = sanitizeEmailHtml(
      '<div style="width: expression(alert(1))">x</div>',
    );
    expect(out).not.toContain("expression");
    expect(out).not.toContain("alert");
  });

  test("strips meta refresh", () => {
    const out = sanitizeEmailHtml(
      '<meta http-equiv="refresh" content="0;url=https://evil"><p>hi</p>',
    );
    expect(out).not.toContain("meta");
    expect(out).not.toContain("evil");
    expect(out).toContain("<p>hi</p>");
  });

  test("drops iframes, objects, forms and base", () => {
    const out = sanitizeEmailHtml(
      '<iframe src="https://x"></iframe><object data="y"></object>' +
        '<form action="https://z"><input></form><base href="https://b"><p>keep</p>',
    );
    for (const bad of ["iframe", "object", "form", "input", "base"]) {
      expect(out).not.toContain(`<${bad}`);
    }
    expect(out).toContain("<p>keep</p>");
  });

  test("links get target=_blank and rel=noopener noreferrer", () => {
    const out = sanitizeEmailHtml('<a href="https://x.com">l</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain("noopener noreferrer");
  });

  test("keeps tables, inline styles and images", () => {
    const out = sanitizeEmailHtml(
      '<table><tr><td style="color:red">c</td></tr></table>' +
        '<img src="https://t.com/a.png" alt="a">',
    );
    expect(out).toContain("<table>");
    expect(out).toContain("color:red");
    expect(out).toContain('src="https://t.com/a.png"');
  });

  test("keeps cid and data image sources", () => {
    const out = sanitizeEmailHtml(
      '<img src="cid:img@1"><img src="data:image/png;base64,AAA">',
    );
    expect(out).toContain("cid:img@1");
    expect(out).toContain("data:image/png");
  });
});
