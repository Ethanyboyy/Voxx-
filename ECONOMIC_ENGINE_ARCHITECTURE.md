# Economic Engine Architecture

Status: **Phase 1 implemented** (this milestone). Extends the existing Objective/Opportunity,
Supervisor, Agent Runtime, and Economic Command (`EconomicAsset`/`EconomicRevenue`/`EconomicExpense`)
systems — no parallel execution engine, event bus, or permission system was created.

Every section below is labeled **Implemented** or **Future** — nothing aspirational is
described as done.

## 1. Economic Engine architecture — Implemented

There is no new "Economic Engine" service module or database subsystem separate from what
already existed. Concretely, this milestone is additive glue across four existing systems:

- **Opportunity** (`prisma/schema.prisma`, `src/lib/objectives/service.ts`) — extended with
  structured intelligence fields (category, source, discoveredAt, estimated startup/operating
  cost, margin, time-to-revenue, complexity/competition/scalability/human-involvement,
  required capabilities, dependencies, rationale, and a `{type, text}` evidence-item convention
  distinguishing FACT/SOURCED/ESTIMATE/ASSUMPTION/UNKNOWN).
- **Objective** — gained `sourceOpportunityId`, so an Objective can be traced back to the
  Opportunity it exists to validate.
- **SupervisorRun** (`src/lib/supervisor/service.ts`) — unchanged execution model, but now
  writes a structured `Outcome` row on every terminal transition and honors `AutonomyMode.MANUAL`
  by stopping at `BLOCKED` before executing.
- **Economic Command** (`src/lib/economic/service.ts`) — gained one new capability-gated write
  path (`recordOpportunitySpend`) alongside the pre-existing ungated user CRUD for
  assets/revenue/expense.

## 2. Opportunity lifecycle — Implemented

`OpportunityStatus` (additive enum values, existing IDEA/EVALUATING/ACTIVE/PAUSED/COMPLETED/
REJECTED unchanged): `DISCOVERED → RESEARCHING → EVALUATING → WATCHLIST → APPROVED → PLANNING →
EXECUTING → VALIDATING → ACTIVE / PAUSED / FAILED / COMPLETED / REJECTED`.

Transitions go through the existing `updateOpportunity()`, which already emits
`opportunity.status_changed` on every change — no new event path. `createValidationObjective()`
additionally advances an opportunity from its early states to `PLANNING` when it produces a
real Objective, and emits `opportunity.objective_created`.

## 3. Economic scoring — Implemented

`scoreOpportunity()` / `explainOpportunityScore()` (`src/lib/objectives/service.ts`) are
extended in place, not duplicated. The pre-existing formula
(`value / effortWeight * confidenceWeight * (1 - riskPenalty)`) is unchanged in shape; new
factors are appended as additional divisors/multipliers:

```
score = (value / effortWeight * confidenceWeight * (1 - riskPenalty))
        / capitalDivisor          # 1 + startupCost/1000
        / operatingDivisor        # 1 + operatingCost/500
        * marginMultiplier        # 0.5 + margin  (neutral=1 when margin unset)
        * speedMultiplier         # clamp(30 / max(7, daysToRevenue), 0.3, 2)
        * (1 - complexityPenalty)
        * (1 - competitionPenalty)
        * (1 + scalabilityBonus)
        * (1 - humanInvolvementPenalty)
```

Every new factor defaults to neutral (no change to the score) when its field is `null` — an
opportunity created before this milestone, or one with unknown economics, scores identically
to how it always did. `explainOpportunityScore()` exposes every intermediate factor, and the
Objectives UI renders a "why this score" panel from that exact breakdown — the ranking is
never a black box (tests: `tests/economic-engine.test.ts`, "opportunity scoring" describe block).

## 4. Budget model — Implemented (decision layer only, not wired to real money)

`User.maxAutonomousSpendUsd` (default **0** — no autonomous spend until a human configures it)
is the single ceiling. `src/lib/economic/policy.ts#evaluateSpendPolicy(userId, amountUsd)`
compares a proposed amount against it and returns an allow/deny decision with a human-readable
reason. `getBudgetSummary()` (`src/lib/economic/service.ts`) reports real, computed totals
(sum of actual `EconomicExpense` rows) — never a projected or cached running balance that could
drift.

**Not implemented**: committed-vs-spent distinction, per-objective/per-opportunity budget caps,
recurring-spend projection, or any connection to a real payment method. The directive
explicitly scoped this milestone to the decision/control layer only.

## 5. Autonomy policy — Implemented (one real behavioral difference; two modes still aliased)

`AutonomyMode` has four values. Two are now genuinely distinct in behavior:

- **MANUAL**: `startSupervisorRun()` plans and selects/creates an agent as normal, but stops at
  `SupervisorRunStatus.BLOCKED` instead of calling `startAgentRun()`. The plan is fully
  inspectable (`SupervisorRun.plan`, JSON). A human must call `beginSupervisorExecution()`
  (UI: "Start execution") to actually run it — and that call runs *exactly* the stored plan,
  never re-planning. Additionally, `selectOrCreateAgent()` never grants a newly-created agent
  any tool capability under MANUAL, regardless of what the plan needs.
- **AUTONOMOUS_APPROVAL_GATES** (default): agents get exactly the capabilities their plan
  needs; execution proceeds without a human step until a real `WAITING_FOR_PERMISSION`
  boundary (an ungranted capability) is hit.
- **SUPERVISED** and **AUTONOMOUS** are currently aliases of `AUTONOMOUS_APPROVAL_GATES` — not
  yet behaviorally distinct. This is an honest limitation, not an oversight: differentiating
  them meaningfully (e.g., a genuine "escalate uncertain-but-technically-permitted actions"
  policy) needs a real uncertainty signal VOX doesn't yet compute, and building one now would
  have meant fabricating a confidence metric with no basis — deferred rather than faked.

The one central policy decision function this milestone adds is `evaluateSpendPolicy()` — a
domain-specific control that composes with, and never replaces, the existing
`checkCapability()`/`Agent.allowedCapabilities` authorization chain. A single centralized
`AUTONOMY × CAPABILITY × PERMISSION × RISK × EXECUTION-LIMIT` policy engine (as sketched in the
directive) is **not** built as one module; the authorization chain is composed from the
capability system + `Agent.allowedCapabilities` + `evaluateSpendPolicy()`, evaluated in that
order, each independently, at the two real enforcement points (`executor.ts`,
`economic.record_expense`'s tool body).

## 6. Approval policy — Implemented (scoped)

The existing `WAITING_FOR_PERMISSION` → `WAITING_FOR_APPROVAL` → Approve/Decline flow
(previous Supervisor milestone) is unchanged and reused. The approval card shows: the action,
the tool, the required capability/level, and — when the blocked tool is
`economic.record_expense` — its proposed cost (parsed from the real step input, never
fabricated). Approve grants the real Permission and resumes.

**Not implemented**: the directive's full approval-card field list (expected benefit, risk
classification beyond capability level, reversibility, "what's already been done",
recommended-decision, confidence score). These were deliberately not fabricated — VOX has no
real, non-invented basis to compute a "recommended decision" or a numeric confidence for an
arbitrary tool call today, and inventing one would violate the codebase's standing
anti-fabrication rules. The fields that are real (capability, level, tool, cost when known) are
shown; the rest is left honestly absent rather than faked.

## 7. Supervisor integration — Implemented

`Opportunity → createValidationObjective() → Objective (sourceOpportunityId) →
startSupervisorRun() → (existing planner/executor, unchanged) → AgentRun → Outcome →
Economic Engine (EconomicAsset/Expense) → Brain graph`. No second execution engine. The
`economic.record_expense` Tool Registry entry (`src/lib/tools/registry.ts`) is the only new
tool; it is reached exclusively through the existing executor's per-step
`checkCapability()`/`Agent.allowedCapabilities` gate, exactly like every other tool.

## 8. Outcome evaluation — Implemented

New `Outcome` model, one per `SupervisorRun` (1:1). Written by
`src/lib/supervisor/service.ts#recordOutcome()` on every terminal transition
(`COMPLETED`/`FAILED`/`CANCELLED`/declined). Explicitly does **not** equate "AgentRun
completed" with "objective succeeded" — `Outcome.summary` for the COMPLETED case says, in
plain language, that completion reflects execution finishing, not an independently verified
real-world result. `costUsd` is the real sum of `EconomicExpense` rows tied to the objective's
source opportunity (0/null when there is none); `timeSpentMinutes` is wall-clock from
`SupervisorRun.createdAt`. `OutcomeStatus.PARTIALLY_COMPLETED` and `.UNKNOWN` exist in the enum
for future use but nothing yet produces them — every current terminal path maps cleanly to
COMPLETED/FAILED/ABANDONED/BLOCKED.

## 9. Memory/learning integration — Implemented (narrow, honest)

`maybeRecordEconomicMemory()` fires only when a terminated `SupervisorRun`'s Objective has a
`sourceOpportunity` — i.e., only for real economic-validation attempts. It writes one
`EXPERIENCE`-category Memory via the existing `createMemory()` (no new memory table), containing
only real numbers: the opportunity title, outcome status, real cost, and real elapsed time.
Confidence is `MEDIUM` when a real cost figure exists, `LOW` otherwise. No interpretation
("this failed because X") is generated — that would require a causal judgment VOX cannot
actually verify from the data it has.

## 10. Future: multi-agent architecture — Not implemented (interfaces are ready)

`selectOrCreateAgent()` is already capability-based and generic (never a hardcoded per-domain
mapping), which is the one precondition a Research/Analysis/Builder/Marketing multi-agent
Supervisor would need. `SupervisorRun.agentRuns` is already a one-to-many relation at the
schema level (a run can reference multiple `AgentRun`s over its lifetime via replanning), but
`applyAgentRunOutcome()` still drives exactly one *active* AgentRun at a time — true parallel
coordination of multiple simultaneous AgentRuns under one SupervisorRun, a task-decomposition
layer that splits a plan across specialized agents, and inter-agent result aggregation are all
unbuilt. Recommended next step if this is prioritized: introduce a `SupervisorTask` join
between `SupervisorRun` and `AgentRun` (order, role, dependency-on-other-tasks) so a plan can
name multiple concurrent roles without changing the single-AgentRun-at-a-time execution
contract until parallel execution is actually implemented.

## 11. Future: durable background execution — Not implemented (migration path documented)

Every execution path in this codebase — `executeRun()`, `startAgentRun()`, `startSupervisorRun()`,
`beginSupervisorExecution()` — runs **synchronously within the HTTP request** that triggered it.
There is no job queue, worker process, execution lease, heartbeat, or crash-recovery mechanism.
Concretely:

- If the request is interrupted (browser closed, network drop, server restart) mid-run, the
  `AgentRun`/`SupervisorRun` is left in whatever DB state the last completed step wrote — not
  corrupted, but not resumed either. A human (or a future scheduled job) must call
  `resumeAgentRun()`/`resumeSupervisorRun()` again to continue.
- There is no wall-clock execution limit — only the existing step/retry/replan-iteration counts
  bound the work. A tool call that hangs (e.g., a slow external HTTP request inside a future
  real tool) would hold the request open indefinitely today.
- Fly.io's `min_machines_running = 1` (see `src/lib/events/bus.ts`'s deployment note) means the
  single-process assumption already baked into the live event bus applies here too — nothing
  new, but worth restating since durable execution and the event bus would need to evolve
  together.

**Migration path**, if/when this becomes necessary: extract the body of `startAgentRun()`/
`applyAgentRunOutcome()`'s "drive one step / one AgentRun" logic into a function callable from a
durable job (e.g., a `SupervisorRun.leaseExpiresAt` + `SupervisorRun.heartbeatAt` pair, polled by
a worker), keep the exact same DB state machine (`SupervisorRunStatus`/`AgentRunStatus` are
already resumable-by-design — `WAITING_FOR_PERMISSION` and `WAITING_FOR_APPROVAL` already prove
the pattern works across process restarts today), and add a wall-clock `maxRuntimeMs` check
inside the executor's step loop that transitions to a new `LIMIT_REACHED`-style terminal state
(not yet in the enum) instead of running forever. None of this was built now — it would be
speculative infrastructure for a request-execution model that hasn't yet needed it, per the
"do not overbuild" directive.

---

# Phase 2 — the control loop (implemented)

Phase 1 gave the engine a scored pipeline, a ledger, a spend policy and an outcome record. What
it did not have was a **loop**: nothing measured time-windowed profit, nothing decided whether a
venture should grow or die, nothing ran on a schedule, and nothing could be stopped. Phase 2 adds
those four pieces. It again creates no parallel engine — the ledger, the Experiment model, the
Event log and the permission system are the existing ones.

## 12. P&L rollup — `src/lib/economic/pnl.ts`

`getPnlReport(userId, now)` computes lifetime / today / trailing-7d / trailing-30d revenue,
expense and net from the existing `EconomicRevenue` and `EconomicExpense` rows, plus distance
from the $500/day floor and the $100,000/30-day objective.

**Provenance separation is structural, not conventional.** `LedgerProvenance` has three members —
`REALIZED`, `USER_RECORDED`, `SIMULATED` — and deliberately no `PROJECTED`:

- A forecast cannot be stored as a ledger row at all. Expectations live on the experiment
  contract (`Experiment.expectedNetProfitUsd`), in a different table, and surface in the report
  as `outlook`, a field of a **different type** (`ProjectedOutlook`) from every realized total.
  Summing a projection into profit is therefore a type error, not a bug to be noticed in review.
- `SIMULATED` rows are reported but never counted as money, never counted toward a goal, and
  never consume the real autonomous-spend ceiling.
- `REALIZED` means confirmed against an external system of record. **Nothing in VOX can write it
  today** — there is no payment or banking integration — so realized profit is currently $0 by
  construction, and the report says so rather than borrowing the user-recorded number.

**Capital is null, not zero.** `CapitalPosture.availableUsd` is `null` with a stated reason.
VOX does not synthesize a capital account, and does not present `maxAutonomousSpendUsd` as cash:
that is a policy ceiling, reported in its own separate fields.

## 13. The economic experiment contract — `Experiment` + `src/lib/economic/experiments.ts`

The existing `Experiment` model was **extended**, not duplicated: `hypothesis` and `method` were
already the first two terms of a contract. Added: required capital, maximum loss, success and
failure metrics, deadline, scale and kill criteria (each with a machine-checkable USD threshold
beside the prose), expected return, expected net profit, required capabilities, an
`executionStatus` and an `outcome`.

Every gating constraint is a **number or a date**, because an autonomous scheduler must be able
to compare a constraint, not recall it from prose. `validateContract()` reports missing terms and
incoherent ones separately (e.g. a kill threshold the loss cap would always beat), and
`toDecisionContract()` returns `null` rather than defaulting a blank — there is no safe default
for "how much may this lose".

## 14. The decision layer — `src/lib/economic/decide.ts`

A pure function: no I/O, no database, **no model call**, no override parameter. Rule order, hard
constraints first and short-circuiting:

1. **Maximum loss** — net loss ≥ `maxLossUsd` → KILL. Checked before everything, including the
   global halt and including a simultaneously-satisfied scale threshold.
2. **Kill threshold** — net ≤ `killAtNetUsd` → KILL.
3. **Global halt** → HOLD. Never SCALE while halted; KILL stays reachable above this line
   because killing only reduces exposure.
4. **Deadline** — past `deadlineAt`, scale threshold met → SCALE, otherwise → KILL.
5. **Capital vs policy** — scaling would exceed the user's ceiling → HOLD.
6. **Scale threshold** met → SCALE. 7. Otherwise HOLD.

Every result carries the numbers that produced it and marks exactly one binding constraint.

## 15. Scheduler tick and the global halt — `scheduler.ts`, `halt.ts`

`runEconomicTick(userId, now)` walks live contracts, measures each against its own asset's real
ledger, calls `decide()`, and records the answer. It starts no run, calls no provider, invokes no
model and spends nothing.

**Idempotency lives in the database.** The tick key is a deterministic hourly bucket and
`EconomicTick` carries `@@unique([userId, tickKey])`; the bucket is claimed *before* any work, so
a double-fired cron, a retried request or two racing processes produce one tick.

**The boundary is honest.** VOX has no payment, purchasing or deployment capability — every
Connections Hub provider throws by design. So a SCALE decision **cannot be executed**: the
experiment moves to `AWAITING_HUMAN` and an `economic_experiment.scale_blocked` Event records why.
KILL *is* applied automatically, because stopping needs no capability VOX lacks and a contract
past its loss cap must not wait on someone reading a notification. That asymmetry is deliberate.

**The halt is enforced in service code**, at four independent points: `evaluateSpendPolicy()`
denies (checked before the ceiling, so it denies $0.01 as firmly as $10,000),
`recordOpportunitySpend()` throws `EconomicHaltedError`, `runEconomicTick()` records a `HALTED`
tick without evaluating anything, and `decide()` cannot return SCALE. Hiding the UI control would
not re-enable spending.

## 16. Closing the loop — `src/lib/economic/lessons.ts`

A killed contract writes one Memory through the existing memory service: the **measured fact**,
with its real numbers, as a `FACT` — not the generalization, which one experiment does not
support. `getRelevantLessons()` ranks only economic lessons by embedding similarity to the
opportunity's own text and drops anything below a relevance floor, so an unrelated failure never
shades an unrelated idea. `evaluateOpportunityWithLessons()` attaches them **beside** the score
and never adjusts it — per rule 3, an inference stays an inference until a human promotes it.

## 17. What is still blocked

The loop is complete up to the point where money would actually move. The first real-money
experiment needs **one** thing that does not exist: a payment/banking capability behind
`src/lib/integrations/` that can (a) deploy capital under `ACT` permission and (b) write
`REALIZED` ledger rows from confirmed external records. Everything upstream of that — contract,
decision, scheduler, halt, P&L, lesson loop — runs today.
