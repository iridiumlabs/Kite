# Deploy Kite to Vercel

## Where the MCP server runs

Kite already has a Node.js, Streamable HTTP MCP endpoint at `/api/mcp`. It deploys with the Next.js app as a Vercel Function. Vercel forwards authenticated tool calls to the same Convex functions used by the web UI. Convex handles the database, scheduled sync, Jev classification and IMAP/SMTP actions.

Settings builds the MCP URL from the current browser origin:

- Local development: `http://localhost:3000/api/mcp`
- Deployed app: `https://kite.example.com/api/mcp`, or your Vercel deployment's `/api/mcp`

Open Settings on the deployed site to copy the production URL and client configuration. Nothing needs to keep running on your laptop. This implementation uses MCP API-key authentication, not an OAuth login flow. Use a client that supports Streamable HTTP and a configurable Bearer token. No separate MCP service or Redis deployment is needed.

## 1. Prepare Clerk production authentication

1. Choose a stable domain you own, such as `kite.example.com`. Configure it in Vercel and create/configure the production instance of your Clerk application. Clerk production setup requires an owned domain and its DNS records; a Vercel preview URL alone is not a replacement for this setup.
2. Complete Clerk's domain/DNS verification and configure any production OAuth providers you want to use.
3. Activate Clerk's Convex integration for the production instance. If using the JWT-template setup, the template must be named `convex` and have audience `convex`, matching `convex/auth.config.ts`.
4. Copy the production publishable key, secret key and Frontend API / JWT issuer URL. Use the exact issuer from Clerk, not your Kite URL or the local dev-auth URL.

Enable **First and last name** editing in Clerk's user attributes so General Settings can save names. Profile photo upload/removal uses Clerk's authenticated user API; verify these controls on the deployed site. The local dev-auth harness uses only a browser-local test profile and is not a test of Clerk persistence.

Clerk development and production identities are separate. The dev-auth test user and its local mailbox records/API keys do not automatically become production data.

## 2. Prepare the Convex production deployment

Create/select a **Convex cloud project** and its **production** deployment in the Convex dashboard. This must not be the anonymous local backend at `127.0.0.1:3210`. Set these variables in that deployment's environment settings, not in browser-visible Vercel variables:

| Variable | Value |
| --- | --- |
| `CLERK_JWT_ISSUER_DOMAIN` | Production Clerk issuer / Frontend API URL |
| `CREDENTIALS_ENCRYPTION_KEY` | Securely generated 32-byte key encoded as base64 |
| `EXPERIENTIAL_API_KEY` | Your Experiential Labs API key for Jev |
| `JEV_MODEL` | Optional; defaults to `jev-latest` |

You can generate an encryption key locally with Node, then store it in a password manager and the Convex dashboard:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Do not paste the generated value into chat, Git or public configuration. Keep it backed up and stable. Replacing it does not re-encrypt existing passwords and will prevent their decryption. A fresh production deployment should use its own key; reconnect mailboxes there rather than copying development secrets/data blindly.

Jev is optional for startup: without its API key, incoming mail uses the documented heuristic fallback. Add the key for actual Jev classification and verify it after deployment.

Remove `KITE_DEV_AUTH_ISSUER` from production Convex environment settings. This is essential: that variable enables the development JWT issuer in the backend.

Generate a **Production Deploy Key** in the production deployment's settings, with the `deployment:deploy` permission. Store it securely for the next step.

## 3. Configure the Vercel project

Import this repository, choose the Next.js framework preset, use the repository root, and use a supported Node.js version (Node 24 was used for local verification). Installation is `npm ci`.

Set Vercel's Production Branch to `main` and ensure it contains the completed app changes. Git deployments require committed, published code; Vercel cannot deploy local-only edits or commits.

Set these Vercel environment variables for **Production**:

| Variable | Value |
| --- | --- |
| `CONVEX_DEPLOY_KEY` | The Convex production deploy key |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk production publishable key |
| `CLERK_SECRET_KEY` | Clerk production secret key |

The committed `vercel.json` sets the Next.js framework preset, `npm ci` install command, and this **Build Command** automatically; no dashboard command override is needed:

```sh
npx convex deploy --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL --cmd "npm run build"
```

This deploys the Convex schema/functions/auth configuration/crons as well as building Next.js. It injects the correct production Convex URL as `NEXT_PUBLIC_CONVEX_URL` during the build, which is used by both the browser and MCP route. Do not retain a localhost `NEXT_PUBLIC_CONVEX_URL`. If you choose to deploy Convex separately and use only `npm run build`, you must explicitly set `NEXT_PUBLIC_CONVEX_URL` to that production deployment's HTTPS URL.

Do not upload `.env.local`, copy its local `CONVEX_DEPLOYMENT`, or set either `KITE_DEV_AUTH` or `NEXT_PUBLIC_KITE_DEV_AUTH` on Vercel. Leave all dev-auth flags unset, including for preview builds. Never give an untrusted preview build the production deploy key.

Deploy, attach your stable custom domain, and redeploy after changing build-time variables. Verify that the production Clerk configuration matches the domain you are actually using.

## 4. Connect mailboxes and MCP clients

1. Sign in on the production Kite site with Clerk.
2. Connect your Spacemail mailboxes in Settings > Connections. Passwords are encrypted in production Convex; no IMAP/SMTP password is needed in Vercel environment variables.
3. Check initial sync, incoming mail, attachments and a test send/reply with your actual provider.
4. Open Settings > MCP & API Keys on that same production domain. Create a named API key and copy it immediately; it is shown once.
5. Configure the MCP client with the displayed HTTPS URL, **Streamable HTTP**, and:

   ```text
   Authorization: Bearer kite_sk_YOUR_KEY
   ```

   Use the complete generated Kite key, not your Clerk secret or Convex deploy key. Keep it in the client's secret storage/environment, never in a committed config file. Each key grants access to its owner's mailboxes; revoke it in Settings if exposed.

For example, Claude Code accepts:

```sh
claude mcp add --transport http kite https://kite.example.com/api/mcp --header "Authorization: Bearer kite_sk_YOUR_KEY"
```

Settings also generates configuration snippets for other supported clients. Use a stable production hostname rather than an expiring preview deployment URL.

## 5. Production checks and troubleshooting

- `/api/dev-auth/token` and `/api/dev-auth/jwks` must return 404. `/dev/preview` must also return 404.
- A POST to `/api/mcp` without a Kite API key should reach Kite and return 401, not an HTML login page. With a valid key, connect using an MCP client/Inspector and list the 34 tools. Test a read-only tool before sending anything.
- If Vercel Deployment Protection intercepts requests, use a production domain accessible to the client or configure Vercel's automation bypass securely. A Kite API key does not bypass Vercel's separate deployment protection. Keep Kite's own API-key authentication enabled.
- Missing-key/unknown-key/revoked-key 401 responses are expected. Local development keys are not valid against a separate production Convex database.
- Authenticated web queries failing usually indicate a Clerk issuer/audience mismatch, missing Convex integration, or a frontend connected to the wrong deployment.
- IMAP/SMTP and Jev run in Convex, not Vercel. Inspect Convex action logs for provider failures and Vercel function logs for HTTP/MCP failures. Do not share credentials, API keys or private message contents in logs.
- The MCP route currently declares `maxDuration = 60` seconds in `app/api/mcp/route.ts`. Large sync/backfill/content operations can exceed that HTTP budget. Review this setting and your Vercel plan's limits if needed. An HTTP timeout does not necessarily cancel backend work; inspect state before retrying sends, and use idempotency keys.
- Preview deployments should use a separate Convex preview deploy key and appropriate non-production Clerk/backend configuration. Do not share production mail data or production credentials with previews.

Local tests have verified the backend and MCP protocol against Ethereal, not a deployed Vercel/Clerk/Spacemail environment. Run the checks above before relying on production mail delivery.

## References

- [Convex on Vercel](https://docs.convex.dev/production/hosting/vercel)
- [Clerk and Convex](https://docs.convex.dev/auth/clerk)
- [Clerk production deployment](https://clerk.com/docs/guides/development/deployment/production)
- [Deploy MCP servers on Vercel](https://vercel.com/docs/mcp/deploy-mcp-servers-to-vercel)
