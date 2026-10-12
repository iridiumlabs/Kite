const providers: Record<string, unknown>[] = [
  {
    domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
    applicationID: "convex",
  },
];

// Local development only: a test JWT issuer served by the Next dev server.
// Never set KITE_DEV_AUTH_ISSUER on a production deployment.
// Convex's auth-config evaluator throws for unset environment variables.
// Only this optional dev issuer may be absent; Clerk's issuer remains required.
let devIssuer: string | undefined;
try {
  devIssuer = process.env.KITE_DEV_AUTH_ISSUER;
} catch {
  devIssuer = undefined;
}
if (devIssuer) {
  providers.push({
    type: "customJwt",
    issuer: devIssuer,
    jwks: `${devIssuer}/jwks`,
    applicationID: "convex",
    algorithm: "RS256",
  });
}

const config = { providers };
export default config;
