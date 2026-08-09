# VOX — Cognitive Operating System

VOX is a private, user-controlled cognitive operating system: a single application that
holds your conversations, structured memory, projects, and an evolving (evidence-based,
never-fabricated) model of how you work — with chat, research, and reasoning built on
top of it.

This is **Phase 1**: a stable foundation, not the full future system. See
[ARCHITECTURE.md](./ARCHITECTURE.md) for what's here and what's intentionally deferred.

## What's included

- **Chat** — streaming conversations with an AI provider, aware of your saved memories.
- **Memory** — explicit facts, preferences, goals, experiences, ideas, observations,
  hypotheses, and inferences, each with confidence, provenance, and source metadata.
  Inspect, edit, delete, or export everything.
- **Projects** — goals, tasks, decisions, ideas, and experiments (with recorded results).
- **Cognition** — behavioral observations rolled up into a per-dimension profile
  (focus, task switching, planning, etc.), plus neutral recurring-pattern detection
  ("possible loop", never a diagnosis).
- **Research** — a provider-agnostic research abstraction (mock provider in Phase 1;
  every result keeps its source, retrieval time, relevance, and confidence).
- **Knowledge graph** — minimal node/connection graph linking entities, goals, and topics.
- **Permissions** — explicit capability levels (OBSERVE, ANALYZE, RECOMMEND, ASK, ACT).
  VOX defaults to OBSERVE/ANALYZE; anything more consequential requires an explicit grant.
- **Privacy** — local-first SQLite storage, encrypted sensitive fields, full data export,
  full account/data deletion, and an audit log of consequential actions.

## Stack

Next.js 16 (App Router, TypeScript) · Prisma 7 + SQLite · Tailwind CSS v4 · Vitest ·
Anthropic SDK (behind a provider-agnostic abstraction).

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
| `ANTHROPIC_API_KEY` | Optional. Without it, VOX runs on a deterministic mock AI provider so the app is fully usable without a key. |

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

- [ARCHITECTURE.md](./ARCHITECTURE.md) — system design, domain model, extension points
- [SECURITY.md](./SECURITY.md) — privacy architecture, permission model, threat model
- [DEVELOPMENT.md](./DEVELOPMENT.md) — environment setup, testing, workflow
- [CLAUDE.md](./CLAUDE.md) — permanent rules for AI-assisted development on this repo

## Known limitations (Phase 1)

- Single local user account; no multi-tenant auth.
- Research provider is a transparent mock — no live web search is wired up yet.
- Cognitive observations and pattern detection are triggered on demand, not by a
  background scheduler.
- No vector/semantic memory retrieval yet — memory context injected into chat is
  recency-ordered.

See ARCHITECTURE.md → "Extension points" for how each of these is meant to be extended.
