import type { MessageContent } from "./types";

const MAX = 50;
const cache = new Map<string, MessageContent>();
const inflight = new Set<string>();

export function getCached(id: string): MessageContent | undefined {
  const v = cache.get(id);
  if (v) {
    // LRU touch
    cache.delete(id);
    cache.set(id, v);
  }
  return v;
}

export function setCached(id: string, content: MessageContent) {
  cache.set(id, content);
  if (cache.size > MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

export function markInflight(id: string): boolean {
  if (inflight.has(id)) return false;
  inflight.add(id);
  return true;
}

export function clearInflight(id: string) {
  inflight.delete(id);
}

export function evictCached(id: string) {
  cache.delete(id);
}
