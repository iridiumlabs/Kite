"use node";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

const PREFIX = "v1";

export function encryptionKey(): Buffer {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is not set on this deployment",
    );
  }
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY is not valid base64",
    );
  }
  if (key.length !== 32) {
    throw new Error(
      "CREDENTIALS_ENCRYPTION_KEY must be 32 bytes encoded as base64",
    );
  }
  return key;
}

export function encryptPayload(plain: string, key?: Buffer): string {
  const k = key ?? encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

export function decryptPayload(payload: string, key?: Buffer): string {
  const k = key ?? encryptionKey();
  const parts = payload.split(":");
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error("Malformed credential payload");
  }
  const [, ivB64, tagB64, ctB64] = parts;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    k,
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function encryptCredentials(
  username: string,
  password: string,
): string {
  return encryptPayload(JSON.stringify({ username, password }));
}

export function decryptCredentials(payload: string): {
  username: string;
  password: string;
} {
  const parsed = JSON.parse(decryptPayload(payload)) as {
    username?: string;
    password?: string;
  };
  return {
    username: parsed.username ?? "",
    password: parsed.password ?? "",
  };
}
