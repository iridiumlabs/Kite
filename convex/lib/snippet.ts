const QUOTED_LINE_RE = /^\s*>+/;
const WROTE_LINE_RE = /^on\b.{0,120}\bwrote:?\s*$/i;
const SIG_DELIM_RE = /^--\s?$/;
const FROM_HEADER_RE =
  /^(from|sent|to|subject|date|cc)\s*:/i;

// Turns a plain-text body into a list snippet: quoted reply blocks,
// "On ... wrote:" headers and signature tails are stripped, whitespace is
// collapsed and the result is capped at 240 chars.
export function makeSnippet(text: string, max = 240): string {
  const out: string[] = [];
  let inQuote = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine;
    if (SIG_DELIM_RE.test(line)) break;
    if (WROTE_LINE_RE.test(line.trim())) {
      inQuote = true;
      continue;
    }
    if (QUOTED_LINE_RE.test(line)) {
      inQuote = true;
      continue;
    }
    if (inQuote) {
      // A quoted block ends at the first non-empty unquoted line, unless it
      // looks like a pasted header line of a forwarded message.
      if (line.trim() === "" || FROM_HEADER_RE.test(line.trim())) continue;
      inQuote = false;
    }
    out.push(line);
  }
  const joined = out.join(" ").replace(/\s+/g, " ").trim();
  return joined.slice(0, max);
}
