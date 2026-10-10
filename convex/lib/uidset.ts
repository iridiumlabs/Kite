// Range-encoded UID set ("1-40,42,50-61") plus a parallel flags string where
// character i holds the flag bitmask (as a single digit) of the i-th UID in
// ascending order.

export type UidRange = [number, number];

export function parseUidSet(s: string): UidRange[] {
  const ranges: UidRange[] = [];
  if (!s) return ranges;
  for (const part of s.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const dash = trimmed.indexOf("-");
    if (dash === -1) {
      const n = parseInt(trimmed, 10);
      ranges.push([n, n]);
    } else {
      ranges.push([
        parseInt(trimmed.slice(0, dash), 10),
        parseInt(trimmed.slice(dash + 1), 10),
      ]);
    }
  }
  return normalize(ranges);
}

export function formatUidSet(ranges: UidRange[]): string {
  return ranges
    .map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`))
    .join(",");
}

function normalize(ranges: UidRange[]): UidRange[] {
  const sorted = ranges
    .filter(([a, b]) => a <= b)
    .sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const out: UidRange[] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1) {
      if (b > last[1]) last[1] = b;
    } else {
      out.push([a, b]);
    }
  }
  return out;
}

export function addUid(ranges: UidRange[], uid: number): UidRange[] {
  return normalize([...ranges, [uid, uid]]);
}

export function addUids(ranges: UidRange[], uids: Iterable<number>): UidRange[] {
  const extra: UidRange[] = [];
  for (const uid of uids) extra.push([uid, uid]);
  return normalize([...ranges, ...extra]);
}

export function removeUid(ranges: UidRange[], uid: number): UidRange[] {
  return removeUids(ranges, [uid]);
}

export function removeUids(
  ranges: UidRange[],
  uids: Iterable<number>,
): UidRange[] {
  const drop = new Set(uids);
  const out: UidRange[] = [];
  for (const [a, b] of ranges) {
    if (drop.has(a) || drop.has(b) || (a < b && hasIn(drop, a, b))) {
      // Split around removed uids.
      let start = a;
      for (let u = a; u <= b; u++) {
        if (drop.has(u)) {
          if (start <= u - 1) out.push([start, u - 1]);
          start = u + 1;
        }
      }
      if (start <= b) out.push([start, b]);
    } else {
      out.push([a, b]);
    }
  }
  return out;
}

function hasIn(set: Set<number>, a: number, b: number): boolean {
  for (const v of set) if (v >= a && v <= b) return true;
  return false;
}

export function* uids(ranges: UidRange[]): Generator<number> {
  for (const [a, b] of ranges) {
    for (let u = a; u <= b; u++) yield u;
  }
}

export function uidCount(ranges: UidRange[]): number {
  let n = 0;
  for (const [a, b] of ranges) n += b - a + 1;
  return n;
}

export function containsUid(ranges: UidRange[], uid: number): boolean {
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const [a, b] = ranges[mid];
    if (uid < a) hi = mid - 1;
    else if (uid > b) lo = mid + 1;
    else return true;
  }
  return false;
}

export function maxUid(ranges: UidRange[]): number | undefined {
  const last = ranges[ranges.length - 1];
  return last ? last[1] : undefined;
}

export function minUid(ranges: UidRange[]): number | undefined {
  const first = ranges[0];
  return first ? first[0] : undefined;
}

// UIDs in `stored` that are not in `server`, and UIDs in `server` not in
// `stored`. Returned as range lists.
export function diffUidSets(
  stored: UidRange[],
  server: UidRange[],
): { vanished: UidRange[]; added: UidRange[] } {
  return { vanished: subtract(stored, server), added: subtract(server, stored) };
}

function subtract(a: UidRange[], b: UidRange[]): UidRange[] {
  const out: UidRange[] = [];
  let j = 0;
  for (const [a0, a1] of a) {
    let start = a0;
    while (j < b.length && b[j][1] < start) j++;
    let k = j;
    while (k < b.length && b[k][0] <= a1) {
      const [b0, b1] = b[k];
      if (b0 > start) out.push([start, Math.min(b0 - 1, a1)]);
      if (b1 >= a1) {
        start = a1 + 1;
        break;
      }
      start = b1 + 1;
      k++;
    }
    if (start <= a1) out.push([start, a1]);
  }
  return out;
}

// Index of `uid` within the ascending UID sequence, or -1.
export function uidIndex(ranges: UidRange[], uid: number): number {
  let idx = 0;
  for (const [a, b] of ranges) {
    if (uid < a) return -1;
    if (uid <= b) return idx + (uid - a);
    idx += b - a + 1;
  }
  return -1;
}

export function getFlags(flags: string, ranges: UidRange[], uid: number): number {
  const idx = uidIndex(ranges, uid);
  if (idx === -1) return 0;
  return flags.charCodeAt(idx) - 48;
}

// Returns the updated flags string. No-op if uid is not in the set.
export function setFlags(
  flags: string,
  ranges: UidRange[],
  uid: number,
  mask: number,
): string {
  const idx = uidIndex(ranges, uid);
  if (idx === -1) return flags;
  const cur = flags.charCodeAt(idx) - 48;
  if (cur === mask) return flags;
  return flags.slice(0, idx) + String(mask) + flags.slice(idx + 1);
}

// Re-aligns a flags string from `oldRanges` to `newRanges`: retained UIDs keep
// their bits, new UIDs get 0.
export function realignFlags(
  flags: string,
  oldRanges: UidRange[],
  newRanges: UidRange[],
): string {
  const map = new Map<number, string>();
  let i = 0;
  for (const uid of uids(oldRanges)) {
    map.set(uid, flags[i++] ?? "0");
  }
  const out: string[] = [];
  for (const uid of uids(newRanges)) {
    out.push(map.get(uid) ?? "0");
  }
  return out.join("");
}

export function emptyFlags(ranges: UidRange[]): string {
  return "0".repeat(uidCount(ranges));
}
