# Architecture

## Layers

```
src/app/            Routes: pages (Server Components) + api/* (Route Handlers)
src/components/      UI, split by feature area (chat/, memory/, projects/, ...)
                      and a small shared ui/ + layout/ kit
src/lib/
  ai/                Provider-agnostic AI abstraction (Anthropic + mock)
  research/          Provider-agnostic research abstraction (mock in Phase 1)
  auth/              Password hashing, DB-backed sessions
  security/          Field-level encryption for sensitive content
  permissions/        Capability-level enforcement (OBSERVE..ACT)
  observability/      Structured logging + audit Event log
  memory/            Memory CRUD + confidence/provenance handling
  cognition/          Observations, hypotheses, profile computation, pattern detection
  projects/           Project/Goal/Task/Decision/Idea/Experiment CRUD
  knowledge/          Minimal knowledge graph CRUD
  chat/               Conversation/message persistence, system-prompt assembly
  validation/         Zod schemas shared by every route handler
  api/helpers.ts      requireUser() / ApiError / apiErrorResponse — the API's auth
                       and error boundary
  db.ts               Prisma client singleton (SQLite via a driver adapter)
prisma/schema.prisma  Domain model
tests/                Vitest specs, one file per subsystem
```

Server Components call `src/lib/*` services directly for reads (no network hop).
Client Components call the `api/*` Route Handlers for anything that mutates state
or needs to stream (chat). Both paths go through the same service layer, so there
is exactly one implementation of every business rule.

## Domain model

See `prisma/schema.prisma` for the authoritative, commented schema. Summary of the
Core Concepts from the spec and where they live:

| Concept | Model(s) |
| --- | --- |
| User / Conversation / Message | `User`, `Session`, `Conversation`, `Message` |
| Memory / MemorySource | `Memory`, `MemorySource` |
| Observation / Hypothesis / Pattern | `Observation`, `Hypothesis`, `Pattern` |
| Goal / Project / Task / Decision / Idea | `Goal`, `Project`, `Task`, `Decision`, `Idea` |
| Experiment / ExperimentResult | `Experiment`, `ExperimentResult` |
| ResearchItem | `ResearchItem` |
| KnowledgeNode / KnowledgeConnection | `KnowledgeNode`, `KnowledgeConnection` |
| Permission / Connection / Event | `Permission`, `Connection`, `ConnectionCredential`, `ConnectionCachedItem`, `Event` |

Every model that holds anything resembling a "confidence" (Memory, Observation,
Hypothesis, Pattern, ExperimentResult, ResearchItem) uses the shared `Confidence` enum
(`LOW | MEDIUM | HIGH | CONFIRMED`) so confidence is always visible and never implicit.

## AI provider abstraction

`src/lib/ai/types.ts` defines `AIProvider`: `generate()` (single response) and
`stream()` (an `AsyncGenerator<StreamEvent>`). Two implementations:

- `AnthropicProvider` (`src/lib/ai/anthropic.ts`) — wraps `@anthropic-ai/sdk`, handles
  tool-call accumulation during streaming, and logs latency/token usage/stop reason for
  every call.
- `MockAIProvider` (`src/lib/ai/mock.ts`) — deterministic, zero-network. Used
  automatically in tests (`VOX_AI_PROVIDER=mock`) and as the default when no
  `ANTHROPIC_API_KEY` is configured, so the app is fully exercisable without a key.

`src/lib/ai/index.ts` is the only place that decides which implementation to use.
**No other file imports `@anthropic-ai/sdk` directly** — adding a second real provider
(OpenAI, a local model, etc.) means adding one file implementing `AIProvider` and
extending the factory; nothing else changes.

Cost tracking (`src/lib/ai/cost.ts`) is deliberately conservative: VOX always records
real token counts from the provider, but only computes a dollar estimate when the user
supplies real `VOX_COST_PER_1K_*_TOKENS` rates. Without them it reports token counts and
stays silent on cost, rather than guess at a price.

## Research abstraction

Same shape as the AI abstraction (`src/lib/research/types.ts` → `ResearchProvider`).
Phase 1 ships only `MockResearchProvider`, which returns a single, clearly-labeled
"no live provider configured" result rather than ever inventing search results — VOX
must not present unverified claims as facts. `ResearchItem` rows always keep source,
URL, title, retrieval time, relevance, and confidence, so a future real provider slots
into the same persistence path unchanged.

## Permission / agency model

`src/lib/permissions/service.ts` implements the five capability levels from the spec:
`OBSERVE < ANALYZE < RECOMMEND < ASK < ACT`. Default policy (no `Permission` row):
OBSERVE/ANALYZE allowed, RECOMMEND and above denied. `enforceCapability()` is the single
choke point every consequential action must call; it throws `PermissionDeniedError` on
denial and writes an audit `Event` for any check at RECOMMEND level or above (allowed or
denied) — see SECURITY.md for the full model.

## Cognitive profile

`src/lib/cognition/profile.ts` computes one `DimensionProfile` per
`CognitiveDimension` (focus, task switching, completion behavior, idea generation,
creativity, learning behavior, decision behavior, planning behavior, consistency,
project persistence, attention patterns, productivity patterns). Each entry explicitly
separates:

- `observationCount` — a fact (how many `Observation` rows exist)
- `confidence` — derived from that count (LOW/MEDIUM/HIGH), never fabricated
- `estimate` / `trend` — inferences, and labeled as such in the UI
- `hasData` — dimensions with zero observations report an explicit "no data yet" state

`src/lib/cognition/patterns.ts` implements the "thought-loop" detection from the spec
as a small set of neutral, explainable heuristics (stale captured ideas → "idea without
execution", pending decisions past a threshold → "unresolved decision", etc.), run on
demand from the Cognition page rather than as a hidden background job. Every detected
Pattern uses neutral language ("pattern detected", "possible loop") and starts at LOW
confidence.

## Privacy / encryption

`src/lib/security/crypto.ts` provides AES-256-GCM `encryptField`/`decryptField`, applied
to `Memory.content` and `Message.content` at the service layer before they ever reach
the database — see SECURITY.md.

## Extension points (deliberately deferred from Phase 1)

- **Real research provider**: implement `ResearchProvider`, wire it into
  `src/lib/research/index.ts` behind `VOX_RESEARCH_PROVIDER`.
- **Second AI provider**: implement `AIProvider`, extend the factory in
  `src/lib/ai/index.ts`.
- **Semantic memory retrieval**: `buildSystemPrompt()` in `src/lib/chat/service.ts`
  currently injects the most recent memories; swapping in embeddings-based retrieval
  only touches that one function.
- **Background cognition jobs**: `detectPatterns()` is a plain async function with no
  scheduler dependency — wiring it to a cron/queue is additive.
- **New external integrations**: the Connections Hub (`Connection` +
  `Permission` models, `src/lib/connections/service.ts`,
  `src/lib/integrations/`) already supports arbitrary services — a new
  integration is a new catalog entry plus a real `ConnectionProvider`
  implementation; see SECURITY.md for the trust model.
