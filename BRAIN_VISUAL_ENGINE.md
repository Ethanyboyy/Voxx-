# Brain Visual Engine — implementation architecture

Status: **PLANNED, NOT IMPLEMENTED.** Written at the BRAIN-021 checkpoint
(`7192b7b`) so the next session can start building without rediscovery.

This is not a greenfield build. A working anatomical 3D Brain already ships.
The Brain Visual Engine is a **deepening of that surface**, and the single most
expensive mistake available is to rebuild what exists. Read §1 before writing
any code.

---

## 1. What already exists (REUSE — do not rebuild)

### 1.1 Geometry and anatomy

| File | What it already does |
|---|---|
| `src/components/brain/three/brainGeometry.ts` | Procedural cerebrum (deformed ellipsoid, `[0.72, 0.58, 0.95]`), split into **two hemispheres** by triangle-average X sign, longitudinal fissure, lobe bulges, ridged-noise cortical folding, plus separate cerebellum, brainstem and corpus callosum geometries. Welds Icosahedron's non-indexed buffer into a real indexed geometry so normals smooth correctly. |
| `src/components/brain/three/noise.ts` | `ridgedNoise3D` (gyri/sulci — sharp folds, not blobby Perlin bumps) and `plainNoise3D`. |
| `src/components/brain/three/anatomy.ts` | The 8-system taxonomy (`OBJECTIVES EXECUTION MEMORY RESEARCH PROJECTS COGNITION CONNECTIONS ECONOMICS`), `SYSTEM_OF`, `SYSTEM_COLOR`, `SYSTEM_REGION_LABEL`, `SUBJECT_TYPE_TO_SYSTEM`, and `SYSTEM_ANCHOR` — fixed surface anchor points in the same unit space the geometry is built in. |
| `src/components/brain/three/regionLayout.ts` | `fibonacciSpherePoints`, `computeSatelliteOffsets`, `SATELLITE_REVEAL_CAP = 20`. |

**There is no bundled anatomical scan asset and there must not be a fetched
one.** The procedural approach is a deliberate, documented decision (see the
module header). Deepen the procedural model; do not introduce a third-party
mesh.

### 1.2 Rendering components

`src/components/brain/three/` — `BrainScene.tsx` (Canvas root, camera,
lighting, `localClippingEnabled`), `BrainMesh.tsx` (material, explode, x-ray,
section-plane clipping, per-state colour + pulse speed), `NeuralWeb.tsx`
(structural network with a baked cyan→violet vertex-colour gradient),
`ActivityPulse.tsx` (signals travelling along the network's **own** edges),
`RegionMarker.tsx` (surface decals at system anchors), `EntitySatellite.tsx`,
`CameraRig.tsx` (damped focus + idle auto-rotate that yields to user orbit),
`VoxBrain3D.tsx` (684 lines — the orchestration component; owns all state).

### 1.3 Shared 3D framework — `src/lib/3d/`

`quality.ts` (`QualityTier` MOBILE/MEDIUM/HIGH/HERO with real budgets:
`particleScale`, `shadows`, `effects`, `lod`, `maxAnimatedSignals`,
`canvasDpr`), `useQualityTier.ts`, `useReducedMotion.ts`, `animation.ts`
(easings, `DURATION`, `Signal`/`sampleSignal`, `stagger`), `framing.ts`,
`interaction.ts`, `assetRegistry.ts`, `assetLoader.ts`.

**Performance budgets are already defined. Bind to `QUALITY_BUDGETS`; do not
invent a second budget table.**

### 1.4 Data and events

- `src/lib/brain/graph.ts` — `getBrainGraph()` (real rows → nodes/edges) and
  `getBrainState()` → `idle | thinking | executing | waiting | error`.
- `src/lib/3d/signals.ts` — the honest event→cognition mapping.
  `SignalKind = memory | reasoning | objective | execution`, with an explicit
  exceptions table and an explicit **NOT cognition** list (auth, settings,
  view/camera events). A camera move must never make the Brain pulse.
- `src/lib/events/bus.ts` + `useEventStream.ts` — the **one** SSE transport.
- `src/lib/observability/events.ts#recordEvent` — the **one** event writer.

### 1.5 Tests that already guard this

`tests/brain-geometry.test.ts`, `brain-region-layout.test.ts`,
`brain-graph.test.ts`, `brain-event-coverage.test.ts` (performs real work
across domains and asserts every resulting event is representable — adding an
event type without teaching the Brain about it **fails here**),
`3d-framework.test.ts`, `3d-signals.test.ts`.

---

## 2. What is actually missing (this is the work)

1. **The orchestrator is invisible to the Brain.** `getBrainState()` reads
   `AgentRun`, `SupervisorRun`, `Proposal` and `Objective`. It does **not**
   read `CapabilityRun`, the iteration loop, or provider calls. A chat-started
   run — the thing BRAIN-021 just made the primary entry point — reaches the
   Brain only as a generic `executing`.
2. **No intensity scalar.** State is categorical, so "high-intensity
   reasoning" has nothing to bind to. Concurrency, attempt number and
   in-flight provider count all exist in the data and are all discarded.
3. **Cortical surface is one shell.** No depth layer, no vascular-inspired
   layer, no per-lobe material variation.
4. **Signals ride an abstract web, not anatomy.** `ActivityPulse` follows
   `buildNeuralWeb` edges. Anatomically-routed pathways (region→region along
   the surface) would read as a brain thinking rather than a network glowing.
5. **Regions are markers, not surfaces.** You can click a decal, not a lobe.
6. **No GPU resource lifecycle.** Geometries/materials are not explicitly
   disposed on unmount; a route change leaks until GC.
7. **No measured performance baseline.** `PERF-060` is still `todo`.

---

## 3. Data contract — `BrainVisualState`

**The smallest useful normalized state, derived entirely from existing rows and
events. No new persistence. No new table. No new event type unless §7 says so.**

```ts
// src/lib/brain/visualState.ts  (NEW — the one new server module)
export interface BrainVisualState {
  /** Existing BrainState, unchanged. Categorical mood. */
  state: BrainState;                    // idle|thinking|executing|waiting|error
  detail: string | null;                // existing human sentence

  /** NEW. 0..1. How hard VOX is working right now. Derived, never stored. */
  intensity: number;

  /** NEW. Per-system load, 0..1, keyed by the EXISTING BrainSystem taxonomy. */
  load: Partial<Record<BrainSystem, number>>;

  /** NEW. What is genuinely in flight — drives which regions light. */
  active: {
    runs: number;                       // AgentRun RUNNING|PLANNING
    capabilityRuns: number;             // CapabilityRun RUNNING
    iteration: { attempt: number; limit: number } | null;
    awaiting: { capability: string; requiredLevel: string } | null;
  };
}
```

`intensity` is a **pure function** of `active` — clamp a weighted sum, do not
smooth on the server. Visual smoothing belongs in the frame loop.

Client-side, one hook owns the merge of "snapshot from the server" and "deltas
from the SSE stream":

```ts
// src/components/brain/three/useBrainVisualState.ts  (NEW)
// Seeds from the BrainVisualState in the page payload, then applies live
// events classified by the EXISTING classifySignal() from lib/3d/signals.ts.
// Returns { state, intensity, load, active, recentSignals }.
```

**Rule: the Brain never derives cognition from anything but a real recorded
event or a real row.** A decorative timer is the one prohibited input.

---

## 4. State machine — existing event → Brain state → visual response

Prefer existing events. Every row below uses an event VOX already writes.

| Existing event | Brain state | Visual response | Animation | Terminates on |
|---|---|---|---|---|
| *(none recently)* | `idle` | Cortex dim, slow surface shimmer, neural web receded, camera slow orbit | 0.15Hz breathing, drift ≤0.02 rad/s | any classified event |
| `capability.routed` | `thinking` | COGNITION region brightens; a plan-shaped burst from frontal anchor | 400ms ease-out flare, hold | `capability.run_started` or 6s |
| `agent.run.started`, `capability.run_started` | `executing` | EXECUTION region sustained glow; signals depart frontal→target region | continuous, rate ∝ `intensity` | `agent.run.completed/failed/cancelled` |
| `agent.step.completed` | `executing` | One signal arrives, region flash | 300ms arrival pop | immediate |
| `memory.created`, `artifact.created`, `artifact.version_created` | (overlay) | MEMORY region (temporal lobe) inbound signal | 600ms inbound travel | on arrival |
| `memory.searched` / semantic recall | (overlay) | MEMORY region **outbound** fan — retrieval reads opposite to storage | 500ms, 3–6 strands | on arrival |
| `research.performed` | `thinking` | RESEARCH region (occipital) inbound | 700ms | on arrival |
| `iteration.started` | `executing` | Attempt ring appears, `n of limit` | ring draw 250ms | `iteration.completed` |
| `iteration.reviewed` (fail) | `executing` | Ring segment reddens, intensity **+** | 200ms | next attempt |
| `iteration.completed` | `executing`→settle | Ring completes green | 400ms then fade 1s | run terminal |
| `agent.step.waiting_for_permission` | `waiting` | Global desaturation to amber, all motion **slows** (does not stop), gate glyph at the region | 600ms ease-in-out to 0.4× rate | permission granted or run cancelled |
| `approval.approved` | `executing` | Amber releases, motion restores, single bright pulse | 500ms | immediate |
| `agent.run.failed`, `supervisor.failed`, `provider.failed` | `error` | Region reddens, signals **stop travelling** (never a red idle spin) | 300ms hard cut, hold until acknowledged | user opens the run / 30s |
| `provider.refused` | degraded | Region dims to grey, not red — unavailable ≠ broken | 400ms | next run |
| `agent.run.completed` | settle→`idle` | Success wash outward from the active region, then decay to idle | 800ms wash + 2s decay | decay complete |

**Honesty constraints, non-negotiable:**
- `WAITING_FOR_PERMISSION` slows motion; it must never look like progress.
- A degraded provider is **grey**, an error is **red**. Do not merge them.
- Nothing animates when nothing happened.

---

## 5. Visual system

**Hierarchy** (near→far attention): active region > travelling signals >
cortical surface > neural web > cerebellum/brainstem > ambient field.
Only one thing may be brightest at a time.

**Lighting.** Keep `BrainScene`'s rig. Three-point: cool key from upper-front-
left, warm rim from behind-right (separates cortex from background), low fill.
Emissive carries state; lights stay constant. *Never* animate a light to
signal state — it flattens the anatomy.

**Materials.**
- Cortex: `MeshPhysicalMaterial`, `transmission ≈ 0.35`, `thickness ≈ 0.5`,
  `roughness 0.45`, `clearcoat 0.3`. Semi-translucent so interior structure
  reads without x-ray mode.
- Interior/deep structures: unlit emissive, low opacity, `depthWrite: false`.
- Signals: additive, `depthWrite: false`, no shadow.
- Vascular layer: thin emissive tubes at low opacity, **HIGH/HERO tiers only**.

**Translucency strategy.** Render order: opaque cortex shell → interior
emissive → additive signals → HUD. Transmission is expensive — gate it on
tier; `MOBILE` falls back to opaque with a rim-light fresnel.

**Emissive behaviour.** `emissiveIntensity = base + intensity × range`, damped
at `DAMP ≈ 0.08` (matches `BrainMesh`). Colour comes from `SYSTEM_COLOR` and
the existing cyan→violet gradient. **Do not introduce a new palette.**

**Particles.** Cap at `QUALITY_BUDGETS[tier].maxAnimatedSignals` (6/12/24/40).
Instanced, pooled, allocated once. No per-frame allocation.

**Neural signal visualization.** A signal is a short additive trail along a
path, not a sphere. Path = anatomical surface arc between region anchors
(new) rather than a straight chord.

**Animation principles.** Damped approach, never linear lerp-to-target.
Overlapping, not sequential. Every animation has a termination condition.
Respect `useReducedMotion` — reduced motion keeps **state colour** and drops
**travel**.

**Camera.** Keep `CameraRig`. Idle: slow orbit. Focus: damped target+distance,
preserving user orbit angle. User input always wins; idle resumes after
`IDLE_RESUME_MS`.

**Motion language.** Cognition is *fast and light*; execution is *steady and
heavy*; waiting is *slow*; error is *still*.

**Performance budgets** (bind to `QUALITY_BUDGETS`):

| Tier | Target | Draw calls | Signals | Transmission | Vascular |
|---|---|---|---|---|---|
| MOBILE | 30fps @390px | ≤ 40 | 6 | off | off |
| MEDIUM | 45fps | ≤ 70 | 12 | off | off |
| HIGH | 60fps | ≤ 110 | 24 | on | on |
| HERO | 60fps | ≤ 150 | 40 | on | on |

---

## 6. Module boundaries

**Reuse unchanged:** `noise.ts`, `regionLayout.ts`, `anatomy.ts` (extend the
anchor table only), `lib/3d/*`, `lib/events/*`, `lib/observability/events.ts`,
`BrainScene.tsx`, `CameraRig.tsx`, `EntitySatellite.tsx`.

**Modify:**
- `src/lib/brain/graph.ts` — add `getBrainVisualState()` beside
  `getBrainState()`. Do not change `getBrainState`'s signature; the dashboard
  badge and `BrainStateBadge` depend on it.
- `src/components/brain/three/brainGeometry.ts` — cortical depth layer, lobe
  segmentation for picking.
- `src/components/brain/three/BrainMesh.tsx` — material upgrade, per-lobe
  submeshes, dispose on unmount.
- `src/components/brain/three/ActivityPulse.tsx` — anatomical pathing.
- `src/components/brain/three/VoxBrain3D.tsx` — consume the new hook. **This
  file is already 684 lines; extract state into the hook rather than growing
  it.**

**New (7 files, no more):**
- `src/lib/brain/visualState.ts` — `getBrainVisualState()`.
- `src/components/brain/three/useBrainVisualState.ts` — client merge hook.
- `src/components/brain/three/pathways.ts` — anatomical surface arcs.
- `src/components/brain/three/CorticalLayer.tsx` — depth/vascular layer.
- `src/components/brain/three/LobePicker.tsx` — surface-region selection.
- `src/components/brain/three/disposal.ts` — GPU lifecycle helper.
- `tests/brain-visual-state.test.ts`.

**Do not create:** a second brain component tree, a Zustand/Redux store (React
state + the SSE hook is sufficient and is what ships today), a second event
bus, a `BrainEngine` class wrapper, or per-region files.

---

## 7. Implementation sequence

Each phase is independently verifiable and independently committable.

| # | Phase | Deliverable | Verified by |
|---|---|---|---|
| **A** | Anatomical foundation | Cortical depth layer + lobe submeshes in `brainGeometry.ts` | `brain-geometry.test.ts` extended: vertex counts, hemisphere split intact, no NaN, bounds unchanged |
| **B** | Rendering/material | Physical material, transmission gated by tier, render order, `disposal.ts` | Browser at 1100/390px; no context-lost; draw calls within §5 |
| **C** | State/event integration | `visualState.ts` + `useBrainVisualState.ts` | `brain-visual-state.test.ts`; `brain-event-coverage.test.ts` still green |
| **D** | Interaction | `LobePicker`, hover/select/focus on real regions | Playwright click→inspector |
| **E** | Cognitive visualization | Region load, intensity, attempt rings, permission/degraded states | Screenshot per state from §4 |
| **F** | Motion system | `pathways.ts`, anatomical signal travel, damped transitions | Reduced-motion path asserted |
| **G** | Cinematic polish | Idle choreography, success wash, depth cueing | Visual QA |
| **H** | Performance | Instancing, pooling, tier gating, measured fps | `PERF-060` baselines |
| **I** | Responsive/mobile | 390px framing, touch, MOBILE tier fallbacks | 0px overflow at 390px |
| **J** | Visual QA | Full state sweep, both viewports | Screenshot review loop |

**Start at A.** B depends on A. C is independent of A/B and could run in
parallel, but sequence it after B so there is only one moving part at a time.

---

## 8. Deterministic work — no Opus reasoning needed

Safe to hand to cheap tooling or a smaller model:

- Extend `tests/brain-geometry.test.ts` with bounds/NaN/count assertions.
- Add `disposal.ts` and wire `useEffect` cleanups (mechanical).
- Audit every `useFrame` for per-frame allocation (`new THREE.Vector3` inside
  the loop) — static analysis, then hoist.
- Enumerate current draw calls per tier via a scripted Playwright capture of
  `renderer.info`.
- Verify every event type in `signals.ts` still exists in the codebase
  (grep-based drift check).
- Fix the 13 pre-existing lint warnings.

---

## 9. NEXT SESSION START HERE

**Inspect first, in this order (≈900 lines total, do not read more):**
1. `src/components/brain/three/brainGeometry.ts` — the geometry you are extending
2. `src/components/brain/three/anatomy.ts` — taxonomy + anchors
3. `src/components/brain/three/BrainMesh.tsx` — current material
4. `src/lib/brain/graph.ts` lines 380–432 — `getBrainState()`
5. `src/lib/3d/signals.ts` — the event→cognition mapping
6. `src/lib/3d/quality.ts` — the budgets you must respect
7. This document, §2 and §7

**Begin at Phase A: anatomical foundation.** Cortical depth layer + lobe
submeshes in `brainGeometry.ts`, with `brain-geometry.test.ts` extended first.

**Dependencies:** none beyond what is installed (`three ^0.180.0`,
`@react-three/fiber ^9.7.0`, `@react-three/drei ^10.7.8`). Do not add a
package; postprocessing is explicitly out of scope until Phase G, and only if
a measured budget allows it.

**Reuse:** everything in §1. Especially — one event bus
(`lib/events/bus.ts`), one event writer (`observability/events.ts`), one
quality-tier table (`lib/3d/quality.ts`), one system taxonomy
(`three/anatomy.ts`), one execution engine (`agents/executor.ts`).

**Known risks:**
- `VoxBrain3D.tsx` is 684 lines and owns ~18 pieces of state. Extract into the
  hook before adding to it, or Phase C will be unreviewable.
- `MeshPhysicalMaterial` transmission forces an extra render pass — measure on
  MOBILE before shipping it anywhere.
- Lobe submeshes multiply draw calls. Merge into one geometry with a lobe id
  attribute and pick via that attribute, rather than N meshes.
- `brain-event-coverage.test.ts` fails if a new event type is added without
  teaching the Brain. That is intended — do not weaken it.
- The hemisphere split in `brainGeometry.ts` depends on triangle-average X
  sign; changing the fissure carve can silently break it. The test asserts it.

**Performance constraints:** §5 table. MOBILE must hold 30fps at 390px with
transmission and vascular layers off.

**Acceptance criteria:**
- Anatomy reads as a brain — two hemispheres, visible folding, distinct
  cerebellum and brainstem — at 390px and 1100px.
- Every visual state in §4 is reachable from a real event, and no state is
  reachable without one.
- `WAITING_FOR_PERMISSION` is visually distinct from `executing` and from
  `error`; degraded is grey, error is red.
- Reduced motion keeps colour, drops travel.
- No WebGL context leak across route changes (`renderer.info.memory` flat over
  10 navigations).
- Full gate green: typecheck, lint 0 errors, all tests, build.

**Visual QA criteria:** capture idle / thinking / executing / iterating /
waiting / degraded / error / completed at 1100px and 390px; 0px horizontal
overflow at both; nothing animates when no event has occurred.

**Blocker:** none. All prerequisites are in the repository.
