// String-based quote splitting for message bodies. These heuristics are
// intentionally conservative: they only split at markers mainstream clients
// reliably emit, so a false positive would have to look exactly like a
// real quote boundary.

// Find the index where the quoted tail of an HTML body starts, or -1.
// Handles Gmail (.gmail_quote), generic <blockquote type="cite">, Mozilla
// (.moz-cite-prefix), Outlook (divRplyFwdMsg and the "From: ... Sent:" block)
// and Apple Mail ("On ... wrote:" immediately followed by a blockquote).
export function htmlQuoteStart(html: string): number {
  const patterns: RegExp[] = [
    /<div[^>]*class="[^"]*gmail_quote[^"]*"[^>]*>/i,
    /<blockquote[^>]*type\s*=\s*["']?cite["']?[^>]*>/i,
    /<div[^>]*class="[^"]*moz-cite-prefix[^"]*"[^>]*>/i,
    /<div[^>]*id="[^"]*divRplyFwdMsg[^"]*"[^>]*>/i,
    /<(div|p|span)[^>]*>\s*<b[^>]*>\s*From\s*:\s*<\/b>/i,
    /<div[^>]*>\s*On\b[^<]{0,200}\bwrote:\s*<\/div>\s*<blockquote/i,
    /On\b[^<]{0,200}\bwrote:\s*<br\s*\/?>\s*<blockquote/i,
  ];
  let best = -1;
  for (const re of patterns) {
    const m = re.exec(html);
    if (m && (best === -1 || m.index < best)) best = m.index;
  }
  return best;
}

export function splitHtmlQuote(html: string): {
  html: string;
  quotedHtml?: string;
} {
  const idx = htmlQuoteStart(html);
  if (idx <= 0) return { html };
  return { html: html.slice(0, idx), quotedHtml: html.slice(idx) };
}

const QUOTED_LINE_RE = /^\s*>/;
const WROTE_LINE_RE = /^\s*on\b.{0,200}\bwrote:\s*$/i;
const FWD_HEADER_RE = /^\s*-{2,}\s*(forwarded|original)/i;
const OUTLOOK_HEADER_RE = /^\s*_{5,}\s*$/;

// Splits the trailing quoted section off a plain-text body: a run of ">"
// lines (or an "On ... wrote:" line that introduces one) at the end of the
// message. Quoted text in the middle is left alone.
export function splitTextQuote(text: string): {
  text: string;
  quotedText?: string;
} {
  const lines = text.split("\n");
  let cut = -1;
  let i = lines.length - 1;
  // Walk back over trailing blank and quoted lines.
  let sawQuoted = false;
  while (i >= 0) {
    const line = lines[i];
    if (line.trim() === "") {
      i--;
      continue;
    }
    if (QUOTED_LINE_RE.test(line)) {
      sawQuoted = true;
      i--;
      continue;
    }
    if (sawQuoted && (WROTE_LINE_RE.test(line) || OUTLOOK_HEADER_RE.test(line) || FWD_HEADER_RE.test(line))) {
      i--;
    }
    break;
  }
  if (sawQuoted) {
    cut = i + 1;
    // Include the "On ... wrote:" introducer when it directly precedes.
    while (cut > 0 && lines[cut - 1].trim() === "") cut--;
    if (cut > 0 && WROTE_LINE_RE.test(lines[cut - 1])) cut--;
  }
  if (cut === -1 || cut === 0) return { text };
  return {
    text: lines.slice(0, cut).join("\n"),
    quotedText: lines.slice(cut).join("\n"),
  };
}
