# VOX V2 — Brain-First Rebuild: Audit + Phased Plan

This document tracks the "VOX V2 — Complete Re-Architecture, Brain-First AI
Operating System" directive. It is a **continuation of the VOX 2.0 initiative**
(see `VOX_2.0_ARCHITECTURE.md` / `VOX_2.0_DESIGN_SYSTEM.md` /
`VOX_2.0_QUALITY_STANDARD.md` / `VOX_2.0_IMPLEMENTATION_PLAN.md`), not a
parallel rebuild — this directive's core demand (make the Brain the actual
center of gravity of the app, not a page among fifteen) is a real, well-scoped
escalation of work already in flight, and a large amount of what it asks for
already exists and is real per the VOX 2.0 audit (design tokens, a genuinely
state-driven Brain workspace, the cross-domain orchestrator, memory/cognition,
the Lab digital twin). Per the directive's own instruction ("do not blindly
delete working infrastructure... KEEP THE BRAIN, REBUILD THE BODY"), this plan
builds on that instead of restarting.

## Phase 0 — Audit (grounded in the actual current code, not the VOX 2.0 docs'
memory of it — re-verified where it matters for this directive)

### What's already real and should be preserved
- **Brain is genuinely state-driven, not decorative.** `getBrainState()`
  (`src/lib/brain/graph.ts`) derives idle/thinking/researching/executing/
  waiting/learning/error from real `AgentRun`/`Proposal` rows —
  `BrainWorkspace.tsx` renders that, not a timer loop. Verified earlier this
  session (VOX 2.0 Milestone 5) and confirmed again in this audit pass.
- **Cross-domain orchestration exists.** `src/lib/orchestrator/service.ts`'s
  `getCrossDomainSnapshot()` aggregates Brain state, pending proposals, Lab
  dashboard, and the active objective — real data, feeding chat's system
  prompt today (Milestone 10).
- **Mobile bottom nav already avoids the "5 tabs overflowing" anti-pattern**
  the directive describes. `MobileBottomNav.tsx` is 4 tabs + a "More" drawer
  fallback. Re-verified with a real Playwright pass at 375px against
  `/dashboard`, `/brain`, `/lab`, `/lab/suits`: **0px horizontal overflow, 0
  console errors on all four.** The overflow problem the directive describes
  does not reproduce on current code — either it predates the earlier
  Workstream A mobile pass, or the reference screenshot was from an older
  build. Flagging this honestly rather than "fixing" something that isn't
  currently broken; will keep testing more pages as this plan proceeds rather
  than assume the whole app is clean from 4 samples.
- **Design tokens, memory/cognition backend, permission system, Lab digital
  twin (subsystem/risk/reality-status/dependencies), Economic Command,
  structured engineering proposals** — all real per VOX 2.0 Milestones 2,
  5, 6, 8, 9, 10, 11. Not being rebuilt.

### Real, concrete gaps this directive identifies that VOX 2.0 had not yet closed
1. **The app is not Brain-first at the architecture level.** Root `page.tsx`
   redirects a logged-in user to `/dashboard`, not `/brain`. The Sidebar's
   first nav item is "Home," with "VOX Brain" third. The directive's own
   hierarchy (`§3`) and closing narrative (`§49`) both put BRAIN first — the
   landing experience, not a secondary destination.
2. **Global search / Quick Command is route-navigation only.** `CommandPalette.tsx`
   (⌘K) is a static list of ~20 hardcoded page links filtered by label —
   it does not search memories, projects, tasks, research, Lab items, or
   events (`§43`). A separate `/api/memories/search` exists but isn't wired
   into a unified surface. This is a real, well-defined gap.
3. **No cognitive event bus / live system feed.** `Event` rows are written
   (`recordEvent`) and read on page load (`listRecentEvents`), but nothing
   pushes them to the client in real time — the "VOX ONLINE / 3 memories
   retrieved / simulation complete" live feed described in `§22` doesn't
   exist as a live stream today, only as a static list fetched per page load.
4. **Voice is not wired to a real provider.** `useSpeech.ts` exists (browser
   Web Speech API wrapper) but there's no clean provider abstraction the
   directive asks for (`§24`) — this was already flagged as VOX 2.0
   Milestone 14, still PLANNED.
5. **Lab presentation is still a single "cinematic" viewer, not the
   Cinematic/Engineering mode split with technical overlays the directive
   describes (`§18-20`).** The suit geometry/material fix shipped this
   session is real, load-bearing underlying rendering quality (correct PBR
   material response, real tapered geometry) — exactly the kind of
   "underlying functionality" `§31` says to preserve. What's missing is the
   presentation layer on top: a structured Engineering Mode (specs/
   components/materials/dimensions/power/thermal/cost/testing/version
   history as real structured data, which `LabComponent`/`LabExperiment`
   already have) distinct from the Cinematic Mode viewer, plus reality-status
   labeling surfaced more prominently per value (CONCEPT/ESTIMATE/SIMULATION/
   MEASURED/PROTOTYPE/VERIFIED — the app already has `LabRealityStatus` and
   `LabConfidence` for exactly this; the gap is UI-level, not data-level).

## Phase ordering (mapped onto the directive's own Phase 0-8 structure)

| Directive Phase | Concrete VOX milestone here | Status |
|---|---|---|
| 0 — Audit | This document | **DONE** |
| 1 — Design system | VOX 2.0 Milestone 2 (neutral tokens, StateIndicator) | **DONE**, reused |
| 2 — Brain | Brain-first entry point + nav reorder | **DONE** |
| 2b — Quick Command | Real cross-domain search (below) | **DONE** |
| 3 — Cognitive orchestration | Live event bus transport + Brain UI wired to it (below) | **DONE** |
| 4 — Home/Projects/Memory/Research | Already real UI (Workstream A); revisit only where Brain-first nav changes their entry paths | Mostly done, spot-check only |
| 5 — Laboratory | Cinematic/Engineering mode split on top of the real suit rendering fix | PLANNED |
| 6 — Systems/Connections | Connections Hub already real (Milestone 12); no new work identified yet | Mostly done |
| 7 — Mobile | Spot-checked clean on 4 pages; broaden the sweep as other phases land | Ongoing |
| 8 — Polish | Final pass once the above land | Not started |

## Milestone: Brain-first entry point + navigation reorder — DONE

Smallest, most concrete, most directly-demanded change with the least risk of
destroying working infrastructure (nothing is deleted, every existing route
stays reachable):

1. `src/app/page.tsx` — logged-in redirect target changes from `/dashboard`
   to `/brain`.
2. `Sidebar.tsx` — "VOX Brain" becomes the first item in the primary group,
   ahead of "Home."
3. `MobileBottomNav.tsx` — same reorder for the bottom tab bar.
4. Verify `/brain` behaves correctly as a fresh landing surface for a
   brand-new user with zero data (idle state, empty panels, no broken
   assumptions about being a "secondary" page) — real Playwright check, not
   an assumption.

Explicitly NOT in this milestone: rebuilding Brain's internal layout,
Quick Command's real cross-domain search, the live event bus, or the Lab
presentation split — each is its own milestone below, sequenced next.

## Milestone: Real cross-domain Quick Command — DONE

Replaced the static route-list-only ⌘K palette with genuine cross-domain
search, per the "VOX V2 — Continue from current state" directive's priority
#1.

1. **`src/lib/search/service.ts`** — `searchEverything(userId, query)`
   queries memory (reusing the existing embeddings-based
   `getSemanticMemories()` — real semantic ranking, not new), the Lab
   (reusing the existing `searchLab()` from Milestone 8/task #8 rather than
   duplicating it), and direct `contains` queries across Objective,
   Opportunity, Goal, Task, Project, ResearchItem, EconomicAsset, and recent
   Events — all scoped to the requesting user. Returns one unified
   `SearchResult[]` (`source`, `type`, `title`, `subtitle`, `timestamp`,
   `relevance`, `href`), sorted by a real deterministic relevance heuristic
   (exact match > prefix > substring on the actual matched text — not a
   fabricated ML score).
2. **`/api/search`** — standard `requireUser()`/`jsonOk()` route wrapping it.
3. **`CommandPalette.tsx`** — rewritten to merge the existing static
   navigation commands with live, debounced (200ms, `AbortController`-backed
   — the same proven pattern already shipped in `LabCommandBar.tsx`) search
   results, grouped by type, single keyboard-navigable list.
4. **`tests/search.test.ts`** (6 new tests) — short-query guard, real
   cross-domain matches, Lab reuse, ranking sanity, and cross-user isolation.
5. Verified live in the browser, not just via tests: a real query
   ("suit") returned genuinely grouped, real results (Lab gadgets,
   tutorials, experiments, a system event) with zero console errors on
   desktop; clicking a result (`EXP-004 — Noise profile reduction`)
   navigated to the actual experiment's real detail URL — confirmed
   end-to-end, not just that a network request fired. Re-verified clean at
   375px mobile (0px horizontal overflow).

**Explicitly deferred, not silently dropped:** the directive's action layer
("create a milestone for Mask V3 called material testing" as a structured
write, not a search) is real additional scope — natural-language intent
parsing plus a safe confirmation/permission boundary for write actions
initiated from free text. Building that hastily onto this pass would mean
either a fragile keyword-matcher or skipping the "never execute dangerous
actions without confirmation" requirement the directive itself states.
Left as a follow-up milestone once the event bus (next) gives the command
bar a place to show that kind of pending-confirmation state.

## Milestone: Live event bus (transport) — DONE

Priority #2 of the "VOX V2 - continue from current state" directive, scoped
deliberately to the transport itself — connecting the Brain's visualization
to it is priority #3's job (next), so its own diff and verification stay
separable per the directive's own phase boundaries ("do not accumulate huge
unverified changes").

1. **`src/lib/events/bus.ts`** — an in-process `EventEmitter`-based
   publish/subscribe channel (`publishEvent`/`subscribeToEvents(userId, cb)`).
   Documented deployment constraint: correct for VOX's current single-machine
   Fly deployment (`fly.toml`: `min_machines_running = 1`), not multi-instance
   — but the transport is fully isolated behind those two functions so a
   real horizontally-scaled deployment could swap in a message broker later
   without touching any caller.
2. **`recordEvent()`** (`src/lib/observability/events.ts`) now calls
   `publishEvent()` with the exact row it just durably wrote, right after
   the write — nothing on the bus is ever synthetic; every frame traces back
   to a real `Event` table row.
3. **`/api/events/stream`** — a real SSE (`text/event-stream`) route,
   `runtime = "nodejs"` (matching the existing streaming convention in
   `/api/chat`), one `data: {...}\n\n` frame per event for that user, a
   25s heartbeat comment frame, and real cleanup (`unsubscribe()`) on both
   `ReadableStream.cancel()` and `request.signal`'s `abort` event.
4. **`tests/event-bus.test.ts`** (5 new) — per-user delivery isolation,
   unsubscribe actually stops delivery, multiple concurrent subscribers for
   one user (multi-tab/device) both receive a frame, and a real integration
   test proving `recordEvent()` publishes the exact persisted row.
5. **Verified live, end-to-end, across two separate HTTP requests** — not
   just unit tests: opened a real browser `EventSource` against
   `/api/events/stream`, then in a second real request called
   `POST /api/lab/experiments` (which calls `recordEvent()` with type
   `lab.experiment.created`); the SSE connection received exactly that
   frame, with `subjectId` matching the created experiment's real id and
   the payload title matching what was actually sent. First attempt at this
   check used `POST /api/tasks` and got 0 frames — traced that to
   `createTask()` simply not calling `recordEvent()` at all (not a bus bug),
   corrected the check to an already-instrumented action, and confirmed
   real delivery.

Full verification gate clean: typecheck, lint, 223 tests, production build.

## Milestone: wire the Brain visualization to the live event bus — DONE

Priority #3. Completes the transport built in the previous milestone by
giving it a real, verified UI consumer.

1. **`src/lib/events/useEventStream.ts`** — client hook wrapping
   `EventSource` against `/api/events/stream`. Feature-detects
   `EventSource` via `useSyncExternalStore` (same pattern as
   `useSpeech.ts`'s `supported` checks, avoiding a real
   `react-hooks/set-state-in-effect` lint violation the naive version hit)
   rather than `setState` inside an effect body. Returns an honest
   `"connecting" | "open" | "unsupported"` status — never a fabricated
   "always live" claim.
2. **`BrainWorkspace.tsx`**: the old 20s blind poll is now a 60s *fallback*
   (widened, since the live stream is the primary path — only needs to
   catch a missed frame or a reconnect gap). New events arriving over SSE
   append to the existing `events` state immediately, and trigger a
   debounced (600ms) refetch of `/api/brain/graph` so node/edge/brain-state
   changes implied by that event get picked up from the real authoritative
   server state — deliberately NOT guessed client-side from the event type
   string, since that would risk exactly the "fake state" the directive
   prohibits. Added an honest connection-status dot (reusing
   `StateIndicator`, whose doc comment had already anticipated this exact
   use case) next to the existing Brain state badge — hidden on mobile to
   avoid toolbar clutter.
3. **Verified live in a real browser, not inferred from code review**:
   opened `/brain` on the Activity perspective, screenshotted the timeline,
   then in a separate request created a real Lab experiment
   (`POST /api/lab/experiments`) and screenshotted again 2 seconds later
   with **no page reload** — a new "lab experiment created" entry appeared
   at the top of the timeline with a timestamp matching the moment it was
   created. Re-verified 0px horizontal overflow and zero console errors at
   375px mobile.

Full verification gate clean: typecheck, lint, 223 tests, production build.

## Milestone: voice provider abstraction — DONE

VOX 2.0 Milestone 14 / the new directive's §17. Voice already worked in
`ChatClient.tsx` via the browser's native Web Speech API
(`src/lib/voice/useSpeech.ts` — real STT/TTS, no mock), but there was no
seam a future non-browser provider could plug into, and no unified status
vocabulary.

1. **`src/lib/voice/useVoice.ts`** — the one entry point VOX's UI should use
   for voice going forward, matching "voice uses the same orchestration as
   text, not a separate system." A thin wrapper over the existing, already-
   working `useSpeechToText`/`useTextToSpeech` hooks (deliberately not
   rewritten — they're real and tested), exposing a stable `VoiceState`
   contract: unified `status` (`offline | ready | listening | processing |
   speaking | error`), `provider` tag (`"browser" | "none"` today), and
   `sttSupported`/`ttsSupported` reported separately and honestly (a
   browser can have one without the other). `"processing"` is in the type
   for a future streaming remote provider that would genuinely have that
   phase — the browser provider never emits it, since the Web Speech API
   has no such phase; documented as an honest omission, not a placeholder.
2. **`ChatClient.tsx`** migrated from calling the two raw hooks directly
   (25 call sites) to the single `useVoice()` hook — removes the "two ways
   to access voice" duplication the directive explicitly warns against.
   Pure pass-through refactor: `voice.listening`/`voice.speak()`/etc. are
   the exact same underlying state/functions as before, just accessed
   through the unified contract.
3. No dedicated unit test — this codebase has no component/hook-rendering
   test infrastructure (all existing tests are service-level Vitest), and
   adding one (e.g. React Testing Library) for a single thin wrapper would
   be exactly the "unnecessary dependency explosion" the directive warns
   against. Verified instead the way this session verifies UI behavior
   throughout: typecheck (caught nothing — confirms structural equivalence
   of the refactor) plus live Playwright against the real `/chat` page —
   sent a real message through the full mock-AI round trip post-migration
   (unchanged, correct), clicked the mic button and a message's TTS play
   button (zero console errors, no crash on either). The listening/speaking
   states didn't visibly latch in this headless sandbox, which is a real
   environment limitation (no real mic/audio hardware satisfying the Web
   Speech API's full permission chain even with fake-device flags) — not a
   regression, since the underlying hook implementation wasn't touched.

Full verification gate clean: typecheck, lint, 223 tests, production build.

## Milestone: Lab Cinematic/Engineering split — Phase A (engineering domain model) — DONE

Per the "VOX — Spider-Man Lab: Cinematic Mode + Engineering Mode Split"
directive. Audited the existing Lab schema first (`LabProject`, `LabSuit`,
`LabComponent` + dependencies, `LabExperiment`, `LabResearchItem`,
`LabDesignNote`, etc. — all real, from earlier milestones) before adding
anything, per the directive's own "do not touch what doesn't need
touching" rule. Three genuinely missing structured concepts identified and
built; everything else (digital twin, subsystem taxonomy, reality-status
labeling, experiments) already existed and is reused as-is.

**Schema** (migration `20260821222240_lab_engineering_domain`):
- `LabRequirement` — `LabRequirementStatus` (HYPOTHESIS/MODELED/TESTED/
  VERIFIED) as a deliberately separate axis from `LabConfidence` (evidence
  quality). Links to suit/subsystem/component/experiment.
- `LabEngineeringQuestion` — first-class unresolved-question tracking
  (importance, researchStatus, currentHypothesis, confidence, resolved/
  resolvedAt/answer).
- `LabDecision` — immutable decision log (context/options/selectedOption/
  rationale/evidence/tradeoffs/author/confidence) — no update/delete
  function exists for it on purpose; a reversal is a new decision row, not
  an edit, so history is never lost.
- `LabResearchLink` — polymorphic link (same `subjectType`/`subjectId`
  convention as the existing `LabDesignNote`) from a REAL core `ResearchItem`
  to any Lab object. This is the concrete answer to "reference existing
  research records, don't duplicate research inside the Lab": `LabResearchItem`
  (hand-entered/AI-Lab-Engineer notes) stays untouched as its own real,
  separate concept: `LabResearchLink` is for pointing at VOX's actual
  web-search-backed research instead of re-entering it.
- Deliberately NOT changed: `LabExperimentStatus` already covers PLANNED→
  RUNNING→COMPLETED→FAILED/ABANDONED closely enough to the directive's
  ask that adding ANALYZED/INVALID as new values wasn't worth a schema
  migration for marginal semantic gain — documented as a deliberate no-op.

**Enforcement, not just labeling:** `updateRequirement()` throws if a
caller tries to set `status: "VERIFIED"` without non-empty `evidence` —
the "never imply a prototype measured something it didn't" rule is a real
guard, not a UI convention someone could bypass via the API.

**Service + API layer:** `src/lib/lab/{requirements,questions,decisions,
researchLinks}.ts`, each following the established `recordEvent()`-on-
creation/status-change pattern (so this domain is event-bus-connected from
day one — `lab.requirement.created`, `lab.requirement.status_changed`,
`lab.question.created`, `lab.question.resolved`, `lab.decision.recorded`,
`lab.research_link.created`) — real routes under `/api/lab/{requirements,
questions,decisions,research-links}`.

**Quick Command integration:** `searchLab()` (already the cross-domain
search's Lab-domain source, from Milestone 8/the Quick Command milestone)
extended to include Requirements/Engineering Questions/Decisions — no
second Lab-specific command parser was created, per the directive's
explicit instruction.

**Tests:** `tests/lab-engineering-domain.test.ts` (11 new) — HYPOTHESIS
default, the VERIFIED-without-evidence rejection, VERIFIED-with-evidence
success, per-user scoping, question resolution + idempotent re-save,
unresolved filtering, decision recording, and three research-link
ownership tests (real link succeeds; refuses a research item the caller
doesn't own; refuses a subject the caller doesn't own).

Full verification gate clean: typecheck, lint, 234 tests, production build.

**Explicitly not yet done** (this was schema/service/API only, per the
"commit logically, continue" workflow rule) — the actual Cinematic Mode
and Engineering Mode UI, the mode switch with context preservation, digital
twin subsystem-selection wiring, the live activity layer, and Brain
integration verification are the next milestone, continuing immediately.

## Milestone: Lab Cinematic/Engineering split — Phase B (UI) — DONE

Built on Phase A's schema/services. Real, important discovery made before
writing any new UI: `src/components/lab/InfoMode.tsx` already had a real,
shipped, three-way mode system (`CINEMATIC`/`ENGINEERING`/`EVERYTHING`,
context + localStorage-persisted, rendered as the pill toggle already
visible in the Lab's global header) — used today only as a field-density
filter (fewer stat rows in Cinematic). Per "build ONE Lab domain, no
duplicated source of truth," this was reused as the mode-switching
mechanism rather than building a second one; the actual work was making
the two modes genuinely different layouts, not just different field
counts, and wiring the new engineering domain + live events into them.

**`SuitDetailClient.tsx` rewritten** around a shared `CinematicView` /
`EngineeringView` split, both fed by the same suit/components/requirements/
questions/decisions data (server-fetched once in `page.tsx`, no duplicated
source of truth):
- **Subsystem selection** (`?subsystem=` URL param) is the shared context
  that survives a mode switch, per the directive's explicit "select POWER
  in Cinematic, switch to Engineering, still looking at POWER" requirement
  — verified live, not assumed (see below).
- **CinematicView**: large centered model, compact stat bars, a real
  "Project Status" summary (`X / Y requirements verified`, open question
  count, decisions logged, reality status — all real counts, never
  fabricated), a "Needs Attention" panel surfacing real unresolved
  questions by importance, and a **Live Activity** panel wired to
  `useEventStream()` (built in the earlier event-bus milestone), filtered
  to events whose subject or payload actually references this suit —
  genuinely event-driven, not a decorative animation loop.
- **EngineeringView**: the existing dense stats/component-tree/notes
  layout, plus three new panels — Requirements (status-advance button that
  refuses to reach VERIFIED without a real evidence prompt, enforced
  server-side too), Engineering Questions (resolve-with-answer flow),
  Decision Log (immutable, append-only) — each with its own quick-add form
  hitting the real Phase A API routes.

**Real bugs found and fixed during mobile/visual testing** (not just
claimed — actually caught by looking at screenshots, not just checking
overflow=0px):
1. A 2-column stat-bar grid in Cinematic mode caused label/value text to
   visually collide (`StatBar`'s fixed-width label + bar don't fit two per
   row at this panel width) — changed to a single-column stack, matching
   how `StatBar` is already used correctly everywhere else in this file.
2. The header action-button row (`Duplicate`/`Archive`/`Generate Lighter
   Variant`/`Ask AI Engineer`) had no `flex-wrap`, so on a 375px viewport
   button *text* wrapped internally into overlapping multi-line labels
   instead of whole buttons wrapping onto new rows — added `flex-wrap` to
   the container and `whitespace-nowrap` to each button. This bug predates
   this milestone (the row was carried over unchanged from before), caught
   because mobile testing was actually done, not skipped.

**Verified live in the browser, full workflow, not a mockup:**
switched Cinematic → Engineering → confirmed `?subsystem=ARMS` persisted in
the URL both directions; created a real requirement, question, and decision
through the Engineering panels and confirmed each appeared immediately;
switched back to Cinematic and confirmed the Live Activity panel showed
"Lab Question Created" / "Lab Requirement Created" with real timestamps —
this is the event bus actually driving the Lab's UI, per the directive's
explicit requirement that Lab activity flow through the existing bus, not a
second one. Zero console errors throughout. Re-verified 0px horizontal
overflow on mobile for both modes after the two fixes above.

**Explicitly not done in this pass** (documented, not silently dropped):
- The digital twin's 3D model itself doesn't yet visually highlight/select
  by subsystem when a subsystem chip is clicked (the chip filters the
  Requirements/Questions lists; the model render is unchanged by
  selection). Wiring `SuitRig`'s existing per-part rendering to accept a
  highlighted-subsystem prop is a real, scoped follow-up, not attempted
  here to avoid touching the 3D rig again this session without a full
  re-verification pass dedicated to it.
- `LabResearchLink` (Phase A) has real API routes but no UI surface yet to
  attach research to a requirement/question/decision from this page.
- The Lab dashboard (`/lab`) itself doesn't yet surface the two-mode split
  or cross-suit requirement/question rollups — this was scoped to the suit
  detail page specifically, matching where the digital twin already lives.
- The Quick Command action layer (natural-language writes like "create a
  requirement for X") remains deferred from the earlier Quick Command
  milestone — Requirements/Questions/Decisions are searchable via Quick
  Command (Phase A) but not yet creatable from it.

Full verification gate clean: typecheck, lint, 234 tests, production build.

## Reconciling the "VOX — Complete Autonomous AI Ecosystem" directive

A second, larger master directive arrived after this plan was already
executing priorities #1-#3. Per its own instruction ("preserve... unless
there is a concrete reason to replace it" / "do not repeatedly ask
permission"), this is treated as an extension of the same in-flight Brain-
first rebuild, not a restart — the audit below is a genuine delta against
what's already real, not a re-audit from zero.

**Already real, substantially satisfying that directive's asks, no new work
identified:** the Brain orchestration loop (perception→memory→cognition→
planning→tools→execution is what `getBrainState()` + the orchestrator +
now the live event bus together implement); Memory (categories, confidence,
relations, semantic retrieval — already real per earlier VOX 2.0 milestones);
Knowledge Graph (connected, Milestone 6); Research Engine (real
provider-abstracted, already feeds memory); Security/permissions
(`enforceCapability`, encrypted memory, audit events — already real,
already documented in `SECURITY.md`); Connections Hub (real lifecycle +
capability gating, Milestone 12); Lab digital twin data model (subsystem/
risk/reality-status/dependencies, Milestone 8) and structured engineering
proposals (Milestone 9).

**Genuinely new scope this directive adds, not yet built — queued as real
future milestones, not attempted in this pass:**
1. **Economic Engine / Venture depth.** The existing Economic Command
   (Milestone 11: `EconomicAsset`/`Revenue`/`Expense`, real ledger math) is
   a solid foundation but doesn't yet have this directive's fuller shape:
   opportunity *scoring* (comparing by return/capital/time/automation/risk),
   a distinct venture *stage* pipeline (discovery→experiment→validation→
   operating), or the `AUTONOMOUS`/`APPROVAL REQUIRED`/`PROHIBITED`
   permission tiers specifically for spending/contracts — that last part is
   a real, security-relevant piece of net-new schema and enforcement work,
   not a UI change.
2. **Unified Tool/Agent orchestration framework.** Tools exist
   (`src/lib/tools/registry.ts`) and the Lab AI Engineer does intent-routing,
   but there's no generic "decompose an objective into subtasks, select
   tools per subtask, track execution history/failure state" layer the
   directive describes in §15/§7(phase 7).
3. **Lab Cinematic/Engineering mode split** — already queued from the prior
   directive, unchanged.
4. **Voice provider abstraction** — **DONE** (see below).
5. **Automation loop infrastructure** (§25) — scheduled recurring work with
   its own permission/execution-history/stop-control shape. Related to but
   distinct from the existing `AgentRun` model; needs its own schema check
   before assuming a fit.

Sequencing: continuing the already-confirmed priority order (Voice next,
then Lab Cinematic/Engineering, then a full visual pass) rather than
re-ordering around the new directive's phase numbering, since both
orderings are compatible (Brain-first and event-driven infrastructure
first, broad polish/hardening last) and restarting the sequence would
waste the groundwork already verified. The Economic Engine depth and
Tool/Agent framework are large enough to warrant their own dedicated
milestones once the current thread (Voice → Lab) lands, not folded in
ad hoc.
