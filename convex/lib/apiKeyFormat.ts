import { sha256Hex } from "./idempotency";

const BASE62 =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const API_KEY_PREFIX = "kite_sk_";

export function randomBase62(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const b of bytes) out += BASE62[b % 62];
  return out;
}

// Raw key is shown to the user exactly once; only the sha256 hash and a
// display prefix are stored.
export async function generateApiKey(): Promise<{
  key: string;
  hash: string;
  prefix: string;
}> {
  const key = API_KEY_PREFIX + randomBase62(32);
  const hash = await sha256Hex(key);
  return { key, hash, prefix: displayPrefix(key) };
}

export function displayPrefix(key: string): string {
  return `${key.slice(0, 12)}...${key.slice(-4)}`;
}

export async function hashApiKey(key: string): Promise<string> {
  return sha256Hex(key);
}
