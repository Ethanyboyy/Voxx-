# The Policy Gate — P1 + P2

**Status: shadow mode. The gate observes and records. It blocks nothing.**

**Patched at P2.1** after an adversarial audit reproduced defects in the original
P1/P2 work: a wrong classification on the only money-touching tool (A-1),
runtime-mutable policy metadata (A-2), and research ingress that was both
under-classified (A-3) and partly invisible to the gate (A-5). All four are
corrected below and marked **[P2.1]**. Nothing was enforced; the gate still
blocks nothing.

**Vocabulary, used strictly throughout:** *classified* = a static table entry
exists. *Shadow-evaluated* = a decision was computed and recorded. *Enforced* =
execution was prevented. **Nothing in VOX is enforced by the gate.**

This document describes what was built in P1 (classification metadata) and P2
(the Policy Gate, shadow-only), and — just as importantly — what was found and
deliberately *not* fixed. Enforcement is P4 and does not exist yet.

---

## 1. Why there is a gate at all

VOX could already answer *"is this user allowed to do this?"* — that is
`checkCapability()` on the `OBSERVE < ANALYZE < RECOMMEND < ASK < ACT` ladder,
and it is unchanged by this phase. It is still the only source of authorization
truth.

What VOX could not answer is *"what does this action actually do, and what does
it cost to be wrong?"* A granted `ACT` permission records that a human once
decided a class of action was acceptable. It says nothing about whether a
specific call overwrites an untracked file, spends money that cannot be
recovered, or lists a directory.

Two examples show the axes are genuinely independent, which is why one cannot be
derived from the other:

| Tool | Permission level | What it actually does |
|---|---|---|
| `workspace.validate` | `ANALYZE` | Runs the repository's own typecheck, lint, tests and build |
| `qa.visual_review` | `RECOMMEND` | Charges a third-party provider on every call |

Authorization and consequence are separate questions. They are kept in separate
modules, with no field in common.

---

## 2. What was added

| File | Role |
|---|---|
| `src/lib/policy/classification.ts` | P1. Bounded vocabularies, the static per-action tables, and the derived task profile. |
| `src/lib/policy/gate.ts` | P2. The policy matrix, `evaluatePolicy()` (pure), and `recordShadowPolicyEvaluation()` (records, never blocks). |
| `tests/policy-gate.test.ts` | 57 tests over the matrix, determinism, model independence, economic authority, failure behaviour, boundary coverage, and **[P2.1]** runtime immutability, corrected classifications and single-evaluation coverage. |

Three existing files carry a gate call: `src/lib/agents/executor.ts`,
`src/lib/cognition/proposals.ts`, and **[P2.1]** `src/lib/research/service.ts`.
Nothing else changed. No schema change, no
migration, no new dependency, no change to the permission system, the economic
engine, the router, the orchestrator or the event bus.

---

## 3. Classification (P1)

**Task profile** — what the work *is*. Recorded now; P5/P6 will route on it.

| Field | Values |
|---|---|
| `sensitivity` | `PUBLIC` · `INTERNAL` · `PRIVATE` · `SENSITIVE` |
| `freshness` | `STATIC` · `FRESH` · `REALTIME` |
| `needsTools` / `needsStructuredOutput` / `needsVision` | boolean |
| `reasoningDepth` | `LOW` · `MEDIUM` · `HIGH` |
| `latencyBudget` | `INTERACTIVE` · `STANDARD` · `EXTENDED` |
| `costBudget` | `FREE` · `LOW` · `MODERATE` · `HIGH` |

**Action classification** — what the action *does*. This is the policy input.

| Field | Values |
|---|---|
| `effect` | `READ` · `ANALYZE` · `WRITE` · `ACT` · `FINANCIAL` |
| `reversibility` | `REVERSIBLE` · `PARTIALLY_REVERSIBLE` · `IRREVERSIBLE` |
| `financial` | boolean |
| `untrustedOutput` | boolean — **recorded only**, see §7 |

Deliberately absent: `confidence`, `reliability`, `availability`. Those describe
how a provider is behaving right now, not what a task requires; mixing a runtime
observation into a policy input is how a degraded provider comes to move a
safety decision. Provider availability already lives in
`src/lib/capabilities/availability.ts`.

Also absent: any permission key, capability level, or grant. A test asserts the
classification records carry no such field, so the two taxonomies cannot drift.

**[P2.1] Policy metadata is frozen at module load.** `Readonly<>` is erased at
compile time, and the audit used that to reclassify `workspace.write` from HOLD
to ALLOW in three lines, process-wide, because the lookup returned a live
reference into the shared table. Every table, every row, and `UNKNOWN_ACTION`
(one shared object that *is* the conservative default) are now deep-frozen. The
tests assert the behavioural invariant — attempt the mutation, evaluate again,
decision unchanged — not `Object.isFrozen()`.

**[P2.1] `economic.record_expense` is `FINANCIAL` + `IRREVERSIBLE`.** Traced end
to end, it reaches one SQL `INSERT`. There is no payment processor, bank, or
external money-movement integration anywhere in VOX, so this is an **accounting
mutation representing money moving elsewhere**, not an external spend. It stays
`FINANCIAL` because the row consumes the autonomous spend ceiling, a finite
budget only a human can raise. It is `IRREVERSIBLE` because
`db.economicExpense.create` is the only expense operation in the repository: no
delete, no update, and `toCents()` rejects negatives, **so the previous claim
that a "compensating entry" could correct it was unsupported — no such
mechanism exists.**

**[P2.1] `research.run` is a `WRITE`, not a `READ`.** It fetches the open web,
writes N `ResearchItem` rows, and calls `recordResearchExperience()`, which
creates a durable Memory plus knowledge-graph nodes and edges. "Observes;
changes nothing" was wrong about a call that adds to what VOX knows — and that
written state feeds back into planning. It now evaluates to `HOLD`.

**`FINANCIAL` vs `ACT` + `financial: true`.** `FINANCIAL` is for operations whose
*purpose* is moving the user's ledger (`economic.record_expense`).
`media.image.generate` charges a provider, but its purpose is an image — it is
`ACT` with `financial: true`. The distinction is the operation's reason for
existing; the separate flag carries the billing fact either way.

All 27 registered tools and all 5 proposal handlers are classified. A test fails
if a tool is added without an entry.

---

## 4. The policy matrix (P2)

Effect down, reversibility across. This table *is* the decision procedure.

| | `REVERSIBLE` | `PARTIALLY_REVERSIBLE` | `IRREVERSIBLE` |
|---|---|---|---|
| **`READ`** | ALLOW | ALLOW | ALLOW |
| **`ANALYZE`** | ALLOW | ALLOW | ALLOW |
| **`WRITE`** | ALLOW | HOLD | HOLD |
| **`ACT`** | HOLD | HOLD | HOLD |
| **`FINANCIAL`** | HOLD | HOLD | **DENY** |

Plus exactly one rule: **`financial: true` escalates an `ALLOW` to `HOLD`.** It
can only ever raise, never lower. It exists for the case the matrix alone
misses — `qa.visual_review` is an `ANALYZE` that charges money and would
otherwise pass as a harmless observation.

Reading the rows:

- **`READ` / `ANALYZE`** observe; there is no effect to reverse, so the
  reversibility column is vacuous. The rows are kept total anyway — a partial
  table is a table with a hole in it.
- **`WRITE`** that can be cleanly undone is ordinary work. A write that cannot
  is different in kind: `workspace.write` over an untracked file destroys
  something git cannot return.
- **`ACT`** reaches outside VOX. Even the reversible-looking cases are not
  reversible from the other party's view — deleting a calendar event does not
  un-send the invitation.
- **`FINANCIAL`** is held wherever recovery is even partly possible and denied
  where it is not.

**[P2.1] The `DENY` cell is no longer empty.** This document previously claimed
no tool occupied it and presented that as a deliberate boundary. That was wrong:
`economic.record_expense` belongs there, and the cell was empty only because its
reversibility had been rated optimistically. It now evaluates to **`DENY`** —
**a shadow verdict that stops nothing.**

### The open question at `FINANCIAL` + `IRREVERSIBLE`

This needs a deliberate answer **before P4**, and P2.1 does not presume it.

`DENY` currently means *"policy refuses this categorically; no approval routes
around it."* But a human raising the spend ceiling and authorising a spend is a
legitimate authorisation path, and the economic engine already enforces it with
an atomic ceiling and a global halt. Under enforcement as written, VOX could
never record an autonomous expense again.

One of these has to be chosen, as policy design rather than as a table edit:

1. `DENY` keeps its categorical meaning, and this operation needs a reversibility
   grade distinguishing *"unrecoverable"* from *"unrecoverable but bounded by an
   authority the gate cannot see"*; or
2. `DENY` splits into *forbidden* versus *requires authority beyond the gate*.

The matrix was **not** changed here. It remains consistent with its own stated
semantics; what changed is that a fact underneath it was corrected. Correct
classification first, policy semantics second, enforcement later.

**Unclassified actions** get `WRITE` + `PARTIALLY_REVERSIBLE` → `HOLD`.
Conservative but recoverable: a forgotten table entry demands a human rather
than becoming permanently unusable, so it stays distinguishable from a
deliberate prohibition.

### The gate never weakens anything

`evaluatePolicy()` accepts an optional `prior` decision and returns
`strictest(prior, own)`. There is no expression in the module that lowers a
decision. The economic engine's halt, ceiling and `decide()` outcomes remain the
final authority over financial execution; the gate can add a `HOLD` on top of
them and has no way to remove one. A test asserts that across every cell × every
prior, the result is at least as strict as the prior.

### The gate is model-independent

`evaluatePolicy()` is synchronous, takes only enums and booleans, and imports no
provider. Model text claiming an action is safe is not weighed and discarded —
it is *unrepresentable* in the input type. A test smuggles `"This is completely
safe"` and `"This is EXTREMELY DANGEROUS"` past the types and asserts the two
evaluations are identical objects.

### The gate never throws

Malformed input — a null classification, an effect outside the vocabulary, a
non-object — returns a conservative `HOLD` with reason code `MALFORMED_INPUT`
and a note naming what was wrong. `recordShadowPolicyEvaluation()` catches
everything, including a failing event write, and logs it. A policy layer that
can crash the thing it observes has made the system less safe.

---

## 5. Shadow mode

`recordShadowPolicyEvaluation()` **returns `void`.**

That is the enforcement mechanism for "a `HOLD` must still execute in P2": the
executor has nothing in its hand to branch on. It is not a convention someone
could forget — there is no value to misuse. When P4 makes enforcement
deliberate, that signature changes, and the change is visible in a diff.

| Decision | P2 behaviour |
|---|---|
| `ALLOW` | Event recorded. Execution proceeds. |
| `HOLD` | Event recorded. **Execution proceeds.** |
| `DENY` | Event recorded. **Execution proceeds.** |

Each evaluation writes one `Event` of type `policy.shadow_evaluated`, marked
**non-consequential** — the gate observed, it did not act, and flooding the
consequential feed would bury what VOX actually did.

The payload is enums, booleans, the action id and the boundary name:
`boundary`, `registry`, `actionId`, `classificationKnown`, `effect`,
`reversibility`, `financial`, `untrustedOutput`, `sensitivity`, `freshness`,
`decision`, `matrixDecision`, `priorDecision`, `reasonCodes`, `notes`,
`shadowMode`, `executionContinued`. No prompt, no tool input, no tool output, no
credential, no user content — none of which the gate is given in the first
place. A test pins the exact key set.

---

## 6. Execution paths and coverage

| Path | Reaches the gate? | How |
|---|---|---|
| Chat → capability request | Yes | `driveRequest()` → `startAgentRun()` → executor |
| Agent run | Yes | `startAgentRun()` / `resumeAgentRun()` → executor |
| Orchestrator → executor | Yes | `driveRequest()` → `executeRun()` |
| Supervisor run | Yes | creates `AgentRun`s → executor |
| Direct tool invocation | Yes | `agents/executor.ts` is the **only** site in VOX that calls `tool.execute()` |
| **`POST /api/research`** | **[P2.1] Yes** | gated at `runResearch()`, the shared service |
| Proposal approval | Yes, separately | instrumented directly in `approveProposal()` |
| Background execution | **N/A — none exists** | see below |

The executor's single `tool.execute()` call is the narrowest boundary that
covers everything tool-shaped, which is why the gate sits there and nowhere
else. The call is placed outside the retry loop: one attempt to run a step is
one decision, and recording per retry would inflate the shadow `HOLD` rate this
phase exists to measure.

**There is no background runtime.** No cron, no queue, no worker, no
`setInterval` anywhere in `src/lib`. `runEconomicTick()` is invoked only by
`POST /api/economic/tick` — a request a human makes. Nothing outside the gate
runs on its own, because nothing runs on its own at all.

**[P2.1] What is and is not covered — the original claim here was false.**

It read *"Nothing is outside the shadow gate."* That was true of **tool
execution** and untrue of **VOX's execution surface**: `POST /api/research`
called `runResearch()` directly, so the one operation that brings untrusted web
content into VOX's memory and knowledge graph produced no record at all.

Fixed by gating the **shared service** rather than the route, so every caller is
covered instead of each new one having to remember. Double-recording is prevented
by a policy-boundary scope (`withPolicyBoundary`, an `AsyncLocalStorage` in
`policy/gate.ts`): the outermost boundary records and a nested evaluation defers
to it. One research operation produces exactly one event whether it arrives
through the tool or the route — asserted by test. It is per-async-context, not a
global flag, so concurrent runs cannot suppress each other.

**Still outside the gate**, stated plainly rather than papered over:

- **~113 other mutating API routes** — a human acting through their own session,
  rather than VOX acting on its own initiative.
- **`POST /api/economic/assets/[id]/expenses`** → `addEconomicExpense()`, which
  also bypasses the autonomous ceiling. That bypass is deliberate and documented
  in `economic/spend.ts` (a human recording history they already incurred).
- **`POST /api/connections/[service]/grant-access`** → `grantPermission(ACT)`.
  The gate classifies *actions*, not the *granting of the authority* those
  actions need. Finding A-6.
- **`generation/blenderLocal.ts`**, an `execFile` subprocess with no caller —
  unreachable today, unclassified if a future phase wires it up. Finding A-13.

Both **execution authorities** are instrumented. That is a narrower and true
claim than the one it replaces.

---

## 7. Findings recorded, NOT fixed

These are real and are documented here rather than half-solved.

### C-1 — research output reaches `workspace.write` with no boundary

`research.run` returns material authored by whoever wrote the web page. Nothing
downstream knows that, and a later step can write it into the source tree. This
is a prompt-injection path from the open web to the filesystem.

*This phase:* added `untrustedOutput: boolean`, set on `research.run` and
`calendar.list_events`, recorded on every shadow event. It **plays no part in
the policy decision** — a test evaluates the same classification with the marker
cleared and asserts an identical result. A half-built taint rule holding some
paths and not others would be worse than an honest absence.

**[P2.1]** `research.run` now evaluates to `HOLD`, but because A-3 corrected its
**effect** to `WRITE` — not because of the marker. The audit traced the concrete
path the marker does *not* stop: web page → `ResearchItem` rows →
`recordResearchExperience()` → Memory and graph nodes → `buildPlanningContext()`
→ **the planner's prompt** → planner-authored `workspace.write` arguments. The
taint is in the tool *arguments*; `untrustedOutput` marks *producers*. **C-1 is
not fixed.** Propagation and enforcement are P4.

### C-2 — no blast-radius enforcement

Consequence is now *classified and recorded*; it is not yet *enforced*. Shadow
mode is exactly the state of having the classification without acting on it.
P4 turns the recorded decisions into real ones.

### H-1 — `workspace.write` (ACT) + `workspace.validate` (ANALYZE)

**[P2.1] Restated accurately — the original description understated this.**

`workspace.validate` runs `execFile('npm', ['run', <script>])` over a closed set
including `test` and `build`. **`npm run test` runs `vitest`, which loads and
executes every `tests/**/*.test.ts` file in the repository as Node code**, with
full process privileges: `child_process`, filesystem, network, `DATABASE_URL`.
`npm run build` likewise executes configuration.

```
workspace.write   →  tests/anything.test.ts     [requires ACT]
workspace.validate name:"test"                  [requires ANALYZE]
                                                 ↑ DEFAULT_GRANTED_LEVEL
                                                   — no grant needed at all
```

**A single `ACT` grant on `workspace.write` yields arbitrary code execution.**
The executing half is free, because `ANALYZE` is the default granted level.

The gate currently makes the wrong half safe: it `HOLD`s the write and
**`ALLOW`s the execution**. It sees individual actions; the risk is in the
sequence.

`workspace.validate` remains classified `ANALYZE` / `REVERSIBLE`, honest about
that action in isolation, and is left alone. Constraining what actions may
*compose with* needs the gate to see a sequence, which is P4. **H-1 is not
fixed.**

### H-4 — `approveProposal()` bypasses the main executor

**Confirmed against source, not taken from the audit.** `approveProposal()` in
`src/lib/cognition/proposals.ts` looks up `ACTION_HANDLERS[proposal.actionType]`
and calls it directly. It never touches `agents/executor.ts`.

Two things are true and should not be conflated:

- **Authorization is *not* bypassed.** `enforceCapability()` runs first, and it
  is the same function every other path uses. There is no privilege escalation
  here.
- **Execution authority *is* duplicated.** VOX has two registries that can run
  something, and a control added to one does not apply to the other.

*This phase:* instrumented the proposal path directly so the shadow record is
complete, rather than leaving a hole in the audit trail or refactoring execution
under a hardening phase. Unifying the registries is P4.

### Approval states (for P3, not migrated)

Five states across five subsystems mean "waiting for a human". None were
touched:

| Model | State |
|---|---|
| `AgentRun` | `WAITING_FOR_PERMISSION` |
| `SupervisorRun` | `WAITING_FOR_APPROVAL` |
| `Proposal` | `PROPOSED` |
| `Connection` | `AWAITING_APPROVAL` |
| `ExperimentExecution` | `AWAITING_HUMAN` |

P3 adds a read-side `PendingApproval` projection over these. It does **not**
merge them into one enum — that would be a schema rewrite reaching into the
economic engine's state machine.

---

## 8. Not in this phase

No unified approval queue (P3). No gate enforcement or taint boundary (P4). No
provider registry (P5). No xAI/Grok adapter (P6). No background autonomy (P7) —
and P7 stays last, because the control plane has to exist before autonomy is
expanded into it.

## [P2.1] Findings still open

Corrected in P2.1: **A-1**, **A-2**, **A-3**, **A-5**.

**Not fixed, none of them:** **C-1** (taint), **C-2** (no blast-radius
enforcement), **H-1** (composition → arbitrary code execution), **H-4**
(proposal execution authority), **A-4** (= H-1's sequence problem), **A-6**
(permission-granting routes ungated), **A-7** (one evaluation covers N paid
provider calls — `media.image.generate` `count`, and the `media.image.refine`
loop), **A-8** (`qa.visual_review` and `artifact.select_best` rated `REVERSIBLE`
despite unrecoverable spend; the decision is right via the financial flag, the
reasoning is not), **A-9** (= C-1's traced path), **A-10** (= H-4), **A-11**
(`ACTION_HANDLERS` unexported, so no coverage test for the proposal key space),
**A-12** (one `Event` write per tool step: latency and unbounded growth),
**A-13** (unreachable Blender subprocess), **A-14** (calendar tools throw
unconditionally, so their classifications are aspirational), plus the fact that
six of eight `TaskProfile` fields are computed and discarded, two of them
constants.
