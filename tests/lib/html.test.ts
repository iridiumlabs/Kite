import { describe, expect, test } from "vitest";
import {
  rewriteCidReferences,
  blockRemoteImages,
} from "../../convex/lib/html";

describe("rewriteCidReferences", () => {
  const map = new Map([["img1@x", "data:image/png;base64,AAA"]]);

  test("rewrites a quoted src", () => {
    const r = rewriteCidReferences('<img src="cid:img1@x">', map);
    expect(r.replaced).toBe(1);
    expect(r.html).toContain("data:image/png;base64,AAA");
  });

  test("rewrites single-quoted and unquoted attrs", () => {
    const r = rewriteCidReferences(
      "<img src='cid:img1@x'><img src=cid:img1@x>",
      map,
    );
    expect(r.replaced).toBe(2);
  });

  test("leaves unmatched cids alone", () => {
    const r = rewriteCidReferences('<img src="cid:other">', map);
    expect(r.replaced).toBe(0);
    expect(r.html).toContain("cid:other");
  });

  test("matches cid values with angle brackets stripped", () => {
    const m = new Map([["img1@x", "data:x"]]);
    const r = rewriteCidReferences('<img src="cid:%3Cimg1@x%3E">', m);
    expect(r.replaced).toBe(1);
  });

  test("does not touch non-cid src", () => {
    const r = rewriteCidReferences('<img src="https://x/y.png">', map);
    expect(r.replaced).toBe(0);
  });
});

describe("blockRemoteImages", () => {
  test("moves http src to data-src and counts it", () => {
    const r = blockRemoteImages('<img src="https://t.com/p.gif" width="1">');
    expect(r.blocked).toBe(1);
    expect(r.html).toContain('data-src="https://t.com/p.gif"');
    expect(r.html).toContain('src=""');
  });

  test("handles multiple images and https", () => {
    const r = blockRemoteImages(
      '<img src="http://a/1"><img src="https://b/2">',
    );
    expect(r.blocked).toBe(2);
  });

  test("leaves data URIs and cid srcs alone", () => {
    const html = '<img src="data:image/png;base64,x"><img src="cid:z">';
    expect(blockRemoteImages(html).blocked).toBe(0);
    expect(blockRemoteImages(html).html).toBe(html);
  });
});
