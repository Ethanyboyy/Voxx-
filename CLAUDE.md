@AGENTS.md

# VOX — permanent development rules

VOX is a personal Cognitive Operating System (Next.js 16 App Router + TypeScript
+ Prisma/SQLite). Read `ARCHITECTURE.md`, `PHASE_2_ARCHITECTURE.md`, and `SECURITY.md`
before making structural changes. These rules apply to every change, not just Phase 1/2.

## Non-negotiables

1. Do not fabricate APIs, package versions, or config syntax — check
   `node_modules/<pkg>` types/docs or run `npm view <pkg> version` before
   assuming an API shape, especially for Next.js, Prisma, and the Anthropic SDK.
2. Keep AI-provider code behind `src/lib/ai/`, research-provider code behind
   `src/lib/research/`, embedding-provider code behind `src/lib/embeddings/`,
   and external-integration provider code behind `src/lib/integrations/` —
   never call `@anthropic-ai/sdk`, `voyageai`, a vendor OAuth/API client, or
   any future provider SDK outside its dedicated abstraction module.
3. Memory confidence is never silently upgraded. An inference stays an
   inference (`MemoryCategory.INFERENCE` / low `Confidence`) until a human
   or a corroborating explicit fact promotes it. The same posture applies to
   memory relationships: a detector (e.g. contradiction detection) proposes
   a `MemoryRelation`/`Proposal`, it never writes one directly.
4. Consequential actions (capability level `RECOMMEND` and above) must check
   `src/lib/permissions/service.ts#enforceCapability()` and, once performed,
   write an `Event` row via `src/lib/observability/events.ts`. This includes
   every `Proposal` execution — `approveProposal()` in
   `src/lib/cognition/proposals.ts` is the one path to running a proposed
   action, and it calls the real `enforceCapability()`, never a bypass.
5. The proposal action registry (`src/lib/cognition/proposals.ts`) is a
   closed, hardcoded set of internal-only handlers. Do not add a handler
   that performs an external side effect (sending something, spending
   money, deleting third-party data) without also adding real `ACT`-level
   permission gating for it specifically — the registry existing at all is
   not itself authorization.
6. A remote embedding or research provider that sends user content to a
   third party must be strictly opt-in (absent by default, gated on an
   explicit env var like `VOYAGE_API_KEY`) — never the default, per rule 14
   of the original build spec. Document any new one in both `.env.example`
   and `SECURITY.md`.
7. Never commit `.env`, `prisma/dev.db`, `prisma/test.db`, or anything under
   `src/generated/`.
8. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`
   before considering a change complete. Fix failures — do not disable checks
   to make them pass.
9. New domain features need: a Prisma model/field (if needed), a service
   function in `src/lib/`, a route handler in `src/app/api/`, a test in
   `tests/`, and a UI surface if user-facing.
10. Every external integration (Connections Hub — `src/lib/connections/`,
    `src/lib/integrations/`) is defined once in
    `src/lib/integrations/catalog.ts`: read access requires `RECOMMEND`,
    write requires `ACT`, both granted only via `grantAccess()` (which
    itself calls the real `grantPermission()` — never a bypass). A service
    can only report `isConfigured: true` when its real vendor env vars are
    present; do not add a `ConnectionProvider` that fakes a successful
    connect. `revokeConnection()` must keep deleting the
    `ConnectionCredential` row outright, not just flag it.

## Commands

- `npm run dev` — start the dev server (Turbopack, port 3000)
- `npm run build` / `npm start` — production build / run
- `npm run typecheck` — runs `next typegen` then `tsc --noEmit`
- `npm run lint` — ESLint (flat config)
- `npm test` — Vitest (single run) / `npm run test:watch`
- `npm run db:migrate` — create + apply a dev migration
- `npm run db:generate` — regenerate the Prisma client (also runs on `postinstall`)
- `npm run db:seed` — run `prisma/seed.ts`
- `npm run db:studio` — Prisma Studio

## Project layout

- `src/app/` — routes (pages + `api/*` route handlers)
- `src/lib/ai/` — provider-agnostic AI abstraction (Anthropic + mock)
- `src/lib/research/` — provider-agnostic research abstraction (mock + Anthropic web search)
- `src/lib/embeddings/` — provider-agnostic embedding abstraction (local + Voyage)
- `src/lib/memory/` — memory CRUD, semantic retrieval, relations/supersession,
  contradiction detection
- `src/lib/cognition/` — observations, hypotheses, pattern detection, cognitive
  profile, and the proposal engine (`proposals.ts`)
- `src/lib/knowledge/`, `src/lib/permissions/`, `src/lib/observability/` — domain services
- `src/lib/integrations/` — provider-agnostic external-integration abstraction (catalog +
  stub provider); `src/lib/connections/` — the Connections Hub service layer (lifecycle,
  access grants, revocation) built on top of it
- `src/lib/auth/` — password hashing + session cookies
- `src/components/` — UI
- `prisma/schema.prisma` — domain model (see `ARCHITECTURE.md` and
  `PHASE_2_ARCHITECTURE.md` for the entity map)
- `tests/` — Vitest specs, one area per file
