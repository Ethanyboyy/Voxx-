# VOX — Multimodal Agent Fabric

How execution, image generation and cinematic generation become capabilities
VOX *chooses between*, rather than three integrations bolted to three buttons.

This document is the audit that had to come before the code, plus the design
that follows from it. Read it with `ARCHITECTURE.md` (the base system) and
`PHASE_2_ARCHITECTURE.md` (the cognition layer).

---

## 1. Audit — what already exists

The single most important finding is that **VOX already has most of this
substrate**. The work is extension, not construction, and several things the
brief describes as new are already built and working.

### 1.1 The provider-abstraction pattern is established

Five subsystems already follow one shape, and it is the shape the brief asks
for:

| Module | Interface | Real impl | Fallback |
| --- | --- | --- | --- |
| `src/lib/ai/` | `AIProvider` | `anthropic.ts` | `mock.ts` |
| `src/lib/research/` | `ResearchProvider` | `anthropic.ts` | `mock.ts` |
| `src/lib/embeddings/` | `EmbeddingProvider` | `voyage.ts` | `local.ts` |
| `src/lib/generation/` | `GenerationProvider` | `blenderLocal.ts` | `unavailable.ts` |
| `src/lib/integrations/` | `ConnectionProvider` | — | `stub.ts` |

Each is `types.ts` (interface) + implementations + `index.ts` (a cached
resolver with a `_reset*Cache()` test hook). CLAUDE.md rule 2 forbids calling a
vendor SDK anywhere outside these directories, and rule 6 requires any provider
that sends user content to a third party to be **absent by default** and gated
on an explicit env var.

`src/lib/generation/` is the closest precedent and the one the new media
providers copy, because it already solved the honesty problem:

```ts
readonly isConfigured: boolean;
readonly unavailableReason: string | null;
```

Its docstring states the rule plainly — a provider "must NEVER return a
fabricated asset — an invented GLB path would flow straight into
`LabSuit.modelUrl` and be presented to the user as a real, inspectable
object." That reasoning transfers directly to images and video.

### 1.2 The execution agent largely exists

`AgentRun` / `AgentStep` + `src/lib/agents/executor.ts` is already a
persistent, resumable, permission-gated multi-step execution engine:

- ordered steps, each optionally bound to a registry tool
- **the real `checkCapability()`** before every tool call, never bypassed
- an agent-level `allowedCapabilities` allowlist *on top of* the user's grants
- `{{stepN.output}}` references resolved from persisted step outputs, so a run
  that paused and resumed still resolves correctly
- `WAITING_FOR_PERMISSION` as a first-class pause state, not a failure
- retries, per-step error capture, event emission at every transition

What it does **not** have is tools that touch the filesystem, run tests, or
render — so "fix the Suit Bay" cannot yet be planned into real steps. That is a
tool-registry gap, not an engine gap. **Do not build a second execution
engine.**

### 1.3 Event bus — reuse, do not add

`src/lib/events/bus.ts` is an in-process pub/sub fed by exactly one writer:
`recordEvent()` in `src/lib/observability/events.ts`, right after the durable
`Event` row is written. The module comment is explicit that "nothing on this
channel is ever fabricated — nothing that couldn't already be found in the
Event table."

**Consequence for this work:** new capability events must go through
`recordEvent()`. Publishing to the bus directly would put something on the live
channel with no durable row behind it, which is precisely the invariant the bus
exists to hold.

### 1.4 Permissions

`CapabilityLevel` is `OBSERVE < ANALYZE < RECOMMEND < ASK < ACT`, default grant
`ANALYZE`, enforced by `checkCapability()` / `enforceCapability()`. The brief
proposes `READ / WRITE / EXECUTE / NETWORK / DEPLOY / DESTRUCTIVE`. **We do not
add a second permission vocabulary.** Those concerns map onto the existing
ladder plus the capability *key*:

| Brief's concept | VOX expression |
| --- | --- |
| READ | `OBSERVE`/`ANALYZE` on the relevant capability key |
| WRITE | `ACT` on a scoped key, e.g. `workspace.write` |
| EXECUTE | `ACT` on `workspace.exec` |
| NETWORK | the provider's own key, e.g. `media.image.generate` |
| DEPLOY | `ACT` on `deploy.*`, plus explicit approval |
| DESTRUCTIVE | `ACT` + `Proposal` approval — never silent |

A second ladder would be a second source of truth, and the first thing to drift.

### 1.5 Brain signal classification

`src/lib/3d/signals.ts` maps real event types onto cognitive signal kinds, and
returns `null` for anything that is not cognition. It carries a `VIEW_ONLY` set
for events that are real and recorded but must not make the Brain pulse.

Every event type added here gets classified **deliberately**, with a test that
fails if a new one is added without that decision being made.

### 1.6 What is genuinely missing

1. **No unified artifact model.** `LabSuitImage` is suit-scoped and has no
   lineage; `LabSuitVersion` *does* have real parent/child lineage and is the
   precedent to copy. There is nowhere to say "this video came from that
   concept, which came from that reference."
2. **No image or video provider**, and no interface for one.
3. **No capability router.** `src/lib/orchestrator/service.ts` is deliberately
   *not* a router — its comment says so — it is a cross-domain snapshot. That
   snapshot is an *input* to routing, not routing itself.
4. **No per-call usage ledger.** `src/lib/ai/cost.ts` converts tokens to
   dollars, but nothing records "this provider call cost this much and produced
   that artifact."

---

## 2. Environment reality — measured, not assumed

Two probes, run from this container:

**Google Generative Language API — REACHABLE.**
```
$ curl "https://generativelanguage.googleapis.com/v1beta/models?key=NONE"
{"error":{"code":400,"message":"API key not valid...","status":"INVALID_ARGUMENT"}}
```
A real, structured API error means TLS completed and the service answered. The
image provider can therefore be a genuinely working adapter, blocked only on a
key.

**Higgsfield — NOT REACHABLE.**
```
$ curl -o /dev/null -w "%{http_code}" https://api.higgsfield.ai/
curl: (56) CONNECT tunnel failed, response 403
$ curl -o /dev/null -w "%{http_code}" https://higgsfield.ai/
curl: (56) CONNECT tunnel failed, response 403
```
The environment's egress proxy refuses the tunnel. This matches
`docs/3d-pipeline/MCP_DECISIONS.md`, which recorded the same result for
`platform.higgsfield.ai` previously.

**What follows from that** is the brief's own instruction: *"If a real API/MCP
credential is unavailable, implement the provider abstraction and clearly mark
the provider as configuration-required rather than pretending it works."* The
Higgsfield adapter is written against the interface, reports
`isConfigured: false` with the measured reason, and throws on use. It is not
mocked, not stubbed to return a plausible URL, and not hidden.

---

## 3. Design

### 3.1 Layering

```
Brain / Chat / Lab / Supervisor          ← callers, unchanged
        │
        ▼
src/lib/capabilities/router.ts           ← NEW: what is needed, in what order
        │
        ▼
src/lib/capabilities/plan.ts             ← NEW: an ordered CapabilityPlan
        │
   ┌────┴──────────────┬──────────────┬─────────────────┐
   ▼                   ▼              ▼                 ▼
agents/executor     image/          video/          generation/
(EXISTING)          (NEW)           (NEW)           (EXISTING)
   │                   │              │                 │
   └────────┬──────────┴──────────────┴─────────────────┘
            ▼
src/lib/artifacts/       ← NEW: normalized output + lineage + versions
            │
            ▼
observability/events.ts → events/bus.ts   ← EXISTING, reused
```

### 3.2 Capability taxonomy

One closed union, in `src/lib/capabilities/types.ts`:

```
EXECUTION | IMAGE_GENERATION | IMAGE_EDIT | VIDEO_GENERATION
| MODEL_3D | RESEARCH | MEMORY | VISUAL_QA
```

Closed on purpose, for the same reason the proposal action registry is closed:
a router that can name a capability nothing implements produces plans that fail
at step three instead of at routing time.

### 3.3 Routing

`routeRequest()` takes the request text, the available assets, permissions,
provider availability and prior results; it returns a `CapabilityPlan` — an
ordered list of `CapabilityStep`, each with the capability, a short *operational*
reason, and whether it is optional.

Two-stage by design:

1. **Deterministic pre-pass.** Strong lexical and structural signals decide the
   obvious cases without a model call — "make a trailer" is temporal, "give me
   ten variations" is image, "fix the Suit Bay" is execution. Cheap, testable,
   and the thing that makes routing behaviour assertable in unit tests.
2. **Model-assisted fallback**, only when the pre-pass is not confident, via the
   existing `getAIProvider()`.

Routing metadata stored on the plan is deliberately terse — the capability, the
provider, a one-line reason. Per the brief: no chain-of-thought is persisted or
surfaced.

**Not using a capability is a first-class outcome.** An empty plan is valid and
means "answer directly"; the router must not reach for a provider because one
exists.

### 3.4 Provider interfaces

`ImageProvider` and `VideoProvider` mirror `GenerationProvider` exactly —
`id`, `displayName`, `isConfigured`, `unavailableReason`, `capabilities`, and
one async method that throws when unconfigured.

### 3.5 Artifacts

```
Artifact ──< ArtifactVersion
   │              │
   │              └──< ArtifactLink (derivedFrom)
   └── kind: IMAGE | VIDEO | MODEL_3D | DOCUMENT | CODE | AUDIO | DATA | OTHER
```

Every version records provider, model, prompt, parameters, dimensions, MIME
type, byte size, the `CapabilityRun` that produced it, and its parents. Lineage
is an explicit link table rather than a single `parentId` because a cinematic
render legitimately derives from *both* a concept image and a 3D model.

Versions are append-only. "Go back to version two" is a pointer move
(`Artifact.currentVersionId`), never a destructive overwrite — the same posture
`LabSuitVersion` already takes.

### 3.6 Usage ledger

Every provider call opens a `CapabilityRun` row: capability, provider, model,
status, `startedAt`/`completedAt`, duration, estimated cost when the provider
reports one, and the resulting artifact version. This is what makes
"what happened?" reconstructible:

```
Task 8214 → CapabilityRun 91 (IMAGE_GENERATION, gemini) → ArtifactVersion 440
          → CapabilityRun 52 (VISUAL_QA, anthropic)     → pass
          → CapabilityRun 17 (VIDEO_GENERATION, higgsfield) → ArtifactVersion 441
```

Budgets are checked **before** the call, not after, and a refusal is a normal
outcome that leaves task state intact.

### 3.7 Failure modes

| Failure | Behaviour |
| --- | --- |
| Provider unconfigured | Router never selects it; plan degrades or the step is marked optional-skipped |
| Provider errors mid-call | `CapabilityRun` FAILED with the reason; artifact never created; task state preserved |
| Budget exceeded | Refused before the call; explicit event; resumable later |
| QA fails | Iteration, bounded by budget; never an unbounded loop |
| All image providers down | Video stage that needed a concept is skipped, not faked |

Nothing here writes a partial artifact. A version row is created only after
bytes exist.

### 3.8 Security

- Keys are read from `process.env` inside the provider module only, server-side.
- No key, and no artifact *content*, is written to Memory.
- Generated bytes are untrusted: MIME and size are validated before storage, and
  a provider-supplied URL is never treated as an execution target.
- The image provider sends user content to a third party, so per CLAUDE.md rule
  6 it is absent by default, gated on `GOOGLE_API_KEY`, and documented in both
  `.env.example` and `SECURITY.md`.

---

## 3.9 Execution tools

`AgentRun`/`AgentStep` was already a working execution engine; what it lacked
was hands. `src/lib/workspace/` supplies them, registered as ordinary tools in
the EXISTING registry (`src/lib/tools/registry.ts`) so they go through the same
`checkCapability()` gate as everything else.

| Tool | Capability | Level |
| --- | --- | --- |
| `workspace.list` / `structure` / `read` / `search` | `workspace.read` | OBSERVE |
| `workspace.git_status` | `workspace.inspect` | ANALYZE |
| `workspace.validate` | `workspace.validate` | ANALYZE |
| `workspace.write` / `patch` | `workspace.write` | **ACT** |

Reading is OBSERVE because inspecting the code it is working on is the least an
engineering agent can do, and secrets are excluded at the path layer rather
than by withholding the capability. Validation is ANALYZE because it changes
nothing and an agent should not need an approval round-trip to run the tests.
Writing is ACT — not granted by default — because that is the level VOX already
reserves for actions that change something.

### There is no "run a command" tool

This is a security boundary, not a permission question. Agent plans come from a
model working over text that may include a pasted reference, a caption from a
generated image, or a filename inside an artifact. A tool taking a command
string turns all of that into remote code execution on the server.

So `src/lib/workspace/validate.ts` holds a CLOSED, hardcoded set — typecheck,
lint, test, build — each naming an npm script that already exists. The agent
chooses *which* check to run; it never composes one. `execFile` with an
argument array means there is no shell to inject into. Adding a check is a code
change and a review, which is the correct amount of friction.

### Path containment

Two checks, because they catch different things: `resolve()` + prefix stops
`../../etc/passwd`, and `realpath()` + prefix stops a symlink *inside* the
workspace pointing out of it — which passes the first check, since lexically it
is still under the root. A denylist sits on top: `.env`, `*.db`, `.git/` and
`node_modules/` are unreadable at any level, and `src/generated/` and
`prisma/migrations/` are additionally unwritable.

## 3.10 Multimodal AIProvider

`ChatMessageInput.content` now accepts `string | ContentBlock[]`. The string
form is kept, not deprecated: widening a type is a change nobody has to react
to, while replacing one is a change everybody does. Every existing VOX caller
passes a string and still compiles.

`AIProvider.supportsVision` is optional and treated as false when absent.
`MockAIProvider` sets it to **false**, and that flag is load-bearing — see
below.

## 3.11 Visual QA

`src/lib/qa/` turns "the provider returned 200" into "the result is usable",
which are not the same fact. Output is structured (`PASS`/`FAIL`, score, typed
issues, recommendations) because a caller has to branch on it and prose cannot
be branched on reliably.

**QA refuses to run without a vision-capable provider.** A text-only model
asked to judge an image answers anyway, fluently, entirely from the prompt.
That verdict would be stored as a real QA result, gate a real iteration loop
and mark a real artifact approved — a fabricated judgement about work nothing
ever looked at. Refusing is the only honest option.

Criteria are per-task (`CRITERIA_PRESETS`) rather than universal: asking a
cinematic shot about "material realism" invites an invented complaint.

The parser is deliberately conservative. A PASS that contradicts its own
blocker, a PASS below the pass score, an unparseable response — all resolve to
FAIL, because the failure mode of a lenient parser here is silently approving
bad output.

No chain-of-thought is requested, returned or stored. The cheapest way to
honour that is never to ask for it: a "think then answer" prompt produces
reasoning that must be stripped, and stripping is where it leaks.

## 3.12 Bounded iteration

`src/lib/capabilities/iterate.ts` runs generate → review → improve. Three gates
are checked BEFORE each attempt, because checking after means it already cost
something: the iteration limit (hard, default 3), the budget, and provider
availability.

Every attempt is persisted as an append-only `ArtifactVersion` with lineage —
**including rejected ones**. Discarding failures would make the history a lie:
it would show three clean successes where there was one success and two
rejections, and destroy the evidence for why the prompt changed.

### Failures route differently

Blindly regenerating for every failure wastes attempts on problems
regeneration cannot fix:

| Failure | Response |
| --- | --- |
| `REFERENCE_MISMATCH`, `MATERIAL_PROBLEM`, `PROPORTION_PROBLEM`, `COMPOSITION_PROBLEM` | Refine the prompt |
| `GENERATION_ARTIFACT` | Resample — the prompt was fine, the draw was not |
| `IMPLEMENTATION_PROBLEM` | **Stop.** The picture is of the application and the application is wrong; hand back to the execution agent |
| `MISSING_REQUIREMENT` | **Stop and ask.** Guessing produces confident, wrong work |
| `PROVIDER_FAILURE` | **Abort.** A broken provider will break again |

The loop returns an `IterationResult` with a `stop` reason rather than throwing,
because "still failing after three tries", "budget exhausted" and "no provider"
are answers the caller must be able to tell apart and report.

## 3.13 Lab integration

`src/lib/lab/artifacts.ts` reads the same `Artifact` rows every other surface
reads — the Lab is a consumer of the capability system, not a parallel one. It
owns no storage.

It does **not** replace `LabSuitImage`. That is a hand-curated gallery a human
chose and captioned; an Artifact is something VOX produced or was given, with
provenance and lineage. They answer different questions, and merging them would
lose the provenance that makes the second answerable.

`getApprovedSuitModel()` serves the **approved** version, not the newest. The
Suit Bay renders what a human or a QA pass accepted; a newer unreviewed version
appearing automatically would let an experiment silently replace the shipped
asset.

## 4. Delivery order

Phases follow the brief, resequenced only where a dependency forces it —
artifacts must exist before a provider has anywhere to put its output.

1. Capability taxonomy, provider interfaces, router *(this phase)*
2. Artifact + version + lineage + `CapabilityRun` ledger
3. Image provider (Gemini / Nano Banana 2)
4. Video provider (Higgsfield)
5. Events, signal classification, tests, docs

Execution-agent filesystem tools, Visual QA, the automatic iteration loop, Lab
wiring and the unified UI follow, and the report at each checkpoint states
plainly which of those are done and which are not.
