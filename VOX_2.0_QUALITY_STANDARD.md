# VOX 2.0 Quality Standard

A feature is not complete because a route exists, a button renders, or a
component compiles. This document is the checklist every milestone is
measured against before it's marked done — in this repo's tasks, in
`VOX_2.0_IMPLEMENTATION_PLAN.md`, and in any commit message that claims a
milestone finished.

## The seven qualities

A feature is complete only when it meets all seven:

1. **Functional quality** — it does what it claims, against real data, with
   real error paths (not just the happy path).
2. **Visual quality** — passes the rejection list below on every screen it
   touches, not just the primary one.
3. **UX quality** — the empty state, loading state, and error state are as
   deliberately designed as the populated state.
4. **Performance quality** — no unnecessary client-side JS, no blocking
   waterfall fetches, 3D/heavy assets are lazy-loaded and gracefully
   degrade (see `LazyMount` pattern already used for suit thumbnails).
5. **Responsive quality** — verified at both a real mobile viewport (≤400px)
   and desktop, not assumed from desktop-first CSS.
6. **Accessibility quality** — keyboard-operable, focus-visible, reduced-
   motion respected, semantic markup, contrast holds in both themes.
7. **Integration quality** — it is reachable from real navigation, not an
   orphaned route; it reads/writes through the correct `src/lib/*` service
   layer, not ad hoc queries in a route handler or component.

## Explicit rejection list

Reject on sight, in review or in your own work:

- Generic cards with no information hierarchy
- Excessive rounded-everything, excessive gradients, excessive glow
- Excessive purple as a *base* color (see `VOX_2.0_DESIGN_SYSTEM.md` — accent only)
- Fake glassmorphism (blur with nothing structural behind it)
- Arbitrary one-off shadows not drawn from `--shadow-ambient-*`
- Inconsistent spacing/typography (not using the token scale)
- Dead controls — a button that does nothing, or does something invisible
- Duplicate UI — two components doing the same job because a shared one wasn't reused
- Fake 3D (CSS transforms standing in for real geometry) where the content warrants real 3D
- Unfinished loading states (a bare spinner where a skeleton or partial render is possible)
- Broken/missing empty states — every list/grid must have a designed empty state, not a blank area
- Placeholder copy ("Lorem ipsum", "TBD", "Coming soon" presented as finished)
- Animation with no communicative purpose (spinning for the sake of spinning)
- "Coming soon" screens that look like finished functionality

## The reality boundary (mandatory, not optional)

VOX already implements this correctly at the suit level via
`LabRealityStatus` (`REAL | BUILDABLE | PROTOTYPE | EXPERIMENTAL | CONCEPT
| NOT_CONNECTED`), defaulted to the most conservative value and never
silently upgraded — this is the working template. Every new subsystem that
makes an engineering or capability claim must use the same axis or an
explicitly justified equivalent:

- Suit **components** (not just whole suits) — required by Milestone 8.
- Engineering proposals — every number must be labeled **MEASURED**,
  **ESTIMATED**, **SIMULATED**, **THEORETICAL**, or **UNKNOWN**. An
  estimate is never presented as a measurement.
- Economic Command — revenue/opportunity figures follow the same
  Objectives/Opportunities `confidence` model already in place (never a
  fabricated number).
- Fictional capabilities (wall-climbing, web-swinging, superhuman
  strength, flight, etc.) are never represented as anything more advanced
  than **CONCEPT** unless real evidence justifies moving them up the
  ladder — and that evidence must be attached (a linked `LabExperiment`
  with a real result), not asserted.

This mirrors `Confidence`/`MemoryCategory.INFERENCE`'s "never silently
upgraded" rule already codified in `CLAUDE.md` rule 3 — the reality
boundary is that same principle applied to engineering and economic claims.

## No fake functionality

If something cannot actually work yet, the UI must say so using one of:
**CONCEPT · SIMULATED · UNAVAILABLE · REQUIRES INTEGRATION · REQUIRES
HARDWARE · REQUIRES TESTING** — never a working-looking control that
silently no-ops or a fabricated success state.

## Verification gate (required before any milestone is marked done)

```
npm run typecheck
npm run lint
npm test
npm run build
```

All four green. Fix failures — never disable a check to make it pass. A
milestone that ships a real browser regression (console errors, broken
layout, non-functional control) does not count as done even if these four
pass, since none of them catch runtime/visual regressions — see the Visual
QA step below.

## Visual QA (required for any milestone touching UI)

Load the actual page(s) in a real browser (this repo has Chromium +
Playwright available, see prior session verification pattern: log in with
a real or dev-reset test account, screenshot desktop + mobile viewports,
check for console errors and horizontal overflow) before calling a UI
milestone done. Typecheck/lint/test/build passing is necessary but not
sufficient — none of them render a page.

## Testing debt to close (from the Phase 0 audit)

Current coverage is 191 tests / 27 files, 100% backend service-layer, zero
component/UI tests. Gaps to close as part of the milestones that touch
those areas (not as a standalone milestone — test alongside the feature,
per Milestone process below):

- `src/lib/security/` (crypto, rate-limit) — untested, and it's the
  encryption boundary; close this early, independent of any UI milestone.
- `src/lib/integrations/` (catalog, stub) — untested.
- `src/lib/voice/` — untested, and about to gain a real provider
  abstraction (Milestone 14); write tests as that abstraction is built,
  not after.
- No API route handler is ever invoked directly in a test (only the
  service functions underneath). Not required to fix wholesale, but any
  *new* route handler with logic beyond calling a service function 1:1
  (auth checks, request-shape branching) should get a direct test.

## Milestone completion protocol

After every milestone: run the verification gate → do a visual QA pass on
every screen it touched → fix regressions → update the relevant
`VOX_2.0_*.md` doc if the milestone changed the plan → only then mark the
milestone/task complete. Never declare a milestone "complete" when it
means "the component renders" or "the route exists" — see the rejection
list and the seven qualities above.
