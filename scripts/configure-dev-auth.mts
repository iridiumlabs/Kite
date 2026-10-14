// Sync only the public verification key to the selected Convex dev deployment.
// The private signing key stays in .env.local, never on Convex.
import nextEnv from "@next/env";
import { createPublicKey } from "node:crypto";
import { spawnSync } from "node:child_process";

nextEnv.loadEnvConfig(process.cwd(), true);

const deployment = process.env.CONVEX_DEPLOYMENT?.split(/\s/)[0];
if (!deployment?.startsWith("dev:") && !deployment?.startsWith("local:")) {
  throw new Error("Select a dev or local CONVEX_DEPLOYMENT in .env.local first. Production is not supported.");
}
if (process.env.KITE_DEV_AUTH !== "1" || process.env.NEXT_PUBLIC_KITE_DEV_AUTH !== "1") {
  throw new Error("Enable KITE_DEV_AUTH=1 and NEXT_PUBLIC_KITE_DEV_AUTH=1 in .env.local first.");
}
const privateKey = process.env.KITE_DEV_AUTH_PRIVATE_KEY;
if (!privateKey) throw new Error("KITE_DEV_AUTH_PRIVATE_KEY is missing from .env.local.");
const key = createPublicKey(Buffer.from(privateKey, "base64").toString("utf8"));
if (key.asymmetricKeyType !== "rsa") throw new Error("Dev auth requires an RSA key.");
const jwks = JSON.stringify({ keys: [{
  ...key.export({ format: "jwk" }),
  use: "sig", alg: "RS256", kid: "kite-dev-key-1",
}] });
const uri = `data:text/plain;charset=utf-8;base64,${Buffer.from(jwks).toString("base64")}`;
const issuer = process.env.KITE_DEV_AUTH_ISSUER ?? "http://localhost:3000/api/dev-auth";
const cli = new URL("../node_modules/convex/bin/main.js", import.meta.url);
const { fileURLToPath } = await import("node:url");
for (const [name, value] of [["KITE_DEV_AUTH_JWKS", uri], ["KITE_DEV_AUTH_ISSUER", issuer]]) {
  const result = spawnSync(process.execPath, [fileURLToPath(cli), "env", "set", name, value], {
    stdio: "inherit",
    env: { ...process.env, CONVEX_DEPLOYMENT: deployment },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log("Dev auth configured. Run npx convex dev --once to push auth.config.ts, then reload the app.");
