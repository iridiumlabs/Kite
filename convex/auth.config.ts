const providers: Record<string, unknown>[] = [
  {
    domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
    applicationID: "convex",
  },
];

// Local development only: a test JWT issuer served by the Next dev server.
// Never set KITE_DEV_AUTH_ISSUER on a production deployment.
if (process.env.KITE_DEV_AUTH_ISSUER) {
  providers.push({
    type: "customJwt",
    issuer: process.env.KITE_DEV_AUTH_ISSUER,
    jwks: `${process.env.KITE_DEV_AUTH_ISSUER}/jwks`,
    applicationID: "convex",
    algorithm: "RS256",
  });
}

const config = { providers };
export default config;
