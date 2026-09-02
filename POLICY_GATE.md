# The Policy Gate — P1 + P2

**Status: shadow mode. The gate observes and records. It blocks nothing.**

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
| `tests/policy-gate.test.ts` | 41 tests over the matrix, determinism, model independence, economic authority, failure behaviour and boundary coverage. |

Two existing files gained one call each: `src/lib/agents/executor.ts` and
`src/lib/cognition/proposals.ts`. Nothing else changed. No schema change, no
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
  where it is not. An irreversible financial action is money leaving with no
  correcting entry and no external confirmation — the exact shape
  `ECONOMIC_INVARIANTS.md` I1 says must never happen on VOX's initiative. **No
  current tool is classified into that cell.** `DENY` marks a boundary rather
  than describing today.

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

**Nothing is outside the shadow gate.** Both execution authorities are
instrumented.

---

## 7. Findings recorded, NOT fixed

These are real and are documented here rather than half-solved.

### C-1 — research output reaches `workspace.write` with no boundary

`research.run` returns material authored by whoever wrote the web page. Nothing
downstream knows that, and a later step can write it into the source tree. This
is a prompt-injection path from the open web to the filesystem.

*This phase:* added `untrustedOutput: boolean`, set on `research.run` and
`calendar.list_events`, recorded on every shadow event. It **plays no part in
the policy decision** — a test asserts `research.run` still evaluates to `ALLOW`
with the marker set. A half-built taint rule that held some paths and not others
would be worse than an honest absence. Propagation and enforcement are P4.

### C-2 — no blast-radius enforcement

Consequence is now *classified and recorded*; it is not yet *enforced*. Shadow
mode is exactly the state of having the classification without acting on it.
P4 turns the recorded decisions into real ones.

### H-1 — `workspace.write` (ACT) + `workspace.validate` (ANALYZE)

Composed, these amount to arbitrary code execution from a single `ACT` grant:
write a file, then run the build that executes it. `workspace.validate` is
classified honestly as `ANALYZE` / `REVERSIBLE` — it changes nothing — and left
alone. Constraining what actions may *compose with* is not something a
per-action classification can express; it needs the gate to see a sequence, which
is P4.

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
