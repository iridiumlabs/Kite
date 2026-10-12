# Post

An Apple-inspired personal email client for multiple Spacemail IMAP/SMTP mailboxes. Built with Next.js 16, Clerk, Convex and Jev, with the same backend functions exposed through a remote MCP server.

## Development

1. Install dependencies with `npm ci`.
2. Configure `.env.local` using `.env.example`.
3. Run `npm run convex:dev` and `npm run dev` in separate terminals.
4. Set the Convex deployment environment variables listed in `.env.example`. The credentials encryption key must be a securely generated, base64-encoded 32-byte key. Keep it stable: changing it does not re-encrypt existing mailbox passwords.
5. Configure Clerk's Convex JWT integration and `CLERK_JWT_ISSUER_DOMAIN` on the Convex deployment.

Server-side mail connections are restricted to the exact Spacemail (`mail.spacemail.com`) and live-test Ethereal (`imap.ethereal.email`, `smtp.ethereal.email`) endpoints. IMAP requires TLS on port 993; SMTP uses TLS on 465 or mandatory STARTTLS on 587. Arbitrary hosts, private-network targets and other ports are rejected.

`EXPERIENTIAL_API_KEY` enables Jev classification. Without it, ingest uses deterministic Primary/Other heuristics and records classification for a bounded later retry. Retry category descriptions are captured at ingest, so subsequent category edits do not retroactively categorize old mail. Manual corrections take precedence over retries.

See `AGENTS.md` for the architecture, data-I/O rules and local dev-auth harness. Dev auth is test-only. Never enable `POST_DEV_AUTH`, `NEXT_PUBLIC_POST_DEV_AUTH` or `POST_DEV_AUTH_ISSUER` in production.

## Profile and privacy

General Settings lets you edit your name and upload/remove a profile photo. Production changes are saved to your Clerk account; enable first/last name editing in Clerk. The test-only dev-auth profile is explicitly browser-local. Profile photos are validated and rasterized before upload, stored by Clerk in production, and never placed in the mail database. Mailbox sender names remain separate in Connections.

Remote images are off by default to limit email-open tracking. Embedded images and attachments still work. The default account controls new-message sending; choosing First account clears an explicit sender preference. Use the shared `components/ui/Select.tsx` for dropdowns, not native browser selects.

## Verification

```sh
npm run typecheck
npm run lint
npm test -- --maxWorkers=4
npm run build
```

Opt-in live suites require a local Convex backend at `127.0.0.1:3210`. They create temporary Ethereal accounts, send test messages, and clean up their own test resources. They are not production tests and do not establish Spacemail or Clerk production compatibility.

- `npx tsx scripts/live-e2e.ts`: wire-level sync, moves, flags, bodies, attachments, sending and cleanup.
- `npx tsx scripts/live-ui-e2e.ts`: browser interaction, inline CID images, quotes, dialog layering, snooze, scheduling/cancellation, multiple mailboxes and responsive navigation. Requires Next dev at `localhost:3000` and the dev-auth harness.
- `npx tsx scripts/live-appearance.ts`: focused profile/Settings/palette appearance persistence across navigation, reloads and fresh browser contexts, plus the current-origin MCP URL. Requires the local dev-auth harness and restores the test user's original theme.
- `npx tsx scripts/live-compose-controls.ts`: repeated Compose clicks, minimized-window restoration, preserved editor text and borderless-field/keyboard focus styling. Requires the local dev-auth harness; never sends mail and discards only its own test draft.
- `npx tsx scripts/live-profile-settings.ts`: dev profile editing/avatar validation and removal, styled dropdown/keyboard dismissal, switch layout and phone Settings. Restores modified mail preferences and changes only its isolated browser-local dev profile; no email is sent.
- `npx tsx scripts/live-mcp.ts`: real HTTP MCP tool coverage. Set `POST_MCP_URL=http://localhost:3000` to reuse an existing Next server. The default starts its own server and requires that no other Next dev process holds the project's dev lock.
- `npx tsx scripts/screenshots.ts`: fresh `/dev/preview` captures in `artifacts/screens/`, compared with the Paper exports in `design/`.

Live wire, MCP and browser suites use separate test owners. Artifacts, backend state and environment files are ignored by Git. API keys are masked in new browser screenshots.

## Deployment

Follow [the Vercel deployment guide](DEPLOYMENT.md) for ordered Clerk/Convex setup, environment variables, the build command, production checks and MCP client configuration.

The MCP endpoint deploys with the app at `https://YOUR_HOST/api/mcp`. Settings displays the current site's origin, so localhost is expected while developing. Open Settings on your deployed site to get the production URL. Connect with a production `post_sk_` key using `Authorization: Bearer YOUR_KEY`. Post exposes 37 tools, including scheduled-send cancellation and explicit uncertain-delivery resolution. Keys are shown once, stored hashed, and can be revoked in Settings.

Ambiguous SMTP delivery locks the draft and send reservation to prevent accidental retries. After verifying delivery evidence, reopen the draft and explicitly confirm delivery (remove the stale draft) or non-delivery (unlock without sending). An empty Sent folder alone does not prove non-delivery; retrying may send duplicates. Active attempts remain locked; crashed attempts become resolvable after 15 minutes. MCP offers `list_uncertain_send_attempts` (by draft or account), `resolve_uncertain_draft`, and `resolve_uncertain_send` for draftless direct sends; explicit user confirmation and the selected reservation ID are required. A retry needs a new idempotency key. Known SMTP acceptance also has durable, SMTP-free recovery: if an action stops before finalization, a scheduled mutation files the accepted recipients and unlocks only rejected recipients after the action deadline.

Inline MCP send attachments are uploaded through the authenticated Convex HTTP file endpoint before sending, so attachment bytes do not enter Node-action arguments. Temporary send inputs expire after 24 hours; 25 MB total applies. Direct Convex callers may use inline data within the ordinary action argument limit, or upload files to `/send-attachment` and pass storage references.

Message bodies and received attachments remain on IMAP, not in Convex. Imported/forwarded draft attachments are copied to owned storage before remote replacement or sending so draft cleanup cannot invalidate retry attachments. Received attachment downloads and forwarding are limited to 10 MB to leave headroom under Convex function-return limits. Configured account signatures are inserted when opening a fresh composer; existing draft bodies are preserved. Reader content is cached in a bounded client-side cache. Fresh IMAP connections can still take several seconds; the reader supplies loading, timeout and retry feedback rather than retaining a permanent skeleton.
