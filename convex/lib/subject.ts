const PREFIX_RE = /^\s*(re|fw|fwd|aw|wg)\s*:\s*/i;

// Strips reply/forward prefixes repeatedly; bracketed tags like "[List]" are
// kept. Also handles the "Re[2]:" style counters.
export function normalizeSubject(subject: string | undefined | null): string {
  let s = (subject ?? "").trim();
  let prev: string;
  do {
    prev = s;
    s = s.replace(PREFIX_RE, "").replace(/^\s*(re|fw|fwd)\[\d+\]\s*:\s*/i, "");
    s = s.trim();
  } while (s !== prev && s.length > 0);
  return s;
}

export function replySubject(subject: string | undefined | null): string {
  const base = normalizeSubject(subject);
  return `Re: ${base}`;
}

export function forwardSubject(subject: string | undefined | null): string {
  const base = normalizeSubject(subject);
  return `Fwd: ${base}`;
}
