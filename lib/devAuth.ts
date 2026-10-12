import "server-only";
import { createPublicKey, sign } from "node:crypto";

const ISSUER = () =>
  process.env.POST_DEV_AUTH_ISSUER ?? "http://localhost:3000/api/dev-auth";
const KID = "post-dev-key-1";
const SUBJECT = "live-e2e-user";

export function devAuthEnabled(): boolean {
  return (
    process.env.NODE_ENV === "development" &&
    process.env.POST_DEV_AUTH === "1" &&
    !!process.env.POST_DEV_AUTH_PRIVATE_KEY
  );
}

function privateKeyPem(): string {
  const b64 = process.env.POST_DEV_AUTH_PRIVATE_KEY;
  if (!b64) throw new Error("POST_DEV_AUTH_PRIVATE_KEY is not set");
  return Buffer.from(b64, "base64").toString("utf8");
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function jwks(): { keys: Record<string, unknown>[] } {
  const jwk = createPublicKey(privateKeyPem()).export({ format: "jwk" });
  return {
    keys: [
      {
        ...jwk,
        use: "sig",
        alg: "RS256",
        kid: KID,
      },
    ],
  };
}

export function signDevToken(ttlSeconds = 3600): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT", kid: KID }));
  const payload = b64url(
    JSON.stringify({
      iss: ISSUER(),
      sub: SUBJECT,
      aud: "convex",
      iat: now,
      exp: now + ttlSeconds,
      name: "Dev user",
      email: "dev@post.local",
    }),
  );
  const data = `${header}.${payload}`;
  const signature = sign("RSA-SHA256", Buffer.from(data), privateKeyPem());
  return `${data}.${b64url(signature)}`;
}
