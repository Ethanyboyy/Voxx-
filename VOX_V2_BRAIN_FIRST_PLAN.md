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
| 3 — Cognitive orchestration | Live event bus transport (below) DONE; wiring the Brain UI to consume it is next | Transport DONE, UI PLANNED next |
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

## Next: wire the Brain visualization to the live event bus (priority #3)

`BrainWorkspace.tsx` currently re-fetches its entire graph (nodes/edges/
events/brain state) on a 20s `setInterval` poll — functional, but not live,
and wasteful (refetches everything every tick regardless of what changed).
Plan: a `useEventStream()` client hook wrapping `EventSource` against
`/api/events/stream`, consumed by `BrainWorkspace` to append real live
events to its existing event list/state as they happen, complementing
(not necessarily replacing outright) the poll as a safety-net fallback.
This is where the Brain's visual state should start reacting to specific
event types (memory retrieval, research, tool execution) rather than only
the coarse idle/thinking/executing states it already derives.
