import type { MessageContent } from "./types";

const MAX = 50;
const cache = new Map<string, MessageContent>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();
const keyFor = (id: string, loadRemoteImages: boolean) => JSON.stringify([id, loadRemoteImages]);
let version = 0;
function notify() {
  version++;
  for (const listener of listeners) listener();
}
export function subscribeContent(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const contentSnapshot = () => version;
export const serverContentSnapshot = () => 0;

export function getCached(id: string, loadRemoteImages = false): MessageContent | undefined {
  const key = keyFor(id, loadRemoteImages);
  const value = cache.get(key);
  if (value) {
    cache.delete(key);
    cache.set(key, value);
  }
  return value;
}

export function setCached(id: string, content: MessageContent, loadRemoteImages = content.loadRemoteImages ?? false) {
  cache.set(keyFor(id, loadRemoteImages), content);
  if (cache.size > MAX) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  notify();
}

export function markInflight(id: string, loadRemoteImages = false): boolean {
  const key = keyFor(id, loadRemoteImages);
  if (inflight.has(key) || inflight.size >= 3) return false;
  inflight.add(key);
  return true;
}

export function clearInflight(id: string, loadRemoteImages = false) {
  // Wake policy-changed readers that were waiting for request capacity.
  if (inflight.delete(keyFor(id, loadRemoteImages))) notify();
}

export function evictCached(id: string) {
  cache.delete(keyFor(id, false));
  cache.delete(keyFor(id, true));
  notify();
}
