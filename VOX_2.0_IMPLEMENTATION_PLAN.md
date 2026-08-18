# VOX 2.0 Implementation Plan

Sequenced against the real Phase 0 audit in `VOX_2.0_ARCHITECTURE.md`, not
against the master directive's milestone list blindly — where the audit
found something already working, the milestone shrinks to "extend it";
where the audit found something missing, the milestone is a real build.
Every milestone ends with the verification gate + visual QA from
`VOX_2.0_QUALITY_STANDARD.md` before moving to the next.

## Status legend

**DONE** — verified complete this session/prior sessions. **IN PROGRESS**
— actively being worked. **PLANNED** — scoped, not started.

---

### Milestone 1 — Repository audit + architecture — **DONE**
Phase 0 audit complete (5 parallel research passes + direct reads).
Findings recorded in `VOX_2.0_ARCHITECTURE.md`.

### Milestone 2 — Design system (token evolution) — **PLANNED, next**
`VOX_2.0_DESIGN_SYSTEM.md` written. Remaining work: apply the neutral-
foundation token changes to `globals.css`, rename the `src/components/ui/*`
primitives per the mapping table, unify `CommandPalette`/`LabCommandBar`
into one `VOXCommandBar`. This touches every page indirectly (token-level),
so it must land before Milestones 3–6 build more surface area on top of it.
Scope check: this is a *token and primitive* pass, not a full re-layout of
every page again — the structural/spacing work from the prior "luxury
redesign" pass stays, only the color language shifts.

### Milestone 3 — Application shell — **PLANNED**
`AppShell`/`Sidebar`/`AccountMenu`/`MobileBottomNav`/`NotificationBell`
already share one shell (done in the prior session). Remaining: fold in the
`VOXStateIndicator` (LOCAL/CONNECTED/DEGRADED/OFFLINE, depends on Milestone
15's connectivity detection — stub the indicator now, wire real detection
later) and resolve the orphaned-API-route question from the audit (verify
`/api/hypotheses`, `/api/ideas`, `/api/decisions`, `/api/observations`,
`/api/tools`, `/api/cognition` truly have no caller, then either wire a
surface to them or remove them — do not carry dead API surface into 2.0
silently).

### Milestone 4 — Command Center — **PLANNED**
Dashboard already restructured (Milestone 42 of the prior session) with a
real greeting, `StatCard`s, Quick Actions, Brain preview link. Gap vs. the
master directive: it should read from more of the system (economic status,
suit/lab status, pending proposals count prominently, not just linked)
rather than being link-heavy. Extend, don't rebuild — the panel-overload
problem the directive warns about is not present (the prior pass already
established hierarchy + negative space).

### Milestone 5 — Cognitive visualization — **PLANNED, mostly reusable**
`getBrainState()` (`src/lib/brain/graph.ts`) is real and already the
correct shape (idle/thinking/researching/executing/waiting/learning/error
derived from `AgentRun`/`Proposal`). `BrainStateBadge` exists. Work here is
UI depth, not new backend: make the state visualization in `BrainWorkspace`
and the Command Center consistent (today `BrainStateBadge` may only render
in one place — audit its usage sites and ensure the same real state drives
every visual instance of "what is VOX doing right now").

### Milestone 6 — Memory / Cognition UX — **PLANNED, extend existing**
Memory, Cognitive Profile, Observations, Hypotheses (via Cognition page),
Knowledge Graph, Research, Proposals, Activity all exist and were restyled
last session. Gap: Knowledge Graph has no caller/consumer beyond its own
page (audit finding) — connect it: surface "related graph entities" on
Memory/Project/Objective detail views via `findRelated()`
(`src/lib/knowledge/service.ts`), so the graph becomes infrastructure other
pages read, not an island.

### Milestone 7 — Lab environment — **PLANNED, evolve not rebuild**
The Lab's visual environment (studio lighting, procedural material system,
GLTF architecture, corner-frame/scanline chrome) was rebuilt and verified
last session — this is real, not decorative, per the audit. Remaining per
the master directive: confirm mobile fallback quality specifically (verify
the `LazyMount` WebGL-context-limit mitigation holds up under real mobile
GPU constraints, not just desktop Chromium) and confirm frame budget on a
throttled-CPU profile before calling this milestone's environment bar met.

### Milestone 8 — Suit digital twin — **PLANNED, real schema work**
This is the biggest genuine gap the audit found. Scope:
1. Prisma: `LabSubsystem` enum (HEAD/TORSO/ARMS/LEGS/FEET/CORE), add to
   `LabComponent`; add `powerDrawW Float?`, `costUsd Float?`,
   `riskLevel LabRiskLevel?` (new enum: LOW/MODERATE/HIGH/UNKNOWN),
   `realityStatus LabRealityStatus @default(CONCEPT)` to `LabComponent`;
   new `LabComponentDependency` join table (`componentId`, `dependsOnId`);
   new nullable `componentId` FK on `LabExperiment` and `LabResearchItem`.
2. Service layer: extend `src/lib/lab/components.ts` for subsystem-scoped
   queries, dependency-graph read (bounded traversal, same pattern as
   `findRelated()`).
3. UI: subsystem selector in the Lab's component inspection tree
   (`HolographicInspectionTree.tsx`), each subsystem reveals the full field
   set the master directive names (name/version/function/status/materials/
   weight/power/cost/dependencies/research/tests/risks/next action).
4. Migrate existing seeded components onto the new taxonomy (best-effort
   mapping from free-text names to subsystems — flag ones that don't map
   cleanly rather than guessing).

### Milestone 9 — Engineering intelligence / experiment system — **PLANNED**
Depends on Milestone 8 (needs `componentId` links to be meaningful). Build
the structured engineering-proposal shape (objective/bottleneck/evidence/
approach/risk/cost/MEASURED-ESTIMATED-SIMULATED-THEORETICAL labeling) as a
new `actionType` the existing Proposal engine already supports
(`src/lib/cognition/proposals.ts` — closed action registry, add one
handler, no new permission system needed). Experiment ↔ Component ↔
Research ↔ Memory linkage uses the FKs added in Milestone 8.

### Milestone 10 — VOX Orchestrator — **PLANNED, extraction + generalization**
Extract `src/lib/chat/service.ts`'s context-assembly pattern into
`src/lib/orchestrator/service.ts`. Entry point:
`resolveContext(userId, { domain, query }) → ContextTrace` (reuse the
`ContextTrace` shape from `PHASE_2_ARCHITECTURE.md` §6, already
implemented for chat). Migrate chat to call the orchestrator instead of
having its own copy; wire the Lab AI Engineer (`/api/lab/ai`) to the same
entry point next, so there are not two independent "gather context and ask
the AI provider" implementations.

### Milestone 11 — Economic Command — **PLANNED, real schema work**
New Prisma models: `EconomicAsset` (name, category, status, revenue/
expense rollups, `opportunityId` FK), `Revenue`/`Expense` (amount, date,
`assetId` FK, source). Reuses `Opportunity.confidence`/`effort`/`risk`
scoring as-is. Autonomy gating: add `capability: "economic.execute"` +
`"economic.propose"` keys checked via the existing `enforceCapability()` —
do not build a second permission system. `/finance` (or rename to
`/economic`, decide during the milestone and update `Sidebar.tsx`
consistently) reads real `EconomicAsset` rows instead of filtering
Connections.

### Milestone 12 — Connections — **PLANNED, mostly done**
Lifecycle, permission-gating, encryption, audit events are all real per
the audit. This milestone is UI polish only: surface `capabilities`/
`lastSync`/`errorState` more prominently per-connection (the master
directive's explicit field list) if any are currently under-surfaced —
audit the `ConnectionsHubClient` render against that field list before
writing new code.

### Milestone 13 — Field / HUD Mode — **PLANNED, new, presentation-layer only**
Confirmed absent. New route `/field`, new `src/components/field/` tree.
Explicitly a thin rendering layer over Brain state + Cognition + the
Orchestrator (Milestone 10) — voice-first, glanceable, high-contrast, no
new backend reasoning. No hardware binding (must not assume a specific
headset API). Ship behind a nav entry that's honest about its status
(`REQUIRES HARDWARE` badge, since there is no headset to actually wear it
on yet) rather than presenting it as feature-complete.

### Milestone 14 — Voice architecture — **PLANNED, extend existing**
`src/lib/voice/useSpeech.ts` already provides real STT/TTS via the Web
Speech API. Work: extract a `VoiceProvider` interface
(`listen()`/`speak()`/`id`), make the existing hook the default
implementation behind it (mirroring `AIProvider`), add the
confirm/execute pipeline for consequential voice commands (routes through
`enforceCapability()`, same as every other consequential action — voice is
an input modality, not a new authorization path), and add the test
coverage this module currently lacks (audit finding).

### Milestone 15 — Offline / degraded mode — **PLANNED, real gap**
`manifest.webmanifest` exists (installable metadata only). Add: a minimal
service worker (app-shell + last-known Command Center data caching),
`navigator.onLine` + a periodic health-check against `/api/health` to
drive `VOXStateIndicator`'s four states, and an explicit degraded-mode
banner rather than silent failure when the AI provider / a Connection is
unreachable.

### Milestone 16 — Security — **PLANNED, close audit gaps**
`src/lib/security/` and `src/lib/integrations/` have zero test coverage
(audit finding) — close both. Re-verify the orphaned API routes from
Milestone 3 are actually gone or actually wired (dead authenticated routes
are attack surface). Otherwise the security architecture (encryption,
sessions, CSRF, rate-limiting, headers) is sound per `SECURITY.md` and
needs no structural change.

### Milestone 17 — Performance — **PLANNED**
Audit bundle size/dynamic-import boundaries once Milestones 2–13 land (not
before — premature optimization of surfaces about to be rewritten is
wasted effort). Known good pattern to keep applying: `LazyMount` +
`next/dynamic(ssr:false)` for WebGL, already proven in the Lab.

### Milestone 18 — Accessibility — **PLANNED, verify + extend**
Base a11y primitives already exist (`:focus-visible`, 44px tap targets,
`prefers-reduced-motion` coverage across `.vox-*`/`.lab-*`/`.vox-core-*`
animation classes). Work: a real screen-reader pass (not just automated
lint) on the Command Center, Lab, and any new Milestone 8–13 surfaces once
built.

### Milestone 19 — Full QA — **PLANNED**
Full visual QA pass (per `VOX_2.0_QUALITY_STANDARD.md`) across every route
once Milestones 2–18 land, desktop + mobile, logged in with a real
account, screenshotted, console-error-checked.

### Milestone 20 — Production hardening — **PLANNED**
Final `typecheck && lint && test && build`, merge to the deploy branch,
confirm the Fly.io workflow succeeds, smoke-test the live health endpoint,
update this document's status column to reflect final state.

---

## Sequencing notes

- Milestone 2 (design system token shift) blocks meaningful visual work on
  3–6 — do it first even though it touches many files, so later milestones
  aren't restyled twice.
- Milestones 7 and 8 (Lab environment, suit digital twin) can run in
  parallel with 2–6 (different files, no shared dependency) once Milestone
  2's tokens exist.
- Milestone 10 (Orchestrator) should land before 13/14 (Field Mode, Voice)
  since both are meant to be thin layers over it, not independent context-
  gathering implementations.
- Milestones 16–20 are gates, not features — they run continuously
  alongside the others, not only at the end (test coverage closes as each
  subsystem is touched, per `VOX_2.0_QUALITY_STANDARD.md`'s testing-debt
  section), with Milestone 19/20 as the final confirming pass.
