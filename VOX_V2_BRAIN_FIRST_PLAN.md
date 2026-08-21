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
| 2 — Brain | Brain-first entry point + nav reorder (below) | **STARTING NOW** |
| 3 — Cognitive orchestration | Orchestrator (Milestone 10) exists; live event bus is the real gap | PLANNED next |
| 4 — Home/Projects/Memory/Research | Already real UI (Workstream A); revisit only where Brain-first nav changes their entry paths | Mostly done, spot-check only |
| 5 — Laboratory | Cinematic/Engineering mode split on top of the real suit rendering fix | PLANNED |
| 6 — Systems/Connections | Connections Hub already real (Milestone 12); no new work identified yet | Mostly done |
| 7 — Mobile | Spot-checked clean on 4 pages; broaden the sweep as other phases land | Ongoing |
| 8 — Polish | Final pass once the above land | Not started |

## Milestone: Brain-first entry point + navigation reorder — IN PROGRESS

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
