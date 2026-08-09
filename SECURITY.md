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
- **No secrets in the schema**: `Integration.config` is documented as non-secret JSON
  only; API keys belong in environment variables (see `.env.example`), never in the DB.

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
by default; the `Integration` + `Permission` models exist so future integrations are
opt-in and scoped, not blanket.

## Observability without over-collection

`src/lib/observability/logger.ts` emits structured logs (latency, model, token counts,
error type) intended to never include raw personal content — log calls pass IDs and
metadata, not memory/message bodies. Review any new logging call against that rule
before merging.

## Reporting a concern

This is a personal-use, local-first project without a hosted service; if you find a
security issue, treat it as you would any other bug in your own codebase — file it
against the relevant module listed above.
