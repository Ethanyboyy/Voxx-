# VOX 3.0 — System Audit

Written by inspecting the actual source, schema, and test suite. Where an
earlier planning document disagreed with the implementation, the
implementation was treated as the truth. Dated 2026-08-29, at commit
`342f630` (pre-Wave-1).

## Scale

| Measure | Count |
| --- | --- |
| Source (TS/TSX) | ~207k LOC |
| Prisma models / enums | 73 / 58 |
| API route handlers | 140 |
| Page routes | 49 |
| Service modules (`src/lib`) | 91 files across 30 domains |
| React components | 98 |
| Test files / tests | 39 / 299 (now 42 / 318) |

## The headline finding

The domain services are thick and genuinely implemented. The **cognitive
core connecting them was thin**, and that asymmetry — not missing features —
was VOX's real gap:

| Module | LOC (pre-Wave-1) |
| --- | --- |
| `objectives/service.ts` | 698 |
| `supervisor/service.ts` | 468 |
| `brain/graph.ts` | 432 |
| `tools/registry.ts` | 297 |
| **`agents/executor.ts`** | **170** |
| **`agents/planner.ts`** | **73** |
| **`orchestrator/service.ts`** | **68** |
| **`events/bus.ts`** | **45** |

VOX could *do* a great deal. What it could not do was learn from having done
it, or connect what one subsystem did to what another knew.

## Classification

### REAL — implemented and working

- **Permissions / capabilities.** `checkCapability()` is enforced on every
  tool-bound step. Agents carry a second, stricter `allowedCapabilities`
  allowlist on top of the user's grants. No bypass path exists.
- **Agent execution.** Real retries, real capability pauses
  (`WAITING_FOR_PERMISSION`), honest failure states. Never marks a step
  complete unless the tool actually returned.
- **Supervisor.** Bounded replanning (`maxIterations`), approval gating,
  Outcome recording. Notably honest: a completed run records
  *"execution completion, not an independently verified real-world result."*
- **Memory.** Encrypted storage, embeddings, semantic retrieval,
  relations, contradiction detection.
- **Event system.** `recordEvent()` used across 15 domains; SSE stream feeds
  the Brain and activity views.
- **Lab.** The largest real domain — 13 event-emitting call sites, deep
  schema, real suit/component/experiment records.
- **Provider abstractions.** AI, research, and embeddings are all behind
  real interfaces with honest fallbacks.

### PARTIAL

- **Research engine.** Produces artifacts, but does not yet write back into
  Memory or the Knowledge Graph.
- **Economic engine.** Full opportunity→asset lifecycle exists; outcome
  learning was economic-only (fixed in Wave 1).
- **Brain.** Derives from real state (`getBrainState`, `getBrainGraph`) —
  not fabricated. Reads Outcomes purely for visualisation.

### DISCONNECTED (the real problem)

- **Knowledge Graph.** `ensureNodeForEntity()` was reachable from exactly
  three places: two detail pages and one manual API endpoint. **No
  autonomous subsystem had ever written to it.** The graph could only
  contain what a human had clicked. It also had no way to represent an
  Objective at all.
- **Outcomes.** Written by the supervisor, read by `brain/graph.ts` for
  display and by nothing else. The LEARN step had a producer and no consumer.
- **The planner.** `planObjective(objective: string)` received only a text
  string and the tool catalog — no memories, no past outcomes, no context.
  VOX planned every objective as if it had never done anything before.

### Honest MOCK / STUB (not defects)

`ai/mock.ts`, `research/mock.ts`, `integrations/stub.ts` are deliberate
fallbacks that throw or degrade clearly rather than simulating success.
`tools/registry.ts` throws *"Google Calendar integration is not implemented
yet — no real OAuth client is registered"* rather than faking a result.
This posture is correct and was preserved.

### Not found

No fabricated revenue, no fake agent execution, no invented Brain activity,
no simulated sensor data presented as real. The codebase is unusually clean
of the failure mode §21 warns about. TODO/FIXME markers: effectively zero.

## The autonomous loop, before and after

| §25 stage | Before | After Wave 1 |
| --- | --- | --- |
| Understand → Plan | ✅ | ✅ |
| Select agent / tools | ✅ | ✅ |
| Check permissions | ✅ | ✅ |
| Propose / approve | ✅ | ✅ |
| Execute | ✅ | ✅ |
| Observe | ✅ | ✅ |
| **Verify** | ❌ | ✅ (Wave 2) |
| **Update memory** | ⚠️ economic only | ✅ every run |
| **Update knowledge graph** | ❌ | ✅ objective ↔ outcome |
| **Learn (feed back into planning)** | ❌ | ✅ |

## Wave 1 — what shipped

1. **`agents/context.ts`** — `buildPlanningContext()` gathers semantically
   relevant memories plus real recorded Outcomes, ordering *this objective's
   own* prior attempts first. Wired into both supervisor planning sites,
   including the replan path.
2. **`recordOutcomeMemory()`** — every supervised run now leaves a durable
   EXPERIENCE memory, not just opportunity-backed ones. `Outcome.lessons`
   (previously always null) carries the real final failure message.
3. **`linkOutcomeIntoGraph()`** — the graph's first autonomous writer.
   Objective and outcome-memory nodes, joined by an edge labelled with the
   real terminal status. Best-effort: never rolls back completed work.
4. **`agents/references.ts`** — `{{stepN.output.path}}` lets a step use what
   an earlier step actually returned. Resolves against persisted `output`
   so it survives a permission pause; unresolved references fail loudly
   rather than passing a placeholder to a tool.

## Known limitations (deliberate, not oversights)

- **Verification depends on a real model provider.** The engine is wired and
  conservative, but under the mock provider (and any parse/availability
  failure) every judged objective resolves to UNVERIFIED. That is the honest
  answer, not a stub — but it means ACHIEVED is only reachable with a real
  reasoning model configured.
- **Verification cannot observe the outside world.** It judges only evidence
  the run itself recorded. A criterion like "the listing is publicly live"
  can be checked against a tool result claiming so, but VOX cannot
  independently confirm the external fact, and the prompt tells the judge
  that a tool succeeding is not proof a real-world outcome occurred.
- **Objective status is never advanced autonomously.** Deliberate:
  `Objective.currentValue` changes only via explicit `updateObjective()`
  input, per the standing rule against inferred progress. Completed work is
  linked to the objective in the graph; a human still decides "achieved".
- **Prior outcomes rank by recency, not similarity.** `rankBySimilarity()`
  persists a `MemoryEmbedding` row keyed by the candidate id, so ranking
  Outcome ids would write embedding rows describing memories that do not
  exist.
- **Research and Lab still do not write to Memory or the Graph.** The
  supervisor path now does; extending the same pattern to those domains is
  the next integration step.
- **Chaining references `output` only,** not `summary` — `summary` is not
  persisted on `AgentStep` and would break on resume.

## Wave 2 — the verification engine

Closes the "did the objective actually succeed?" gap.

- `Objective.successCriteria` (JSON string[]) defines what success means.
- `VerificationStatus` (ACHIEVED / PARTIALLY_ACHIEVED / FAILED / UNVERIFIED)
  on `Outcome`, deliberately separate from `OutcomeStatus`, which only ever
  described whether execution ran.
- `objectives/verification.ts` judges each criterion against evidence
  collected from the run's real persisted steps. Aggregation is conservative:
  one undeterminable criterion blocks ACHIEVED, and "nothing met but
  something uncheckable" reports UNVERIFIED rather than FAILED.
- A failed run is judged from the record directly, no model call needed.
- The verdict flows into the Outcome (with per-criterion audit trail in
  `variance` and evidence in `evidence`), the EXPERIENCE memory, the graph
  edge (`verified:<status>`), and the next planning context — which now tells
  the planner explicitly that "completed" does not mean "worked".

## Next highest-leverage work

1. Extend the graph/memory write-back pattern from the supervisor to
   **research completion** and **Lab experiment completion** (§37's own
   worked examples).
2. **Event-type consolidation** — event strings are currently free-text at
   call sites; a typed union would make the bus enforceable.
