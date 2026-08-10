# VOX — Cognitive Operating System

VOX is a private, user-controlled cognitive operating system: a single application that
holds your conversations, structured memory, projects, and an evolving (evidence-based,
never-fabricated) model of how you work — with chat, research, and reasoning built on
top of it.

Phase 1 built the foundation; Phase 2 connected it into one working cognitive loop:
retrieve relevant memory by meaning, ground reasoning in real external research, connect
what's learned in a real graph, and — when something's worth acting on — propose it and
wait for permission, never act silently. See [ARCHITECTURE.md](./ARCHITECTURE.md) and
[PHASE_2_ARCHITECTURE.md](./PHASE_2_ARCHITECTURE.md) for the full design.

## What's included

- **Chat** — streaming conversations, grounded in memories retrieved by semantic
  relevance (not just recency). Every response carries a **Context Inspector** you can
  expand to see exactly which memories fed it, at what confidence and match strength.
- **Memory** — explicit facts, preferences, goals, experiences, ideas, observations,
  hypotheses, and inferences, each with confidence, provenance, and source metadata.
  Semantic retrieval, explicit relationships (relates-to/supersedes/contradicts/
  derived-from/supports), supersession, and on-demand contradiction detection — which
  proposes a fix rather than silently rewriting anything. Inspect, edit, delete, or
  export everything.
- **Research** — real web research via Claude's native web_search tool (or a
  zero-network mock, the default and always used in tests), with every result keeping
  its source, retrieval time, relevance, and confidence — and grounded (cited) claims
  kept structurally distinct from VOX's own uncited synthesis.
- **Knowledge graph** — nodes with real foreign-key links to memories, projects, goals,
  tasks, decisions, ideas, experiments, and research sources, plus freestanding people/
  organization/concept nodes — queryable by the reasoning layer and explorable in the UI.
- **Projects** — goals, tasks, decisions, ideas, and experiments (with recorded results).
- **Cognition** — a per-dimension behavioral profile (focus, task switching, planning,
  etc.), neutral recurring-pattern detection ("possible loop", never a diagnosis), and a
  durable event timeline (task completed, goal changed, decision made, research
  discovered, ...) that pattern detection reads from.
- **Proposals** — VOX's "Observed X → connected it with Y → possible implication Z →
  suggested action A → permission required" loop. Nothing executes until you approve it
  in the Proposals inbox, approval runs a real permission check, and every outcome
  (executed, denied, failed) is recorded.
- **Permissions** — explicit capability levels (OBSERVE, ANALYZE, RECOMMEND, ASK, ACT).
  VOX defaults to OBSERVE/ANALYZE; anything more consequential — including every
  proposal — requires an explicit grant.
- **Connections Hub** — the trust/control layer for future external integrations (email/
  calendar, financial, tasks/notes, health/fitness, location, shopping, Etsy, print-on-
  demand): propose → approve → grant read/write → connect → pause/revoke → delete cached
  data, all permission-gated and audited. Every provider is a stub today — nothing can
  actually authorize a real account yet (see "Known limitations").
- **Privacy** — local-first SQLite storage, encrypted sensitive fields, a zero-network
  local embedding provider by default (memory content never leaves the device unless
  you opt into a real neural embedding provider), full data export, full account/data
  deletion, and an audit log of consequential actions.
- **Mobile-first, installable** — a responsive nav drawer, mobile-usable chat
  conversation switcher, 44pt touch targets on touch devices, iOS safe-area support, and
  a web manifest + Apple touch icon so VOX can be added to an iPhone home screen and
  launched full-screen like an app.
- **Cloud-deployable** — designed to run as a single always-on instance (see
  [DEPLOYMENT.md](./DEPLOYMENT.md)), with the hardening that implies: CSRF/Origin
  checks and login rate limiting in `src/proxy.ts`, security headers, and an
  unauthenticated `/api/health` check for the platform's health probes. See
  `SECURITY.md` → "Remote access hardening".

## Stack

Next.js 16 (App Router, TypeScript) · Prisma 7 + SQLite · Tailwind CSS v4 · Vitest ·
Anthropic SDK (behind a provider-agnostic abstraction, also used for real web research)
· local hashed-embedding provider with an opt-in Voyage AI neural embedding provider.

## Getting started

```bash
npm install                 # also runs `prisma generate` via postinstall
cp .env.example .env        # fill in secrets — see below
npm run db:migrate          # create the local SQLite database
npm run dev                 # http://localhost:3000
```

The first visit walks you through creating the single local account (VOX is single-user
in Phase 1 — see [SECURITY.md](./SECURITY.md)).

### Required environment variables

See [.env.example](./.env.example) for the full list with descriptions. At minimum:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite file, e.g. `file:./prisma/dev.db` |
| `VOX_ENCRYPTION_KEY` | 32-byte key (base64) encrypting memory/message content at rest — `openssl rand -base64 32` |
| `VOX_SESSION_SECRET` | Signs session tokens — `openssl rand -base64 32` |
| `ANTHROPIC_API_KEY` | Optional. Without it, VOX runs on a deterministic mock AI provider so the app is fully usable without a key. Also enables real research (`VOX_RESEARCH_PROVIDER=anthropic`). |
| `VOYAGE_API_KEY` | Optional. Switches semantic memory from the local (zero-network) embedding provider to real neural embeddings — sends memory content to Voyage AI. See SECURITY.md. |

## Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the dev server (Turbopack) |
| `npm run build` / `npm start` | Production build / run |
| `npm run typecheck` | `next typegen` + `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm test` | Vitest (provisions an isolated `prisma/test.db` first) |
| `npm run db:migrate` | Create + apply a dev migration |
| `npm run db:studio` | Prisma Studio |

See [DEVELOPMENT.md](./DEVELOPMENT.md) for the full workflow.

## Documentation

- [ARCHITECTURE.md](./ARCHITECTURE.md) — Phase 1 system design, domain model, extension points
- [PHASE_2_ARCHITECTURE.md](./PHASE_2_ARCHITECTURE.md) — semantic memory, real research,
  the knowledge graph, the event timeline, and the cognition proposal engine
- [SECURITY.md](./SECURITY.md) — privacy architecture, permission model, threat model
- [DEVELOPMENT.md](./DEVELOPMENT.md) — environment setup, testing, workflow
- [CLAUDE.md](./CLAUDE.md) — permanent rules for AI-assisted development on this repo

## Known limitations

- Single local user account; no multi-tenant auth.
- The default embedding provider is lexical/statistical (hashed term-frequency cosine
  similarity), not a trained neural model — real semantic (synonym-aware) embeddings
  are available opt-in via Voyage AI (`VOYAGE_API_KEY`).
- The proposal engine's action registry contains safe, internal VOX operations (create a
  memory relation, create a task, link graph nodes) plus one Connections Hub handler
  (`connection.propose`) that only moves a connection to "awaiting approval" — nothing in
  the registry reaches an external service, since Phase 2 intentionally does not add
  autonomous consequential external actions.
- The Connections Hub (`/connections`) is a fully working trust/control layer — lifecycle,
  permission gating, encrypted credential storage, revocation, cached-data deletion — for
  13 external services across 8 categories, but every provider is a stub: no real vendor
  OAuth client is registered, so no connection can actually reach `CONNECTED`. See
  SECURITY.md → "Connections Hub".
- Cognitive observations, pattern detection, and contradiction checks are triggered on
  demand, not by a background scheduler.
- The graph explorer is a list/detail view, not a force-directed visual canvas.

See ARCHITECTURE.md → "Extension points" and PHASE_2_ARCHITECTURE.md for how each of
these is meant to be extended.
