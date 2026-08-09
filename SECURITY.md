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
