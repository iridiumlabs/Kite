// Pure HTML string helpers used by the content pipeline. Deliberately
// regex-based and narrow: they run after sanitize-html has normalized the
// markup, so they only need to recognize well-formed tags.

// Replaces src="cid:..." / src='cid:...' / src=cid:... attribute values with
// the matching data URI. Returns the rewritten html and the number replaced.
export function rewriteCidReferences(
  html: string,
  cidToDataUri: Map<string, string>,
): { html: string; replaced: number } {
  let replaced = 0;
  const out = html.replace(
    /(\bsrc|\bhref)\s*=\s*(["']?)cid:([^"'\s>]+)\2/gi,
    (whole, attr: string, quote: string, cid: string) => {
      const decoded = decodeURIComponent(cid);
      const uri =
        cidToDataUri.get(decoded) ??
        cidToDataUri.get(cid) ??
        cidToDataUri.get(decoded.replace(/[<>]/g, ""));
      if (!uri) return whole;
      replaced++;
      const q = quote || '"';
      return `${attr}=${q}${uri}${q}`;
    },
  );
  return { html: out, replaced };
}

// Moves remote image URLs off `src` onto `data-src` so nothing loads until
// the reader opts in. Returns the rewritten html and how many were blocked.
export function blockRemoteImages(html: string): {
  html: string;
  blocked: number;
} {
  let blocked = 0;
  const out = html.replace(
    /<img\b([^>]*?)\bsrc\s*=\s*(["'])(https?:\/\/[^"']+)\2([^>]*)>/gi,
    (whole, pre: string, quote: string, url: string, post: string) => {
      blocked++;
      return `<img${pre}data-src=${quote}${url}${quote} src=""${post}>`;
    },
  );
  return { html: out, blocked };
}
