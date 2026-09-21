# Security & Privacy

VOX is designed to hold sensitive personal information. Privacy is a first-class
architectural requirement, not an add-on.

## Data storage

- **Local-first**: SQLite file on disk (`DATABASE_URL`), no external database service.
- **Encrypted sensitive fields**: `Memory.content` and `Message.content` are encrypted
  at rest with AES-256-GCM (`src/lib/security/crypto.ts`) before they're written, and
  decrypted only by the service layer that returns them to an authenticated request.
  The encryption key (`VOX_ENCRYPTION_KEY`) lives only in the environment — never in
  the database or source control.
- **No secrets in the schema**: `Connection.config` is documented as non-secret JSON
  only; API keys belong in environment variables (see `.env.example`), never in the DB.
  Real integration credentials live encrypted in `ConnectionCredential.encryptedPayload`
  — see "Connections Hub" below.

## Authentication

VOX is single-user in Phase 1 (see ARCHITECTURE.md). There is no multi-tenant login,
OAuth, or external identity provider — this is intentional, not a stopgap:

- The first visit creates the one local account (`POST /api/auth/register`), which is
  refused once an account already exists (`src/lib/auth/service.ts`).
- Passwords are hashed with bcrypt (`src/lib/auth/password.ts`, 12 rounds), never
  stored or logged in plaintext.
- Sessions are DB-backed (`Session` model), not JWTs: a random 256-bit token is handed
  to the browser as an `httpOnly`, `sameSite=lax` cookie; only its SHA-256 hash
  (salted with `VOX_SESSION_SECRET`) is stored server-side, so a database leak alone
  doesn't yield usable session tokens. Sessions carry an expiry and can be revoked
  (logout deletes the row).
- Every API route handler calls `requireUser()` (`src/lib/api/helpers.ts`) first — this
  is the single auth boundary for the entire API surface. There is no route that skips
  it except `/api/auth/*` itself.
- The one-time registration is race-proof, not just first-request-wins: `registerFirstUser()`
  (`src/lib/auth/service.ts`) wraps the "does a user already exist" check and the
  `User` creation in a single database transaction, so two simultaneous first-registration
  requests can't both observe zero users and both succeed.

## Remote access hardening (cloud deployment)

VOX is designed to run as a single always-on instance reachable from the internet (see
`DEPLOYMENT.md`) rather than only on localhost. These protections exist specifically
because of that:

- **CSRF / cross-origin defense in depth**: `src/proxy.ts` runs before every `/api/*`
  request and rejects any state-changing request (`POST`/`PUT`/`PATCH`/`DELETE`) whose
  `Origin` (or `Referer`, as a fallback) header doesn't match the request's own `Host`.
  The `sameSite=lax` session cookie already blocks the classic cross-site form-post
  attack; this is an explicit second layer rather than relying on cookie behavior alone.
- **Brute-force protection**: `src/proxy.ts` rate-limits `POST /api/auth/login` and
  `POST /api/auth/register` per source IP (`src/lib/security/rate-limit.ts`, in-memory —
  intentional at this scale, see that file's comment) — 10 attempts per 5 minutes.
- **Security headers**: `next.config.ts` sets `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` denying camera/microphone/geolocation (VOX uses none of them),
  and `Strict-Transport-Security` on every response.
- **Health check leaks nothing**: `GET /api/health` is intentionally unauthenticated
  (deployment platforms need to probe it without credentials) but returns only
  `{ status: "ok" | "unavailable" }` — no version string, no environment details.
- **WAL mode**: `src/lib/db.ts` enables SQLite's WAL journal mode on startup so readers
  aren't blocked by a writer — relevant once phone and laptop can both have requests in
  flight against the same instance, not just a theoretical concern once VOX isn't tied
  to one local process anymore.

## Agency / permission model

VOX distinguishes five capability levels, in increasing order of consequence:

```
OBSERVE → ANALYZE → RECOMMEND → ASK → ACT
```

- **Default policy**: OBSERVE and ANALYZE are always available (VOX can look at your
  data and reason about it). RECOMMEND, ASK, and ACT are **denied by default** — VOX
  cannot suggest, ask about, or take a consequential action on a new capability until
  you explicitly grant it (Settings → Permissions).
- **Enforcement point**: `enforceCapability(userId, capability, requiredLevel)`
  (`src/lib/permissions/service.ts`) is the single choke point. It throws
  `PermissionDeniedError` (mapped to HTTP 403) on denial.
- **Audit trail**: every check at RECOMMEND level or above — granted or denied — writes
  an append-only `Event` row, as does every grant/revoke action itself. Nothing
  consequential happens silently; Settings → Audit log shows the record.
- Direct actions you take yourself on your own data (editing a memory, deleting a task)
  are not gated by this system — it exists to constrain what VOX does *autonomously*,
  not to add friction to your own CRUD operations.

VOX does not implement any autonomous destructive action in Phase 1 (no auto-send,
auto-delete, auto-purchase, etc.) — the permission system exists ahead of those
features specifically so they can be added later without retrofitting a security model.

## Semantic memory and the cognition proposal engine (Phase 2)

- **Embeddings are local by default, third-party only if you opt in**:
  `LocalEmbeddingProvider` (`src/lib/embeddings/local.ts`) computes a hashed
  lexical vector entirely in-process — memory content never leaves the
  device. Setting `VOYAGE_API_KEY` switches to real neural embeddings via
  Voyage AI (`src/lib/embeddings/voyage.ts`), which **does** send memory
  content to a third party for embedding. This is strictly opt-in, matching
  rule 14 from the build spec ("do not send personal data to third-party
  services unless explicitly authorized") — never enabled by default, and
  called out here explicitly rather than buried in a config comment.
- **Embedding vectors are not encrypted**: cosine similarity has to run in
  JS over stored numbers, so encrypting the vector would mean decrypting
  every memory on every search — defeating `Memory.content` encryption's
  purpose. The vector is a lossy, hashed bag-of-words representation, not
  the plaintext, but it is a disclosed side channel: someone with database
  access could infer approximate term overlap between memories from the
  stored vectors, even though the underlying content stays encrypted.
- **Real research sends your query (not memory content) to Anthropic**:
  `AnthropicWebSearchProvider` (`src/lib/research/anthropic.ts`) uses
  Claude's native web_search tool over the same `ANTHROPIC_API_KEY` chat
  already requires — no new third party, and only active when
  `VOX_RESEARCH_PROVIDER=anthropic` is set (default `mock`, zero network).
- **The proposal engine cannot bypass the permission system**:
  `approveProposal()` (`src/lib/cognition/proposals.ts`) calls the same
  `enforceCapability()` used everywhere else — there is no separate,
  weaker gate for proposal-triggered actions. The action registry it
  dispatches to is a closed, hardcoded set of internal-only handlers (create
  a memory relation, create a task, link two graph nodes); nothing in it
  reaches outside VOX, so there is currently no proposal that *could*
  perform an external side effect even if approved.

## Connections Hub — external integrations

VOX's "Connections Hub" (`/connections`, `src/lib/connections/service.ts`,
`src/lib/integrations/`) is the trust/control layer every external
integration must pass through, not a settings page.

**As of P5-E, exactly one integration can reach a real external account:
Shopify, read-only.** Every other service remains stubbed by construction.

- **Provider layer is stubbed by construction for every service but one.**
  Google Calendar, Gmail, Notion, Todoist, Craft, QuickBooks, Plaid, Apple
  Health, Google Fit, Google Maps, Amazon order history, Etsy, Printful and
  Printify (see `src/lib/integrations/catalog.ts`) all resolve to
  `StubConnectionProvider` (`src/lib/integrations/stub.ts`), which reports
  `isConfigured: false` unless every vendor env var the catalog lists is
  present, and throws on any authorization/exchange attempt regardless. No
  real vendor OAuth client is registered for any of them.
- **Shopify is real, and read-only (P5-E).** `src/lib/integrations/shopify.ts`
  performs one authenticated Admin GraphQL query — `ordersCount` over a
  declared time window — against a merchant's own store. Its safety rests on
  properties enforced in code, not on intention:
  - **No write mode exists.** Shopify is the only catalog entry whose
    `writeCapability` is `null` — not a write capability defaulting to off.
    `grantAccess()` cannot grant what the catalog does not define, and the
    OAuth scope requested is `read_orders` alone. A test fails the build if a
    GraphQL mutation appears in the provider, or if a second method is added
    to the observation port.
  - **The request target cannot be redirected.** The shop domain comes out of
    the database and is interpolated into a URL carrying a live access token,
    so it is validated whole-string against
    `^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]\.myshopify\.com$` — no scheme, port,
    path or userinfo. `169.254.169.254`, `acme.myshopify.com.evil.test` and
    `acme.myshopify.com@evil.test` are refused before any request is made.
  - **The token never leaves the header.** It is sent as
    `X-Shopify-Access-Token`, never in a URL or body; it is stored only
    encrypted; and it appears in no event payload, log line, digest or error
    message. Tests assert each of those.
  - **Raw responses are never stored.** Only a sha256 digest is persisted. An
    order payload carries customer names, addresses and email addresses, and
    keeping it would place third-party personal data in VOX's database for no
    measurement benefit.
  - **Connecting performs a real verification call.** `connectShopifyStore()`
    validates the domain, grants the read capability through the real
    `grantPermission()`, sets `CONNECTING`, and only reaches `CONNECTED` after
    an authenticated read against the actual store succeeds. A token that does
    not work is never stored, so the Hub cannot display a connection VOX
    cannot actually use.
  - **Per-user credential, per-user boundary.**
    `resolveConnectionCredential()` scopes every lookup by `userId` in the
    WHERE clause rather than checking ownership afterwards, and it is the only
    path by which a provider ever receives a token.
  - **Two read methods, both reads (P5-F).** `countOrdersInWindow` and
    `sumOrderValueInWindow` — how many orders, and how much they came to. The
    second pages through orders and sums their order-time totals; it still
    writes nothing, still requires only `read_orders`, and is classified
    identically to the count (READ / REVERSIBLE / not financial). A test asserts
    by name that the port carries exactly these two methods and that neither
    matches a write-shaped verb.
  - **Order data is read but never retained.** The value read sees order ids and
    totals in the response; only the summed integer, its scale, its currency and
    a sha256 of the pages are persisted. No order id, customer, address, line
    item or raw body is stored.
  - **One write exists, and it is triply authorized (P5-G).** VOX can create a
    bounded discount code — and nothing else. It needs (1) an ACT-level
    `integration.shopify.write` grant, off by default and never granted by
    connecting; (2) a single-use `ApprovalGrant` bound to the exact arguments;
    and (3) a contract digest re-checked against the stored parameters at
    execution. The RECOMMEND-level read grant cannot satisfy any of it. The
    action is classified ACT / PARTIALLY_REVERSIBLE / financial, which the policy
    gate resolves to HOLD at every reversibility — it can never be ALLOW.
  - **The write is bounded and cannot be aimed.** At most 50% off, a required
    redemption limit (hard-capped), and a required end date. The mutation is a
    constant; the only variable is the frozen parameter set. Scope is
    `write_discounts` alone — not orders, products, customers or payments.
  - **An ambiguous write is never retried.** `SUBMITTED` is committed before the
    network call, so a crash mid-flight leaves "may have happened" and every
    re-run is refused; the only resolution is reading the discount back from the
    store. This is deliberate: retrying a write whose outcome is unknown is how
    one authorized action becomes two real ones.
  - **No live observation OR write has been performed in this repository.** There
    are no live store credentials here; every test drives the provider through a
    stubbed `fetch`. Both paths are real and empirically unexercised. The write
    scope in particular is **declared by the operator, not proven** — verifying
    it would require creating an unrequested discount, so the write path fails
    closed on the declaration and then fails closed again on Shopify's own
    rejection.
- **Lifecycle**: `NOT_CONNECTED → PROPOSED → AWAITING_APPROVAL → CONNECTING
  → CONNECTED → PAUSED / REVOKED` (plus `ERROR`). For every stubbed service a
  connection can only reach `CONNECTED` via that provider's `exchangeCode()`
  succeeding — those calls always throw, so each "connect" attempt ends at
  `ERROR` with a "not configured" reason. Shopify reaches `CONNECTED` only
  after a real authenticated read against the merchant's store succeeds, and
  ends at `ERROR` (with nothing stored) when it does not.
- **Suggested connections are Proposals.** VOX recommending a connection
  reuses the existing proposal engine (`connection.propose` in
  `src/lib/cognition/proposals.ts`'s `ACTION_HANDLERS`) rather than a
  parallel suggestion system. Approving that proposal is permission-gated
  by the same `enforceCapability()` as everything else and only moves the
  connection to `AWAITING_APPROVAL` — it never grants access by itself.
- **Read/write access is a separate, explicit grant.** `grantAccess()`
  requires **read at `RECOMMEND` and write at `ACT`** — both capability
  levels sit above the default-allow band (`ANALYZE`), so an integration
  capability is never silently available; every service's exact capability
  keys are defined once in the catalog rather than constructed ad hoc at a
  call site. Sensitive categories (financial, health, location) default to
  read-only (no write grant offered, or off by default where a write mode
  exists) per `writeEnabledByDefault: false` in the catalog.
- **Credentials and cached data are encrypted at rest** the same way as
  `Memory.content` (`encryptField`/`decryptField`, AES-256-GCM) —
  `ConnectionCredential.encryptedPayload` and
  `ConnectionCachedItem.payload`. Non-secret configuration only ever lives
  in `Connection.config`, mirroring the old `Integration.config` rule.
- **Revocation actually destroys the secret.** `revokeConnection()` deletes
  the `ConnectionCredential` row outright (not a status flag) and revokes
  both permission grants; cached data is untouched by that call — deleting
  history is the separate, explicit `deleteCachedData()`.
- Every lifecycle transition (proposed, approved, access granted, connect
  failed, paused, resumed, revoked, cache deleted) writes an `Event` via
  `src/lib/observability/events.ts`, so the audit log covers this subsystem
  exactly like every other consequential action in VOX.

## Multimodal generation providers (images, video)

VOX can generate images and cinematic media. Both capabilities are served by
third-party providers, and both are **absent by default** — see CLAUDE.md rule
6. With no key set, VOX reports the capability as unavailable and refuses to
produce anything; it does not fall back to a placeholder.

That refusal is deliberate and is the security-relevant property. A mock text
completion announces itself as mock the moment you read it. A placeholder
IMAGE does not: it becomes an `ArtifactVersion`, gains a lineage edge, appears
in the Lab, and is indistinguishable downstream — including to the user — from
a real generation. So `src/lib/image/unavailable.ts` and
`src/lib/video/unavailable.ts` throw rather than return, and there is no mock
implementation of either interface anywhere in the tree.

### What leaves the machine

| Provider | Env var | What is sent |
| --- | --- | --- |
| Google Gemini (image) | `GOOGLE_API_KEY` | The prompt, and any reference images you attach |
| Higgsfield (video) | `HIGGSFIELD_API_KEY` + `VOX_HIGGSFIELD_BASE_URL` | The prompt, and any reference frames |

Setting either is a real authorization decision. Neither is required for VOX to
run, and every other subsystem continues to work without them.

Higgsfield additionally requires its base URL to be named explicitly. Its hosts
are unreachable from some environments (this one returns 403 at the egress
proxy), so its request shape could not be verified against the live service;
requiring an operator to name the endpoint is what prevents the adapter from
reporting itself connected where nobody has checked it.

### Key handling

- Keys are read from `process.env` inside the provider module only, server-side.
- The Gemini key is sent as an `x-goog-api-key` header rather than a query
  parameter, so it cannot end up in a proxy access log or in an error string
  that contains the URL.
- No key is written to Memory, to an `Event` payload, or to any artifact record.
- `/api/capabilities` returns provider *status* and the name of a missing
  variable — never a value.

### Generated bytes are untrusted

Anything a provider returns is data from a third party, and
`src/lib/artifacts/store.ts` treats it that way:

- **MIME allowlist, not sanitisation.** Only types VOX is prepared to serve are
  stored, each mapped to a fixed extension. An unexpected type is refused
  rather than guessed at, which is what keeps an unknown file format from being
  written under the public origin.
- **Paths are never derived from provider input.** The filename is a UUID plus
  an extension from that map, so neither a provider-supplied filename nor a
  prompt can influence where a file lands. Path traversal has nothing to work
  with.
- **Size is bounded** (256 MB) and **empty files are refused**, so a runaway or
  a truncated response cannot fill the disk or create a version row pointing at
  nothing.
- A provider-supplied URL is never treated as an execution target or fetched
  implicitly; downloading remote bytes is always an explicit, separate step.

### Spend

Every metered provider call is recorded in `CapabilityRun` before it is made,
and `src/lib/capabilities/ledger.ts` enforces per-capability daily call limits
and an optional daily spend ceiling. Defaults ship non-empty, so a system left
unconfigured cannot run up an unbounded bill. A refused call is recorded with
status `REFUSED` and is distinguishable from one that was attempted and failed.

## User data rights

- **Inspect**: every Memory is visible and readable in the Memory page — nothing is
  hidden from the user who owns it.
- **Edit / delete**: `PATCH`/`DELETE /api/memories/:id`, enforced to the owning user.
- **Export**: `GET /api/memories/export` returns full plaintext JSON of every memory.
- **Full deletion**: `DELETE /api/account` deletes the `User` row, which cascades
  (`onDelete: Cascade` throughout the schema) to every piece of data VOX holds about
  that user — conversations, memories, observations, projects, everything. The
  Settings UI requires a typed "DELETE" confirmation before calling it, since it is
  irreversible.

## What VOX does not do in Phase 1

Per the build spec, VOX does not automatically collect microphone, camera, browser
activity, location, raw keystrokes, or health information. No integration is enabled
by default; the Connections Hub (`Connection` + `Permission` models — see above) exists
so future integrations are opt-in and scoped, not blanket.

## Observability without over-collection

`src/lib/observability/logger.ts` emits structured logs (latency, model, token counts,
error type) intended to never include raw personal content — log calls pass IDs and
metadata, not memory/message bodies. Review any new logging call against that rule
before merging.

## Reporting a concern

This is a personal-use, local-first project without a hosted service; if you find a
security issue, treat it as you would any other bug in your own codebase — file it
against the relevant module listed above.
