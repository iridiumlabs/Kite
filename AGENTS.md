# Post: architecture and conventions

Post is a personal, Apple-inspired email client for multiple Spacemail (IMAP/SMTP) mailboxes,
with Jev-powered inbox classification and a first-class remote MCP server.

Stack: Next.js 16 (App Router) + TypeScript + Tailwind v4, Clerk (auth), Convex (backend + DB),
deployed on Vercel. Design source of truth: `design/` (Paper exports: PNG screenshots + JSX with
exact colors, spacing, SVG icon paths; the hidden profile menu is at the end of
`design/inbox-selected.jsx.txt`).

## Product rules (non-negotiable)

- Every received email that is not archived/trashed belongs to exactly one of **Primary** or **Other**.
- Custom categories (name + natural-language description) are independent of Primary/Other.
  An email can be in 0..n categories.
- Classification is done by Jev (Experiential Labs) at ingest time. Adding/editing categories never
  reclassifies existing mail. Manual changes are allowed; no learning from corrections.
- Archiving removes a thread from Primary, Other and every category view, but keeps its
  classification and categories so restoring brings it back where it was.
- Sent, Drafts, Archive, Trash are separate views. Spacemail is the source of truth for content.
- The web UI and the MCP server call the **same Convex functions**. Never fork business logic.
- No em dashes anywhere in UI copy, tool descriptions, or docs.

## Data flow

```
Browser (Convex React client, Clerk JWT) ─┐
                                          ├─> Convex public functions (auth: Clerk identity OR apiKey arg)
MCP route /api/mcp (Vercel, API key) ─────┘        │
                                                   ├─ DB (metadata, previews, counters, sync state)
                                                   └─ "use node" actions ─ IMAP (imapflow) / SMTP (nodemailer) ─ Spacemail
```

### Auth (shared)
Every public Convex function accepts an optional `apiKey?: string`. `convex/model/auth.ts`
`requireUserId(ctx, apiKey)` resolves the owner: API key (sha256 hash lookup on `apiKeys.by_hash`,
must not be revoked) or Clerk identity (`identity.subject`). `userId` is the Clerk subject string;
there is no users table. API keys: `post_sk_` + 32 random bytes base62, shown once, only the hash
and a display prefix are stored. `lastUsedAt` is written at most once per hour.

### Credentials
IMAP/SMTP passwords are encrypted with AES-256-GCM (`CREDENTIALS_ENCRYPTION_KEY`, 32 bytes
base64, Convex env) and stored in `accountSecrets`, a table never read by public queries. Only
Node actions decrypt. Credentials are never returned to clients or MCP.

## Database I/O rules (the user pays Convex overage for DB I/O)

- Message bodies and attachments are never stored in Convex. Bodies are fetched from IMAP on
  demand and cached client-side. Only compose-time attachment uploads use Convex file storage
  (deleted after send/discard).
- List views read `threads` (small denormalized docs) through indexes with pagination
  (page size 50). Never `.collect()` an unbounded set; never `.filter()` without a bounding index.
- Sidebar counts come from `counters` docs maintained transactionally by `writeThread`
  (diff of before/after contributions). No count scans.
- Category views read `threadCategories` join rows (indexed by category + inInbox + time).
- Writes are skipped when nothing changed (`writeThread` deep-compares). Sync never writes
  heartbeat timestamps on no-op runs.
- Per-folder sync state stores a range-encoded UID set and a compact flag string, so sync diffs
  are computed in the action and only changed messages are touched.

## Sync design (serverless)

- No IMAP IDLE (no long-lived processes). A Convex cron every 2 minutes schedules
  `syncAccount` per active account; the client also requests a sync on window focus (throttled)
  and after user actions. One lease per account (`syncLocks`) serializes sync and pending-op
  processing so they never race.
- Per folder (INBOX, Sent, Drafts, Archive, Trash, Junk; discovered by SPECIAL-USE with name
  fallbacks): STATUS, compare UIDVALIDITY / UIDNEXT / HIGHESTMODSEQ / MESSAGES / UNSEEN with stored
  state; skip unchanged folders entirely. New UIDs are fetched and ingested; vanished UIDs come
  from `UID SEARCH` vs the stored UID set; flag changes via CONDSTORE `CHANGEDSINCE` when
  available, otherwise a flags fetch when UNSEEN changed or every 10 minutes.
- Moves are reconciled account-wide: a new UID whose Message-ID matches a message whose old
  location vanished in the same run is a move (doc is patched, classification preserved).
- UIDVALIDITY change: remap the folder by Message-ID, drop what is gone.
- Initial sync is windowed (newest ~300 INBOX, ~200 Sent, ~100 others); older mail is backfilled
  on demand (scroll / MCP) and deep search uses IMAP SEARCH and ingests hits.
- UI/MCP mutations update Convex immediately and enqueue `pendingOps`; an action applies them to
  IMAP (flags, MOVE with COPYUID remap, expunge, draft append/delete) with retries and backoff.

## Threading
Per account. `threadRefs` maps every normalized Message-ID seen (own id + In-Reply-To +
References) to a thread. Ingest looks up all refs; none -> new thread; several threads -> merge
into the oldest. Out-of-order arrival is handled because referenced ids are registered too.

## Classification (Jev)
`POST https://api.experientiallabs.ai/v1/systemone`, `Authorization: Bearer $EXPERIENTIAL_API_KEY`,
model `jev-latest`. One request per inbound message: a `choice` question `inbox`
(primary/other) and one `noul` question per custom category (max 32 questions per request, so
categories are chunked). State includes sender, recipients, subject, body excerpt, bulk/automation
headers, and thread context (owner participated, direct reply to owner's message, previous
messages). Category applies when noul >= 0.6. 15 s timeout, no inline retries; on failure a
deterministic heuristic assigns the inbox and the message is marked for a bounded later retry.
Junk folder mail is always Other. Threads manually moved keep that inbox for new messages.

## Sending
`send.sendMessage` (shared by UI and MCP): dedupe via `sendLog` (idempotency key, plus a
content hash within 10 minutes unless `allowDuplicate`), SMTP via nodemailer, append to Sent
unless the server already saved a copy (checked by Message-ID), local Sent message inserted and
threaded, `\Answered` set on the original, draft cleaned up. Undo send is a client-side delay.

## Dev auth harness (test-only)
Local end-to-end testing runs without Clerk keys. Set `POST_DEV_AUTH=1` and
`NEXT_PUBLIC_POST_DEV_AUTH=1` in `.env.local` plus `POST_DEV_AUTH_ISSUER`
(the JWKS issuer URL, e.g. `http://localhost:3000/api/dev-auth`) on the Convex
deployment. `app/api/dev-auth/token` signs a short-lived RS256 JWT (subject
`live-e2e-user`) and `app/api/dev-auth/jwks` serves the public key; both 404
outside development or when the flags are off. `convex/auth.config.ts` enables
the `customJwt` provider only while `POST_DEV_AUTH_ISSUER` is set, and
`proxy.ts` bypasses Clerk middleware in this mode. The client uses
`ConvexProviderWithAuth` with the dev token source instead of
`ConvexProviderWithClerk` and shows a "Dev user" profile. Never set these
flags in production.

## Layout
- `app/` routes, `components/` (presentational components are props-driven so `/dev/preview`
  can render them with fixtures in development), `lib/` client utilities, `lib/mcp/` MCP tools.
- `convex/` public functions by domain; `convex/model/` ctx helpers; `convex/lib/` pure logic
  (unit tested); `convex/node/` "use node" actions (IMAP, SMTP, crypto, content).

## Commands
- `npm run dev` and `npm run convex:dev`: frontend and backend development.
- `npm run typecheck`, `npm run lint`, `npm test -- --maxWorkers=4`, `npm run build`: local verification.
- `npx tsx scripts/screenshots.ts`: Paper comparison captures, requires Next dev.
- `npx tsx scripts/live-ui-e2e.ts`: real browser and Ethereal IMAP/SMTP coverage, requires local Convex and dev auth.
- `npx tsx scripts/live-e2e.ts`: wire-level Ethereal integration coverage, local Convex only.
- Set `POST_MCP_URL=http://localhost:3000` and run `npx tsx scripts/live-mcp.ts` to verify the remote MCP tools against a running dev server.
- Live suites use separate test owners. Never run them against a production deployment.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
