# VOX 2.0 Architecture

This document is the source of truth for the VOX 2.0 rebuild. It records the
Phase 0 audit findings (what exists, classified honestly) and the target
architecture the implementation milestones build toward. It supersedes
nothing in `ARCHITECTURE.md` / `PHASE_2_ARCHITECTURE.md` / `SECURITY.md` —
those remain accurate for the subsystems they describe. This document adds
the layer above them: how those subsystems compose into one operating
system, and what's missing to get there.

## Phase 0 audit — subsystem inventory

Classification key: **WORKING** (real, tested, production-shaped) ·
**PARTIAL** (real but thinner than the target) · **PLACEHOLDER** (honest
empty state, no data model behind it) · **DUPLICATED** · **ORPHANED** (no
caller found) · **MISSING** (doesn't exist) · **UNSOUND** (exists but the
shape is wrong for where the product is going).

| Subsystem | Status | Notes |
|---|---|---|
| Auth (register/login/session) | WORKING | bcrypt + DB-backed sessions, single-user, race-proof registration. Tested. |
| Encryption (`Memory.content`, `Message.content`) | WORKING | AES-256-GCM, key never in DB/VCS. |
| Permissions (`enforceCapability`, OBSERVE→ACT) | WORKING | Single choke point, audited, tested. The one gate everything else must route through. |
| Proposal engine | WORKING | propose→approve(permission-gated)→execute→result, closed action registry, tested. |
| Memory (CRUD, encryption, confidence) | WORKING | Tested, including semantic search + relations + supersession. |
| Semantic memory (local embeddings) | WORKING | Deterministic, zero-network by default. Voyage opt-in path exists and is tested with a mocked HTTP layer. |
| Research (mock + Anthropic web search) | WORKING | Grounded/ungrounded citation split implemented and tested. |
| Cognition (observations, hypotheses, patterns, profile) | WORKING | Tested. Confidence never fabricated — `hasData` false states are honest. |
| Knowledge graph | PARTIAL | Real FK-linked nodes/edges, tested, but has no UI caller beyond `/graph` — not yet a reasoning substrate anything else reads from. |
| Objectives / Opportunities (scoring, evidence, promotion) | WORKING | This is VOX's real "opportunity engine" — evidence-based, confidence/effort/risk-scored, promotes to Project. Domain-agnostic (not finance-specific). Tested. |
| Projects / Goals / Tasks / Decisions / Ideas | WORKING | Tested. |
| Connections Hub | WORKING (by design, as a stub) | Every provider is a `StubConnectionProvider` until real vendor env vars exist — this is the intended security posture, not a bug. Lifecycle, permission-gating, encrypted credentials, audit events all real. |
| Brain (`getBrainGraph`, `getBrainState`) | WORKING | State machine (idle/thinking/researching/executing/waiting/learning/error) is derived from real `AgentRun`/`Proposal` rows — genuinely load-bearing, not decorative. Tested. |
| Voice (speech-to-text, text-to-speech) | PARTIAL | Real, working Web Speech API implementation (`src/lib/voice/useSpeech.ts`), wired into Chat. Browser-native only — no provider abstraction, no wake-word, no confirm/execute pipeline, zero tests. |
| Notifications | WORKING | Tested. |
| Agents (`AgentRun`) | WORKING | Run lifecycle (planning/running/waiting/failed), tested — this is what `getBrainState` reads. |
| Events / audit log | WORKING | Append-only, tested. |
| Spider-Man Laboratory (suits, gadgets, materials, simulation, training, experiments, research) | WORKING, visually redesigned | 25+ models, ~90 service functions, ~40 routes, full luxury visual pass just completed and deployed. Real WebGL viewer with studio lighting + GLTF architecture (unused pending real assets). |
| Suit "digital twin" depth | UNSOUND relative to target | `LabComponent` is a generic free-text parent/child tree (name, material, mass, notes, confidence) shared by suits and gadgets. **No fixed subsystem taxonomy** (no HEAD/TORSO/ARMS/LEGS/FEET), **no per-component power/cost/dependency/risk/revision-history**, **no `realityStatus` at the component level** (only on `LabSuit`), and **`LabExperiment`/`LabResearchItem` cannot link to a specific component** — only to the suit as a whole. This is the single biggest gap between what exists and Phase 7/8 of the master directive. |
| Finance / Economic Command | PLACEHOLDER, honestly | `/finance` filters Connections by category and shows an honest empty state ("won't invent a balance"). Zero data model: no `Revenue`, `Expense`, `Asset`, or `Business` Prisma models. The real, working "opportunity" architecture already exists (Objectives/Opportunities) but is generic, not finance-specialized, and has no autonomy-ladder concept. |
| Field Mode / HUD | MISSING | No trace anywhere in the codebase. Confirmed absent (search for hud/field-mode/goggles/headset/xr/wearable-as-product-concept). |
| Central orchestrator | MISSING | No file named orchestrator/router. The closest analogue is `src/lib/chat/service.ts`'s system-prompt builder, which composes memory + objectives + security + logging — but it's chat-scoped, not a general cross-subsystem router other surfaces call into. |
| Offline / PWA | PARTIAL, mostly missing | `public/manifest.webmanifest` exists and is wired into `layout.tsx` (installable metadata only). No service worker, no `next-pwa`, no `navigator.onLine` usage, no offline/degraded UI state anywhere. |
| Autonomy ladder (beyond `CapabilityLevel`) | MISSING | `CapabilityLevel` (OBSERVE/ANALYZE/RECOMMEND/ASK/ACT) is the only such enum in the codebase and is the correct, working gate for consequential actions. There is no separate/parallel "autonomy level" concept for economic automation specifically — Phase 14 of the master directive needs to either reuse `CapabilityLevel` directly (recommended — see below) or justify a second axis. |
| `/api/decisions`, `/api/ideas` | WORKING (audit correction) | The Phase 0 static-string grep missed these — `ProjectDetailClient.tsx`'s `addSimple()` builds the path dynamically (`` `/api/${kind}` ``, `kind` ∈ `"decisions" \| "ideas" \| "goals" \| "experiments"`). Real, reachable, no action needed. |
| `/api/tools`, `/api/cognition` (profile) | ORPHANED but not a liability | No UI caller confirmed via a broader dynamic-pattern search (Milestone 3), but both are gated by the same uniform `requireUser()` every route uses (`SECURITY.md`) — not an auth bypass, just unused surface. `/api/cognition`'s profile GET is redundant with the Cognition page's direct server-side service call (Server Components read `src/lib/*` directly per `ARCHITECTURE.md`). Left in place: plausible future consumers (a mobile client, `/api/tools` as tool-calling introspection) and zero security cost to leaving a permission-gated route unused. |
| `/api/hypotheses`, `/api/observations` | ORPHANED **and the underlying data has no creation path at all** | Confirmed via Milestone 3: `createHypothesis()`/`createObservation()` (`src/lib/cognition/service.ts`) are defined but never called anywhere else in `src/lib` — not by pattern detection, not by any detector. `Hypothesis` and `Observation` are read-only display concepts today (the Cognition page shows whatever exists, which today is nothing) despite being named as core domain models in `ARCHITECTURE.md`'s table. **This is a real product gap, not a route-cleanup task**: cognition needs an actual observation-generation pipeline (something has to watch `Event`/behavior and write `Observation` rows; hypotheses need to be formed from patterns of observations) before these routes have anything to serve. Scoped out of Milestone 6 as its own follow-up rather than solved as a quick fix — do not delete the models/routes, they're the right shape for work that hasn't been built yet. |
| `/api/experiments` + `/api/projects` + `/api/research` vs `/api/lab/experiments` + `/api/lab/projects` + `/api/lab/research` | DUPLICATED (needs verification) | Same CRUD shape under two prefixes. `/api/experiments` and `/api/projects` are VOX-core (used by `src/components/projects/ExperimentsClient.tsx` and the core Projects pages) and are legitimately distinct from the Lab's own project/experiment tracking — **not actually a bug**, confirmed by this session's own restyle work touching both `src/components/projects/ExperimentsClient.tsx` (core) and `src/components/lab/ExperimentsClient.tsx` (Lab) as separate, real, differently-scoped features. `/api/research` vs `/api/lab/research` is the same pattern (VOX-core research vs. the Lab's Research Engine). Re-classified from "duplication smell" to **intentional parallel domains that happen to share a CRUD shape** — no consolidation needed, but the naming collision is worth a comment in each route file so a future pass doesn't "fix" this by accident. |
| Tests | WORKING, backend-only | 27 spec files / 191 tests, 100% service-layer. **Zero component/UI tests** (no RTL, no Playwright specs). **Zero coverage**: `src/lib/security/` (crypto, rate-limit), `src/lib/integrations/` (catalog, stub), `src/lib/voice/`. API route handlers are never invoked directly in tests — only the service functions underneath them. |

## Target architecture

```
                         VOX COGNITIVE CORE
        (Memory · Cognition · Research · Knowledge Graph · Brain state)
                                  |
              +-------------------+-------------------+
              |                   |                   |
        PERSONAL OS         ENGINEERING OS       ECONOMIC OS
   Goals/Projects/Tasks    Lab: Suit digital     Objectives/Opportunities
   Memory · Research           twin, Experiments  (generalized) specialized
                                 Telemetry          into Assets/Revenue/
                                                     Expenses, autonomy-gated
              |                   |                   |
              +-------------------+-------------------+
                                  |
                          VOX ORCHESTRATOR   <- NEW, Milestone 10
                    (routes context between subsystems,
                     enforces permissions, writes proposals,
                     records events — extracted from and
                     generalizing src/lib/chat/service.ts)
                                  |
                       +----------+----------+
                       |                     |
                COMMAND CENTER          FIELD MODE   <- NEW, Milestone 13
                  (existing shell         (presentation layer only;
                   + Dashboard,            voice-first, low-density,
                   evolved per             degraded/offline-aware;
                   Milestone 4)            no hardware binding)
```

### What's reused as-is

Auth, encryption, permissions, the proposal engine, memory (incl. semantic
retrieval), cognition, knowledge graph, connections, brain state, events,
notifications, agents. These are sound. VOX 2.0 does not rewrite them — it
makes them visible and connected, per the master directive's own framing
("preserve valuable existing infrastructure").

### What's extended

- **Objectives/Opportunities → Economic Command.** The scoring/evidence
  architecture is correct; it needs a finance-specific specialization
  (`EconomicAsset`, `Revenue`, `Expense` models FK'd to `Opportunity`) rather
  than a parallel system. Autonomy gating reuses `CapabilityLevel` — a new
  `capability: "economic.execute"` key checked via the existing
  `enforceCapability()`, not a second permission system.
- **`LabComponent` → suit digital twin.** Add a `LabSubsystem` enum (HEAD,
  TORSO, ARMS, LEGS, FEET, CORE — extensible), `powerDrawW`, `costUsd`,
  `riskLevel`, `realityStatus` (reuse `LabRealityStatus`, already exists on
  `LabSuit`), and a `LabComponentDependency` join table. Add nullable
  `componentId` FKs to `LabExperiment` and `LabResearchItem` so an
  experiment/research item can target a specific subsystem, not just "the
  suit."
- **`src/lib/chat/service.ts`'s context builder → augmented by, not replaced
  by, the Orchestrator.** Revised during Milestone 10 after actually
  reading `src/lib/lab/aiEngineer.ts`: chat's context assembly (semantic
  memory retrieval + active objective) and the Lab AI Engineer's (regex
  intent-routing to structured Lab data grounding, including real state
  changes like `createLighterVariant`) are genuinely different shapes of
  work, not the same pattern in two places. Forcing them through one
  `resolveContext(userId, { domain, query })` function would be a bad
  abstraction — combining unlike things because they both "gather context
  and call an AI provider" is too shallow a similarity. Instead:
  `src/lib/orchestrator/service.ts` provides `getCrossDomainSnapshot(userId)`
  — a genuinely new capability (a compact picture of what's happening
  across Lab/Proposals/Brain-state/Objectives in one call) that chat's
  system prompt now optionally includes, so chat gains awareness of Lab
  activity and pending approvals it previously had zero visibility into.
  Each domain keeps its own context-gathering logic; the Orchestrator's job
  is the cross-domain summary, not a forced merge.
- **Voice → a real provider abstraction.** `useSpeech.ts` stays as the
  browser-native default implementation but moves behind a
  `VoiceProvider` interface (mirroring `AIProvider`/`ResearchProvider`) so a
  server-side STT/TTS vendor can be added later without touching call
  sites.
- **`manifest.webmanifest` → real offline/degraded mode.** Add a minimal
  service worker (cache the app shell + last-known Command Center data),
  `navigator.onLine` detection, and a `VOXStateIndicator` value
  (`LOCAL`/`CONNECTED`/`DEGRADED`/`OFFLINE`) surfaced in the shell header.

### What's new, built from scratch

- **VOX Orchestrator** (Milestone 10) — described above.
- **Suit digital twin schema + UI** (Milestones 7–8) — subsystem taxonomy,
  per-component engineering metadata, dependency graph, reality-status at
  the component level.
- **Engineering Intelligence / Experiment pipeline** (Milestones 9–10) —
  structured engineering proposals (objective/bottleneck/evidence/approach/
  risk/cost, MEASURED vs ESTIMATED vs SIMULATED vs THEORETICAL labeling) and
  a real `Experiment ↔ Component ↔ Research ↔ Memory` linkage, built on the
  extended `LabComponent`/`LabExperiment` above plus the existing Proposal
  engine for anything consequential.
- **Economic Command** (Milestone 11) — `EconomicAsset`, `Revenue`,
  `Expense` models; a `/finance` (or renamed `/economic`) page that reads
  real rows, not a category filter over Connections.
- **Field Mode** (Milestone 13) — a new route (`/field`) and component tree
  under `src/components/field/`, explicitly a *presentation layer* over the
  Orchestrator/Brain-state/Cognition APIs already in place — no new backend
  reasoning, just a radically different (voice-first, glanceable,
  low-density) rendering of state that already exists.
- **Offline/degraded mode** (Milestone 15) — service worker + connectivity
  state, described above.

## Non-negotiables carried forward unchanged

Everything in `CLAUDE.md`'s "Non-negotiables" section still applies without
exception: no fabricated APIs, provider code stays behind its `src/lib/*`
abstraction, confidence is never silently upgraded, consequential actions
go through `enforceCapability()` + `recordEvent()`, the proposal registry
stays a closed allowlist, remote embedding/research providers stay strictly
opt-in, `.env`/`dev.db`/`src/generated/` never get committed, and
`npm run typecheck && npm run lint && npm test && npm run build` must be
green before any milestone is considered done.

The suit reality boundary (`LabRealityStatus`: REAL/BUILDABLE/PROTOTYPE/
EXPERIMENTAL/CONCEPT/NOT_CONNECTED) already implements Phase 8/24 of the
master directive at the suit level. Extending it to the component level
(above) is required, not optional — a suit-wide status hides the fact that
individual subsystems can be at very different maturity levels.
