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

### Milestone 3 — Application shell — **PARTIALLY DONE**
`AppShell`/`Sidebar`/`AccountMenu`/`MobileBottomNav`/`NotificationBell`
already share one shell (done in the prior session). The orphaned-API-route
question is resolved: `/api/decisions`/`/api/ideas` turned out to be real
(dynamic caller in `ProjectDetailClient.tsx` that static grep missed);
`/api/tools`/`/api/cognition` are unused but permission-gated, no security
cost to leaving them; `/api/hypotheses`/`/api/observations` are unused
*because the underlying data is never created anywhere* — see Milestone 6.
No routes deleted. Remaining shell work: wire `VOXStateIndicator` into the
header once Milestone 15's real connectivity detection exists (do not stub
a fake "Connected" state before then — see Quality Standard's "no fake
functionality" rule).

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

### Milestone 6 — Memory / Cognition UX — **PLANNED, extend existing, +1 real gap found**
Memory, Cognitive Profile, Observations, Hypotheses (via Cognition page),
Knowledge Graph, Research, Proposals, Activity all exist and were restyled
last session. Two real gaps found during Milestone 3:
1. Knowledge Graph has no caller/consumer beyond its own page — connect
   it: surface "related graph entities" on Memory/Project/Objective detail
   views via `findRelated()` (`src/lib/knowledge/service.ts`), so the graph
   becomes infrastructure other pages read, not an island.
2. **`Observation`/`Hypothesis` are never created anywhere** —
   `createHypothesis()`/`createObservation()` exist in
   `src/lib/cognition/service.ts` but nothing calls them (confirmed:
   neither pattern detection nor any detector writes one). The Cognition
   page has always shown an honest empty state for these because there is
   no pipeline producing them. Real scope for this milestone: give
   `detectPatterns()` (`src/lib/cognition/patterns.ts`) — or a new
   sibling function — a path that writes `Observation` rows from real
   `Event`-timeline signals (the data source is already there per
   `PHASE_2_ARCHITECTURE.md`'s "Observation ... may be informed by the
   Event timeline"), and a simple rule for forming a `Hypothesis` from a
   cluster of related Observations. Confidence starts at LOW per the
   existing "never fabricate confidence" rule — same posture as pattern
   detection already uses.

### Milestone 7 — Lab environment — **PLANNED, evolve not rebuild**
The Lab's visual environment (studio lighting, procedural material system,
GLTF architecture, corner-frame/scanline chrome) was rebuilt and verified
last session — this is real, not decorative, per the audit. Remaining per
the master directive: confirm mobile fallback quality specifically (verify
the `LazyMount` WebGL-context-limit mitigation holds up under real mobile
GPU constraints, not just desktop Chromium) and confirm frame budget on a
throttled-CPU profile before calling this milestone's environment bar met.

**Suit rig geometry + material quality pass — DONE (direct user-directed fix).**
The user flagged the procedural suit render as looking bad; a diagnosis
turned up two separable problems, both fixed and re-verified by real
Playwright screenshots against the live app (not just typecheck):
1. **Geometry** (`SuitRig.tsx`): limbs were uniform-radius capsules, hands
   were bare spheres, feet were single boxes, the torso was one uniform
   block with no waist, and there was no neck connecting the head to the
   shoulders. Rebuilt with `THREE.LatheGeometry`-based tapered limbs (real
   bicep/thigh bulge narrowing toward wrist/ankle), a real `Hand` (palm +
   mirrored thumb) and `Boot` (ankle block + sole) shape, a torso split into
   tapered chest/waist volumes, a neck cylinder, blended (enlarged,
   squashed) shoulder caps, and an ellipsoid head. All `SuitRigProps`,
   layer-visibility, and x-ray/explode joint math were left untouched, so
   nothing downstream (inspection tree, explode slider, x-ray toggle) needed
   to change.
2. **Material/color (the bigger actual cause of "looks bad"):** every suit
   in the catalog was rendering as a near-flat, monochrome silhouette. Root
   cause was in `suitDesign.ts`/`SuitRig.tsx` together, not the geometry —
   `createPatternTexture()` filled the ENTIRE surface with `colorSecondary`
   (a deliberately near-black trim tone in every palette entry) and drew
   `colorPrimary` only as thin 50%-alpha accent lines, while
   `outerMaterialProps.color` was also set to `colorPrimary`. Since
   `meshStandardMaterial.color` multiplies into the sampled map texel, that
   multiplied a bright primary color into a near-black background and
   crushed the real lit diffuse response toward black — what was actually
   visible was almost entirely the flat, non-directional `emissive` channel,
   which is why the suit read as a flat colored blob with no shading
   gradient regardless of geometry quality. Fixed by (a) swapping the
   pattern texture so `colorPrimary` — the suit's real, dominant hero color —
   is the base fill and `colorSecondary` is the accent/trim line pattern,
   and (b) setting `outerMaterialProps.color` to white so the map's own
   baked colors render correctly instead of being multiplied down. Verified
   across the full 60-suit catalog grid via a real browser screenshot: every
   suit now shows its own distinct saturated color with a real top-lit/
   shadowed gradient, a visible panel-line pattern, and a readable armor
   plate — not the previous uniform purple silhouette.

Also tightened the default camera framing in `HolographicSuitCanvas.tsx`
(`position`/`fov` reduced, `minDistance` lowered) so the improved geometry
reads at a more legible size by default rather than small/distant, while
leaving `maxDistance` and all orbit bounds unchanged.

Zero console errors in every Playwright pass (front view, rotated 3/4 view,
full suit grid). Full verification gate (typecheck/lint/208 tests/build)
clean. This was scoped strictly to rig geometry + material correctness — it
does not touch the separate mobile-fallback/frame-budget item above, which
remains open.

### Milestone 8 — Suit digital twin — **CORE DONE**
This was the biggest genuine gap the audit found. Schema, service layer,
API, and UI are done and verified (typecheck/lint/191→196 tests/build all
clean, plus a real-browser check against the live API showing subsystem
tags, reality status, power/cost/risk, and resolved dependencies rendering
correctly). Two items intentionally NOT done in this pass, left for a
fast-follow rather than false-claimed complete:
1. **Backfilling existing seeded components onto the new taxonomy** — every
   component created before this migration has `subsystem: null`. A
   name-based best-effort mapping (e.g. "Mask" → HEAD) is possible but
   wasn't done here to avoid guessing wrong on ambiguous names; new
   components (and the AI Lab Engineer, once it's taught about
   `subsystem`) should tag correctly going forward.
2. **A subsystem-level "everything about this region" view** (all
   components + linked experiments + linked research + dependencies for
   one subsystem at a glance) — today you inspect one component at a time
   in the tree. The data model supports the rollup (`componentId` on both
   `LabExperiment` and `LabResearchItem`); the aggregating query + UI is
   Milestone 9's job once Engineering Intelligence needs it, not built
   speculatively ahead of that need.

Original scope, for reference:
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

### Milestone 10 — VOX Orchestrator — **REVISED SCOPE, see VOX_2.0_ARCHITECTURE.md**
Original plan (a single `resolveContext()` both chat and the Lab AI
Engineer route through) didn't survive contact with the actual code: the
Lab AI Engineer (`src/lib/lab/aiEngineer.ts`) does regex intent-routing to
structured Lab-data grounding, including real state changes
(`createLighterVariant`) — a different shape of work from chat's semantic-
memory-retrieval context assembly, not the same pattern twice. Forcing a
merge would be a bad abstraction. Revised scope: `src/lib/orchestrator/
service.ts` exports `getCrossDomainSnapshot(userId)` — a new aggregation
(Brain state + pending-proposal count + Lab activity + active objective in
one call) that chat's system prompt now optionally folds in, giving chat
real visibility into Lab/Proposals state it had none of before. Each
domain keeps its own context logic; the Orchestrator's job is the
cross-domain summary specifically, not a forced routing layer.

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
