// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { expect, test } from "vitest";

const source = readFileSync(new URL("../../convex/auth.config.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

function evaluate(values: Record<string, string>, throwForMissing = false) {
  const env = new Proxy(values, {
    get(target, name: string) {
      if (throwForMissing && !(name in target)) {
        throw new Error(`Environment variable ${name} was not set`);
      }
      return target[name];
    },
  });
  const exports: { default?: { providers: Record<string, unknown>[] } } = {};
  runInNewContext(outputText, { exports, process: { env } });
  return exports.default!.providers;
}

const clerkIssuer = "https://clerk.example.com";

test.each([false, true])("production auth works without the dev issuer (throwForMissing=%s)", (throwForMissing) => {
  expect(evaluate({ CLERK_JWT_ISSUER_DOMAIN: clerkIssuer }, throwForMissing)).toEqual([
    { domain: clerkIssuer, applicationID: "convex" },
  ]);
});

test("an explicitly configured dev issuer still works for local testing", () => {
  const devIssuer = "http://localhost:3000/api/dev-auth";
  expect(evaluate({ CLERK_JWT_ISSUER_DOMAIN: clerkIssuer, KITE_DEV_AUTH_ISSUER: devIssuer }, true)).toEqual([
    { domain: clerkIssuer, applicationID: "convex" },
    { type: "customJwt", issuer: devIssuer, jwks: `${devIssuer}/jwks`, applicationID: "convex", algorithm: "RS256" },
  ]);
});

test("cloud dev auth uses inline public keys instead of fetching localhost", () => {
  const devIssuer = "http://localhost:3000/api/dev-auth";
  const devJwks = "data:text/plain;charset=utf-8;base64,eyJrZXlzIjpbXX0=";
  expect(evaluate({
    CLERK_JWT_ISSUER_DOMAIN: clerkIssuer,
    KITE_DEV_AUTH_ISSUER: devIssuer,
    KITE_DEV_AUTH_JWKS: devJwks,
  }, true)).toEqual([
    { domain: clerkIssuer, applicationID: "convex" },
    { type: "customJwt", issuer: devIssuer, jwks: devJwks, applicationID: "convex", algorithm: "RS256" },
  ]);
});

test("inline keys alone do not enable dev auth", () => {
  expect(evaluate({
    CLERK_JWT_ISSUER_DOMAIN: clerkIssuer,
    KITE_DEV_AUTH_JWKS: "data:text/plain;base64,eyJrZXlzIjpbXX0=",
  }, true)).toEqual([{ domain: clerkIssuer, applicationID: "convex" }]);
});

test("missing required Clerk configuration is not swallowed", () => {
  expect(() => evaluate({}, true)).toThrow("CLERK_JWT_ISSUER_DOMAIN");
});
