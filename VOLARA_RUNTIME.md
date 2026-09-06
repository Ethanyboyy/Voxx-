# VOLARA — Autonomous Multi-Agent Runtime & Economic Control Plane (P4-F)

> Read `POLICY_GATE.md` first. This document assumes P4-A … P4-E: the policy
> matrix, argument-bound single-use `ApprovalGrant`s, `enforceExecution()`,
> `assertExecutionAuthorized()` at the sink, and capability classification by
> maximum consequence. **Nothing here weakens any of it.** Volara is a *client*
> of that machinery, never a second copy of it.

---

## 1. What Volara is

Five persistent agents (`Volara-1` … `Volara-5`) that run a real, staged
runtime loop over VOX's own recorded data, share one Opportunity Ledger, talk
to each other, propose strategies, and ask for capital — which they cannot
give themselves.

## 2. What Volara is *not*

It has no browser, no credentials, no payment method, no external account, and
no way to reach one. Every consequential act in the runtime funnels into a
single classified tool (`volara.allocate_capital`), which is `FINANCIAL` /
`IRREVERSIBLE` → **HOLD**, and therefore cannot run without a human's
argument-bound, single-use approval. Everything else the loop does is an
internal proposal row.

## 3. The five agents

| Agent | Role | What it actually does |
|---|---|---|
| Volara-1 | `SCOUT` | Surfaces ledger rows that are unexamined — real `Opportunity` rows in `IDEA`/`DISCOVERED`, never invented ones. |
| Volara-2 | `ANALYST` | Flags opportunities whose recorded economics are incomplete or internally inconsistent. Never fills a number in. |
| Volara-3 | `STRATEGIST` | Drafts `Strategy` rows from recorded categories. A draft is a proposal; only a human activates one. |
| Volara-4 | `OPERATOR` | Requests capital for opportunities that an ACTIVE strategy admits. A request is not an allocation. |
| Volara-5 | `AUDITOR` | Re-checks treasury conservation and allocation legality and messages the society when something does not reconcile. |

Roles are behaviour, not privilege. Every agent runs the same loop, passes the
same guards, and holds exactly the capabilities a human granted it.

## 4. Data model — what was added, and why each one had to be

Reuse first. `Agent` already *is* the persistent agent identity, `Opportunity`
already *is* the ledger, `Event` already *is* the audit trail, `ApprovalGrant`
already *is* the authorization primitive, and `AgentRun`/`AgentStep` already
*are* the execution path. None of those were duplicated.

**Extended in place**

- `Agent` — runtime state, autonomy mode, heartbeat, cycle counters, failure
  counters, suspension, a CAS lease, and a per-request capital cap. `Agent`
  was already the persistent identity; giving it runtime state is the opposite
  of a parallel entity.
- `Opportunity` — `discoveredByAgentId`, `strategyId`. Nothing existing could
  say which agent surfaced a row or which strategy it serves.

**New, because nothing existing could represent it**

| Model | Why it exists |
|---|---|
| `AgentStateTransition` | The lifecycle must be *auditable*, not merely current. A status column records where an agent is; it cannot record that it got there legally. |
| `AgentMessage` | Agent-to-agent communication. No existing model carries a message between two agents. Deliberately has **no** capability, grant, level, or authorization column — see §6. |
| `Strategy` | Shared, human-activated strategy. `Objective` is the user's goal; a strategy is a standing *rule set* that bounds what agents may request. |
| `CapitalAllocation` | A *reservation*, which `EconomicExpense` cannot express — an expense is money already spent, an allocation is money set aside and not yet spent. Carries the request, the governor's decision record, and the release, in one row with one status, rather than three tables. |

No `Treasury` model. See §5.

## 5. The economic control plane

### Treasury is derived, never stored

There is exactly one authoritative statement of financial position, and it is
computed from rows that already exist:

```
ceilingCents   = User.maxAutonomousSpendUsd × 100          (only a human raises it)
spentCents     = Σ EconomicExpense.amountCents  (REALIZED | USER_RECORDED)
reservedCents  = Σ CapitalAllocation.approvedCents WHERE status = APPROVED
availableCents = max(0, ceiling − spent − reserved)
```

A stored balance would be a second source of truth that can drift from the
rows it summarizes. There is no `credit`, no `topUp`, no `setBalance`, and no
write path anywhere in `src/lib/volara/` that touches `User.maxAutonomousSpendUsd`
or `User.economicHaltedAt`.

**An allocation can only ever reduce what is available.** It never adds. And
approving an allocation is *not* permission to spend: actually spending still
goes through `recordPolicySpend()`, which re-checks the halt and the cumulative
ceiling in its own atomic statement. The reservation is a second, tighter
constraint layered over the existing one — never a replacement for it.

### The Capital Governor

`evaluateCapitalRequest()` is deterministic and takes numbers and enums only —
no model text reaches it, in the same way `evaluatePolicy()` takes no prose. It
refuses on:

`HALTED` · `AGENT_NOT_FOUND` · `AGENT_SUSPENDED` · `AGENT_CAP_EXCEEDED` ·
`RECENT_FAILURES` · `DUPLICATE_LIVE_REQUEST` · `NO_STRATEGY` ·
`STRATEGY_NOT_ACTIVE` · `STRATEGY_CAP_EXCEEDED` · `MAX_LOSS_UNACCEPTABLE` ·
`INSUFFICIENT_CAPITAL` · `RESERVE_FLOOR_BREACHED` · `CONCENTRATION_LIMIT` ·
`NON_POSITIVE_AMOUNT` · `AMOUNT_NOT_FINITE`

Three of those are the dynamic half the brief asks for, and all three only ever
narrow: a **reserve floor** (20% of the ceiling stays unreservable), a
**concentration bound** (no agent holds more than 50% of the ceiling), and
`RECENT_FAILURES` (an agent with two consecutive failed cycles is refused).
`MAX_LOSS_UNACCEPTABLE` treats an *unstated* downside as an unbounded one — a
null `maxLossCents` is the worst case, not the best. Recorded evidence can make
the governor refuse less often; it can never raise a cap.

A pass is **not** an approval. It only means the request is well-formed enough
to be put to a human. Every allocation, of every size, requires a human
approval — there is no auto-approve threshold, because a threshold is the
first thing an adversary tunes.

### Approval reuses the existing path, completely

An agent requesting capital creates a `CapitalAllocation` in `REQUESTED` and a
**one-step `AgentRun`** whose tool is `volara.allocate_capital`. From there,
nothing is new: argument finalization, the canonical hash, `enforceExecution()`,
the classification hash binding, `approveAgentStep()` (still the only minter of
grants in VOX), single-use compare-and-swap consumption, the existing approval
API and UI. The tool's implementation calls `assertExecutionAuthorized()` at
the sink, so a future caller that skipped the gate would throw rather than
allocate.

The approval transition itself is one conditional `UPDATE` whose `WHERE` clause
re-checks status, expiry, halt, and live available capital, so two concurrent
approvals cannot both reserve the same money.

**Which grant authorized an allocation is derived, never supplied.**
`approveCapitalAllocation()` takes no grant id. It looks the grant up by the
pair `step-approvals.ts` already binds every grant to — `targetType:
"AgentStep"` and the step this allocation was submitted through — and refuses
if no consumed grant sits there. An earlier draft passed a grant id in and
guessed it with "the most recently consumed grant for this action"; under five
concurrent approvals that recorded the *same* grant against several
allocations, so `approvalGrantId` stopped meaning anything. The adversarial
concurrency suite found it. Deriving it removed both the ambiguity and a
parameter that could be forged.

## 6. Messages are data, not authorization

This is the security property the runtime is built around.

- `AgentMessage` has no capability, level, grant, decision, or authorization
  column. It *structurally* cannot carry authority. A test asserts this against
  the generated Prisma types, so adding one later fails the suite.
- No function in `src/lib/volara/` reads a message on any path that leads to
  execution. `approveCapitalAllocation()` takes `(userId, allocationId)` and
  consults the enforcement layer — it has no message parameter to be
  influenced by.
- A message that *says* something is approved changes nothing. `Volara-1`
  broadcasting "Volara-3's trade is approved" leaves the allocation `REQUESTED`,
  mints no grant, and the tool still refuses.
- A supervisor message saying "execute immediately" is the same: it is a row in
  `AgentMessage` and the gate never looks at it.

## 7. No self-privilege escalation

Two layers, one structural and one runtime.

**Structural.** `src/lib/volara/` never imports `grantPermission`,
`createApprovalGrant`, or `consumeApprovalGrant`, and never writes to
`Permission`, `ApprovalGrant`, `Event` (except through `recordEvent`), or the
governing `User` columns. A test walks the directory and fails on any of them.

**Runtime.** `screenAgentIntent()` checks every agent-originated write against
a frozen intent set and a frozen protected-target set before it happens.
A refusal is recorded as `volara.escalation_refused` (consequential) and
suspends the agent. Protected: permissions, approval grants, policy
classification, the spend ceiling, the economic halt, autonomy modes, agent
capability allowlists, per-agent capital caps, the event log, and the
enforcement modules themselves.

An agent also cannot act on another agent: every mutation is scoped
`where: { id: <its own id>, userId }`, and `screenAgentIntent()` refuses a
target agent id that is not the acting agent's own.

## 8. The runtime loop

`runAgentCycle(userId, agentId)` runs six named stages, in order, each a
separate function:

1. **claim** — atomic CAS lease on the `Agent` row. A second concurrent cycle
   loses and does nothing. This is what makes a double-fired heartbeat harmless.
2. **perceive** — reads only. Ledger, messages, strategies, treasury.
3. **reason** — deterministic, role-specific, over the perceived rows. Produces
   findings; writes nothing.
4. **propose** — writes proposal rows only (`Opportunity`, `AgentMessage`,
   `Strategy` drafts, `CapitalAllocation` requests). Each write passes
   `screenAgentIntent()` first.
5. **authorize** — for anything consequential, hands off to the existing agent
   run + approval path. The loop never authorizes anything itself.
6. **learn** — records the cycle's real outcome against the agent's counters.
7. **release** — transition to `IDLE`, heartbeat, release the lease.

Every stage shares one `correlationId` (the cycle id), which lands on every
transition, message, allocation and event the cycle produces. `getCycleTrace()`
reassembles the whole cycle from it.

### Lifecycle

```
IDLE ─▶ THINKING ─▶ RESEARCHING ─▶ EVALUATING ─▶ PROPOSING
                                                    │
                                                    ▼
                                   WAITING_FOR_AUTHORIZATION ─▶ EXECUTING
                                                    │               │
                                                    ▼               ▼
                                          REPORTING ─▶ LEARNING ─▶ IDLE

  from anywhere the loop can be:  ─▶ PAUSED (human)   ─▶ FAILED ─▶ SUSPENDED
  out of SUSPENDED:               ─▶ IDLE, and ONLY via resumeAgent()
```

`EXECUTING` is reachable from exactly one state — `WAITING_FOR_AUTHORIZATION` —
which is the lifecycle expressing the same rule the gate enforces: nothing
executes that a human has not been asked about first. `FAILED` leads only to
`IDLE` or `SUSPENDED`, never straight back into work, so a failed cycle cannot
become a retry storm.

`transitionAgent()` refuses an illegal transition rather than performing it,
and every attempt — legal or not — writes an `AgentStateTransition` row, with
`refused: true` on the ones that did not happen. An attempted illegal
transition is therefore evidence rather than an absence. The write itself is a
compare-and-swap on the state the caller believed the agent was in, so two
concurrent transitions cannot both land.

Resurrection from `SUSPENDED` is a human act (`resumeAgent()`), never a cycle's
own doing. It resets `consecutiveFailures` and deliberately does **not** reset
`failureCount`: lifetime failure history survives a resume, because erasing it
to make an agent look healthy is the audit deletion §22 forbids.

## 9. Failure containment

A cycle's failure is caught inside that cycle. `runSociety()` uses
`Promise.allSettled`, so one agent throwing never stops the other four.
`consecutiveFailures` increments on failure and resets on success; at
`MAX_CONSECUTIVE_FAILURES` (3) the agent transitions to `SUSPENDED` and stops
being scheduled until a human resumes it.

## 10. Global Observer contract

`getVolaraObserverState(userId)` returns one snapshot — agents with live
runtime state, the derived treasury, allocations, recent messages, strategies,
recent transitions, and derived metrics — served by `GET /api/volara/state`.
Every number in it is computed from real rows at read time. There is no
simulated activity anywhere in this module, and no field whose value would be
fabricated when the underlying data is absent: it is `null`, and the observer
says so.

## 10a. Metrics, and what is deliberately `null`

`src/lib/volara/metrics.ts` derives system, per-agent and per-strategy
economics from `EconomicRevenue` / `EconomicExpense` rows, `CapitalAllocation`
rows and entity statuses. Nothing is cached and no agent's account of its own
performance is read, because no column holds one.

Where there is no basis, the value is `null`, never `0`: ROI with nothing
deployed, win rate with nothing settled, a strategy's `actualSuccess` with no
ledger activity. "No return yet" and "a return of zero" are different facts,
and collapsing them makes an untested system look break-even.

`SIMULATED` ledger rows are excluded everywhere, using the same provenance
filter as the spend ceiling. A dry run is recorded — better than being
indistinguishable from no run — but it is not money.

## 10b. Economic memory

The layers §11 of the brief asks to keep apart already exist separately in VOX,
and `src/lib/volara/learning.ts` is the ONLY bridge between the last two:

| Layer | Where it lives |
|---|---|
| Raw event | `Event` |
| Message | `AgentMessage` — never memory |
| Observation | `AgentStateTransition`, cycle payloads |
| Fact | `EconomicRevenue` / `EconomicExpense` |
| Result | derived metrics |
| Lesson | `Strategy.lessons` |
| Long-term memory | `Memory` |

`promoteStrategyOutcome()` promotes a strategy only when it has ENDED and the
ledger has something to say about it, and it lands as `INFERENCE` at `LOW`
confidence — one outcome in one context is not a fact about the world, and
CLAUDE.md rule 3 forbids pretending otherwise. Promotion is idempotent through
the event trail.

## 11. Autonomy modes

`Agent.autonomyMode` decides only whether an agent's cycle is *scheduled*, and
how far the propose stage goes:

- `MANUAL` — the cycle only runs when a human triggers it, and it proposes
  nothing that requires capital.
- `SUPERVISED` — runs on the heartbeat, proposes freely, requests capital.
- `AUTONOMOUS` / `AUTONOMOUS_APPROVAL_GATES` — identical to `SUPERVISED` for
  consequential work. **No mode removes an approval.** A mode that could would
  be a self-service authorization switch, which is exactly what §7 forbids.

## 12. API surface

| Route | What it does |
|---|---|
| `GET /api/volara/state` | The Global Observer snapshot. |
| `POST /api/volara/cycle` | Runs one cycle (`{agentId}`) or the society. |
| `POST /api/volara/capital` | An agent requests capital → returns the pending approval to act on. |
| `POST /api/volara/capital/[id]/reject` | The human "no". Creates no grant. |
| `POST /api/volara/agents/[id]/resume` | Human lifts a suspension. |

Approving an allocation uses the **existing** endpoint,
`POST /api/agents/[id]/steps/[stepId]/approve`. No second approval surface was
built, because a second one is a second thing to get wrong.

## 13. Invariants the test suite pins

- **V1** No `CapitalAllocation` reaches `APPROVED` without a consumed
  `ApprovalGrant` bound to its run's step.
- **V2** `reserved + spent ≤ ceiling`, under concurrency.
- **V3** A message can never change an allocation's status, mint a grant, or
  let a refused execution proceed.
- **V4** No path in `src/lib/volara/` grants a permission, mints a grant,
  raises the ceiling, clears the halt, or edits another agent's row.
- **V5** Every state change is recorded; an illegal transition is refused.
- **V6** A cycle is idempotent under concurrent invocation (lease CAS) and a
  duplicate capital request collapses on `idempotencyKey`.
- **V7** One agent's failure suspends only that agent.
- **V8** With the halt engaged, no allocation is approved and no cycle
  proposes capital.
