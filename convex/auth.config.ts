const providers: Record<string, unknown>[] = [
  {
    domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
    applicationID: "convex",
  },
];

// Development only: a test JWT issuer served by the Next dev server.
// Never set KITE_DEV_AUTH_ISSUER or KITE_DEV_AUTH_JWKS on production.
// Cloud dev deployments cannot fetch localhost; use a public-key data URI there.
// Convex's auth-config evaluator throws for unset environment variables.
// Only this optional dev issuer may be absent; Clerk's issuer remains required.
let devIssuer: string | undefined;
try {
  devIssuer = process.env.KITE_DEV_AUTH_ISSUER;
} catch {
  devIssuer = undefined;
}
if (devIssuer) {
  let devJwks: string | undefined;
  try {
    devJwks = process.env.KITE_DEV_AUTH_JWKS;
  } catch {
    devJwks = undefined;
  }
  providers.push({
    type: "customJwt",
    issuer: devIssuer,
    jwks: devJwks || `${devIssuer}/jwks`,
    applicationID: "convex",
    algorithm: "RS256",
  });
}

const config = { providers };
export default config;
