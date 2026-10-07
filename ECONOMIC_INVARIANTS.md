# Economic invariants

Properties the economic engine must hold **before** it is ever given the ability
to move real money. Each one names where it is enforced and the tests that try
to break it. If you change economic code and one of these tests fails, the test
is right.

The engine is **not autonomous**. It decides and it records; it cannot transact.
These invariants are about making the control layer trustworthy first.

---

## I1 — REALIZED cannot be created through an ordinary write API

`REALIZED` means *confirmed against an external system of record*. VOX has no
payment or banking integration, so nothing in VOX can confirm anything, and
nothing in VOX may claim it.

**Enforced by** three independent layers, because a type alone is not a guard:

| Layer | Mechanism |
|---|---|
| Type | `AddEconomicLedgerEntryInput.provenance: Exclude<LedgerProvenance, "REALIZED">` |
| Runtime | `assertNotRealized()` in `economic/service.ts` — throws even for a caller that casts past the type |
| API | `addEconomicLedgerEntrySchema` has no `provenance` field; zod strips the key |
| Autonomous path | `recordPolicySpend()` hardcodes `'USER_RECORDED'` in SQL and accepts no provenance argument |

A future payment provider writes `REALIZED` from inside its own module — a
separate, reviewable code path, not this one.

**`confirmOutreachPayment()` is NOT that module** (I25). It records that a human
went and looked at a processor, which is a human assertion however good the
evidence, so it writes `USER_RECORDED` with a mandatory transaction reference.
`REALIZED` is still written by nothing, anywhere.

**Tests:** `economic-adversarial.test.ts` → *attempted REALIZED injection (I1)*.

---

## I2 — SIMULATED never consumes real policy budget

A dry run moved no money, so it cannot consume a limit on moving money — and it
must not keep a losing experiment alive or close the gap to the daily floor.

**Enforced by** `POLICY_CONSUMING_PROVENANCES = ["REALIZED", "USER_RECORDED"]`
in `economic/accounting.ts`, used by the canonical position query, the atomic
spend guard's SQL, `measureExperiment()` in the scheduler, and
`realizedCostForObjective()` in the supervisor. Simulated totals are reported
**beside** the real ones (`simulatedCents`), never inside them.

**Tests:** *simulated ledger contamination (I2)*.

---

## I3 — The halt is authoritative at every service boundary

While halted: no new economic execution begins and no autonomous spend occurs.
Hiding the UI control would not achieve this, so the check is in service code at
four independent points:

- `evaluateSpendPolicy()` — denies, checked **before** the ceiling, so a halted
  engine refuses $0.01 as firmly as $10,000.
- `recordPolicySpend()` — the halt is a clause in the **same SQL statement** as
  the insert, so a halt engaged concurrently with a spend cannot land in a gap.
- `runEconomicTick()` — records a `HALTED` tick and evaluates nothing.
- `decide()` — cannot return `SCALE` while halted, at any net.

A halt never blocks a `KILL`: `decide()` checks maximum loss and the kill
threshold *above* the halt, because a halt exists to reduce exposure and
leaving a bleeding contract running would do the opposite.

**Tests:** *global halt (I3)*, including a halt combined with concurrent spends.

---

## I4 — The policy ceiling cannot be exceeded, sequentially or concurrently

**This was the most serious defect found.** `evaluateSpendPolicy()` compared a
*single amount* to the ceiling and never consulted cumulative spend, so a $100
ceiling permitted $60, then $60, then $60, without limit. It was not a race — it
was not a ceiling.

**Enforced by** a single atomic statement in `economic/spend.ts`:

```sql
INSERT INTO EconomicExpense (...)
SELECT <the new row>
WHERE <not halted>
  AND <existing policy spend + this amount <= ceiling>
```

The check and the write are **one statement**, so there is no window between
deciding and writing. The guard reads the **ledger**, not a cached counter, so
there is no second source of truth to drift. `evaluateSpendPolicy()` remains as
a pre-flight check that gives a good error early; it is explicitly *not* the
enforcement.

`ceilingToCents()` fails closed: a corrupt non-finite ceiling becomes 0.

**Tests:** *spend ceiling enforcement (I4)* — sequential walk-past, 2 concurrent
$60 spends against $100, 10 concurrent $20 spends against $100, exact-boundary
spending, zero ceiling, cross-user asset.

---

## I5 — A failed economic tick is never permanently lost

The tick used to be created `COMPLETED` **before** any work ran. A crash
mid-evaluation left a permanently "successful" tick with zero decisions that the
unique constraint made impossible to retry — lost forever, with the audit trail
claiming success.

**Enforced by** an explicit lifecycle: `IN_PROGRESS → COMPLETED | HALTED | FAILED`.

- A tick is **claimed** (created `IN_PROGRESS` with a lease) before work starts.
- It becomes `COMPLETED` only after the work finishes.
- A throw marks it `FAILED` with the error and clears the lease → immediately
  reclaimable.
- An expired lease (a crashed worker) is reclaimable via a compare-and-swap
  `updateMany` whose `WHERE` repeats the state it decided from.
- A **live** lease is left alone — no double processing.
- `MAX_TICK_ATTEMPTS` stops a deterministically-failing tick from spinning.

**Retry is safe** because per-experiment work is idempotent: an applied decision
moves the experiment to a terminal status, and the next pass only selects
`READY`/`RUNNING`. The lesson write happens **before** the experiment update and
is itself idempotent (keyed on `MemorySource.reference = experiment:<id>`), so a
crash between the two loses neither and duplicates neither.

**Tests:** *scheduler lifecycle (I5)* — success, crash halfway, retry completing
the lost work, no duplicate lesson, stale-claim recovery, live-claim respect,
attempt exhaustion, concurrent ticks, halted-tick terminality.

---

## I6 — P&L cannot be contaminated by invalid monetary values

Rejected at **both** the API boundary and the service boundary: `NaN`,
`Infinity`, `-Infinity`, zero, negative, sub-cent, and anything above
`MAX_ENTRY_USD` ($1B). The cap is checked *before* rounding, because
`Math.round(1e308 * 100)` is `Infinity`.

An `Infinity` in a ledger makes every later sum `Infinity` and every later
ceiling comparison `false` — silently bricking the engine while looking safe.

Canonical arithmetic is **integer cents** (`amountCents`), so a boundary
comparison is exact. The legacy `amountUsd` Float is display-only and kept in
step by one validated conversion; see the migration plan in `economic/money.ts`.

**Tests:** *money input hardening (I6)*.

---

## I7 — SCALE never becomes automatic execution

VOX has no payment, purchasing or deployment capability. A `SCALE` decision
therefore **cannot be executed**: the experiment moves to `AWAITING_HUMAN` and
an `economic_experiment.scale_blocked` Event records why. `KILL` is applied
automatically, because stopping requires no capability VOX lacks.

**Tests:** *SCALE cannot become automatic execution (I7)* — asserts the
experiment parks **and** that no expense row was created.

---

## I8 — There is exactly one definition of policy-consumed spend

Before this pass there were several, and they disagreed on the same screen:
`getBudgetSummary()` summed every provenance (so a dry run ate the real
ceiling), the P&L capital posture filtered provenance,
`realizedCostForObjective()` summed Floats across every provenance, and the
budget panel recomputed "remaining" client-side.

All four now read `getPolicySpendPosition()` in `economic/accounting.ts`.

**Tests:** *canonical accounting agreement (I8)*.

---

## I9 — An experiment is executed exactly once, and "the execution" is never ambiguous

`Experiment.executionRunId` is `@unique` and is claimed by a **compare-and-set**,
not by a check-then-write:

```ts
db.experiment.updateMany({ where: { id, userId, executionRunId: null }, data: { executionRunId: run.id } })
```

Two concurrent dispatches both read `null`; exactly one gets `count: 1`. The
loser **cancels the run it had already created**, so no orphan sits in the user's
run list looking like work VOX is doing.

This matters because a measurement is bound to *an* execution. If an experiment
could have two, a person choosing between two measurements would be choosing
their evidence after the fact.

`src/lib/economic/evidence.ts#requestExperimentExecution()`. It reaches a tool
**only** through the existing `executeRun()` — no second executor, no second
capability check, and no grant this module can mint. A source-level test asserts
the module contains no `grantPermission`, no `createApprovalGrant`, and no
reference to the tool registry.

**Tests:** *two concurrent dispatches produce exactly one execution*, *the losing
dispatch leaves no orphan run*, *the module cannot execute or authorize anything
itself*.

---

## I10 — A measurement is not evidence, and an unobserved execution can never become a result

Three separate statements, all enforced:

1. **Nothing downstream reads `ExperimentMeasurement`.** Not the probability, not
   the ranking, not the decision layer. A measurement is inert until a human acts
   on it.
2. **`reconcileExperimentOutcome()` is the only writer of `WIN`/`LOSS`**, it is
   reached only through an API route a person posts to, and it records a
   consequential `Event` naming what the verdict rested on.
3. **`MEASUREMENT_MISSING`.** If VOX dispatched an execution and no measurement
   came out of it, a verdict is **refused**. Otherwise an execution whose result
   nobody observed — the run died mid-step, the output was unreadable — could be
   written up as a success on the strength of somebody's recollection while
   carrying a real audit trail behind it.

An experiment VOX *never dispatched* still reconciles freely: a person judging
their own work from their own knowledge is ordinary, and it records
`HUMAN_EXTERNAL` so the basis is visible.

The probability itself counts **verdicts**, not enum values: the query predicate
is `outcomeRecordedAt: { not: null }`, so writing `outcome: "WIN"` straight onto
the row counts for nothing. With no decided trials it returns **`null`, never 0
and never 0.5** — a system with no trials has no success rate, and every number
that could be shown in its place is a claim nothing supports.

**Tests:** *refuses a verdict on an execution nobody observed*, *does not count an
outcome that no human recorded*, *is null, not zero, when nothing has been
decided*, *excludes INCONCLUSIVE from both numerator and denominator*.

---

## I11 — An absent observation is never a zero, and an altered one is detectable

**The third state.** An execution that produced no readable answer writes **no
measurement**. The refusal type has no value field at all, so there is no member
a `?? 0` could read. The reason is stored on `Experiment.lastObservationFailure`
as a **diagnostic nothing computes from**, purely so a surface can say
"observation unavailable" instead of rendering a silence that looks like a zero.

A genuine empty result set is different and is recorded as a real zero, with a
provenance that says no provider answered rather than blaming one. `OBSERVED
ZERO` and `NO ANSWER` do not collapse into each other.

**In doubt outranks the summary.** A step left `RUNNING` on a run that is no
longer running means the process died between "starting the tool" and "recording
what it returned". The tool may have run, or half-run. `observeExperimentExecution()`
refuses such an execution outright rather than resolving the unknown by
assumption in either direction — and it checks this *before* the run's own
status, because a run row can read `COMPLETED` while carrying such a step.

**Tamper-evidence.** `measurementDigest()` hashes the counts, the unit, the rule,
the provenance **and the execution identity** — repointing a measurement at a
different step is as much a change of evidence as editing its counts. The digest
is copied onto the experiment at reconciliation, so a row edited afterwards no
longer matches the verdict resting on it. `verifyEvidenceIntegrity()` **reports
and repairs nothing**: a verifier that "fixed" a mismatch by recomputing the
digest would be a tool for erasing the evidence that a measurement had been
altered.

**Tests:** *refuses a step whose end was never recorded*, *refuses output that is
not the shape the rule reads — and writes no zero*, *an empty result set is a real
zero with an honest provenance*, *detects a measurement edited in place*, *detects
a verdict whose evidence changed underneath it*, *reports rather than repairs*.

---

## I12 — There is no code path from a failed observation to a number

`ObservationOutcome` is a discriminated union whose **failure arm has no `value`
field** — not an optional one, not a nullable one, none at all. So

```ts
const orders = outcome.value ?? 0;   // does not compile on the failure arm
```

is a **type error**, not a code-review note. This is the single most important
line of P5-E, because the natural shape (`value: number | null` plus an error
string) makes `?? 0` the obvious defensive idiom — and what it actually does is
convert *"the store did not answer"* into *"the store said zero"*.

Three states, never collapsed:

| state | meaning | writes a measurement? |
|---|---|---|
| **OBSERVED ZERO** | the store was asked and said zero | **yes** — a real result |
| **UNAVAILABLE** | throttled, rejected, unreachable, imprecise | **no** |
| **NOT CONFIGURED** | there is no store; nobody was asked | **no** |

The hazard this is defending against is specific and documented in the provider:
**Shopify returns many errors as HTTP 200 with an `errors[]` body**, so
`response.ok` proves nothing. The `errors[]` check runs *before* the data is
read, an `AT_LEAST` count is refused because a lower bound is not a measurement,
and a null `data` is a refusal rather than a zero.

**Tests:** *refuses an errors[] body that arrived with HTTP 200*, *refuses an
AT_LEAST count*, *refuses a 200 whose data is null — not a zero*, *A REAL ZERO IS
A REAL MEASUREMENT*, *the failure arm of the outcome type carries no value field*.

---

## I13 — The question is frozen before the answer is visible

An external measurement has three degrees of freedom an internal one does not,
and **none of them requires falsifying anything**: ask a different store, move
the window until a good week is inside it, or count something else. The store's
answer is true every time. What makes the result dishonest is that the question
was chosen after the answer was visible.

So the defence is **ordering**, not validation. Rule, scope, window start and
window length are declared before dispatch and hashed into
`Experiment.observationContractDigest`. That digest is checked **twice**:

1. **Before the store is asked** (`externalObservation.ts`) — an altered
   contract means the request is never made at all.
2. **Before a measurement is written** (`evidence.ts`) — because the first check
   does not stop an edit made *after* the retrieval is already sitting in the
   step's output, which would leave a measurement reading as though it had
   always been about the new thing.

Window semantics are **inclusive start, exclusive end** (`>=` and `<`, never
`<=`) — with an inclusive upper bound two adjacent windows both claim the order
landing on the boundary, and two experiments report a combined total larger than
the store's own. A window that has **not closed** is refused (a partial period
reads as a disappointing result rather than an incomplete one), and one that
closed more than seven days ago is refused too (a store's record of a past
period moves as orders are cancelled and archived).

The connected store must also **be** the declared store, or the measurement
would carry one scope while holding another store's number.

**Tests:** *refuses to ask when the window was widened after dispatch*, *refuses
to ask when the store was repointed after dispatch*, *the contract is re-checked
before a measurement is written*, *refuses a window that has not closed*, *filters
with >= on the start and < on the end*, *refuses when the connected store is not
the declared store*.

---

## I14 — The integration is read-only, scoped to one tenant, and cannot be aimed

**Read-only by construction, not by intention.** The port declares exactly one
method and it is a count; `SHOPIFY` is the only catalog entry whose
`writeCapability` is **`null`** — not a write mode defaulting to off, no write
mode — so `grantAccess()` cannot grant what does not exist. The OAuth scope is
`read_orders` alone. A source-level test asserts no GraphQL mutation appears in
any template literal in the provider, and another fails the build if a second
method is added to the port.

**Cannot be aimed.** The tool's input schema is `{ experimentId }` and nothing
else. Store, window and rule all come from the experiment's own frozen contract,
so no caller — including a planner writing a step — can point the read at a
different shop or a better week.

**SSRF boundary.** The scope comes out of the database and is interpolated into a
URL with a real access token in the header, so it is validated against
`^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]\.myshopify\.com$` — whole-string, no scheme,
no port, no path, no userinfo. `169.254.169.254`, `acme.myshopify.com.evil.test`
and `acme.myshopify.com@evil.test` are all refused **before any request is made**.

**Tenant boundary.** `resolveConnectionCredential()` puts `userId` in the WHERE
clause rather than checking it afterwards, and it is the only way a provider ever
receives a token.

**Secrets.** The token travels in a header, never in a URL or body; it is stored
only encrypted; it appears in no event payload, no log line, no digest, and no
refusal message. The raw response is **never stored** — only a sha256 of it —
because an order payload carries customer names, addresses and emails, and
persisting it would put third-party personal data in VOX's database for no
measurement benefit.

**Connecting is real.** `connectShopifyStore()` validates the domain, calls the
real `grantPermission()`, sets CONNECTING, and then performs a **genuine
authenticated read against the actual store**. Only if that succeeds is the token
stored and the status set to CONNECTED. A token that does not work is never
persisted, so the Connections Hub cannot show a store VOX is unable to talk to.

**Tests:** *rejects every shape that would redirect the authenticated request*,
*makes no request at all for an invalid scope*, *stores nothing and reaches ERROR
when the store rejects the token*, *has no write capability at all*, *never writes
the token into an event payload*, *contains no GraphQL mutation*, *declares
exactly one method on the port*.

---

## I15 — A monetary total is exact, complete, denominated — or it does not exist

P5-F asks the same store, over the same frozen window, for a different column:
how much the orders came to. Money has failure modes a count does not, and each
one produces a number that looks entirely real.

**COMPLETENESS.** A count arrives as one integer. A total has to be *assembled*
by paging, and a page-walk that stops early yields a smaller total that is
indistinguishable from a correct one. So the sum is refused unless the number of
orders read **equals the store's own `ordersCount`** for the same filter — two
independent answers from the provider have to agree before either is believed —
and unless that count **did not move** between the first page and the last. A
repeated order id is refused too, since a replayed cursor would double-count
real orders into a larger, believable figure. There is no partial total: hitting
the page bound is a refusal, never a truncated answer.

**DENOMINATION.** `1250` is `$12.50`, `¥1,250` and `KWD 1.250`. So an amount is
stored as three columns — `observedAmountMinor`, `observedAmountScale`,
`observedCurrency` — written together, hashed together, and projected as
**null unless all three are present**. The scale is *read from the provider*,
never assumed to be 2: assuming cents reports a ¥5,000 sale as ¥500,000 (100×)
and a KWD 5.000 sale as KWD 500 (10×, the other way). A window whose orders span
two currencies is refused, because a sum across currencies is not an amount of
anything.

**EXACTNESS.** Amounts are parsed as text and summed as integers; the parser
rejects exponents, separators, whitespace, negatives and trailing points rather
than letting any of them become a plausible wrong number. Anything past four
decimal places is refused as an unrounded computed figure rather than money.

**STABILITY.** The field summed is `totalPriceSet` — the value **at order time**
— and not `currentTotalPriceSet`. Shopify defines every `current*` money field
as the value *"after returns, refunds, order edits, and cancellations"*, so it
**drifts**: a measurement built on it would silently stop matching its own digest
and could never be re-verified. The cost of that choice is stated rather than
hidden — a fully refunded order still counts at full value.

**AND IT IS STILL NOT REVENUE.** Gross order value at order time survives no
refund, cancellation, chargeback or recognition rule. Nothing is subtracted for
goods, fees, shipping, advertising or tax, so it is not profit. Orders inside a
window are not orders *caused by* the experiment, so it is not attribution and
not causation. The rule carries all four sentences to every surface that renders
the figure.

**Tests:** *REFUSES when fewer orders were read than the store itself counts*,
*refuses when the store's own count moves between pages*, *refuses when the same
order comes back twice*, *refuses a window holding two currencies*, *records a
non-USD currency as itself, with the right scale*, *projects a HALF-RECORDED
amount as no amount*, *binds amount, scale AND currency into the digest*, *asks
for the order-time total, not the drifting current total*, *A REAL ZERO-VALUE
WINDOW IS A REAL MEASUREMENT*.

---

## I16 — One external commercial action, triply authorized, at most once, and never a claim of revenue

P5-G gives VOX its first ability to CAUSE an economic event rather than observe
one: create a bounded, reversible discount code in a connected store. Nothing
else. There is no product, listing, price, order, refund, payment or charging
path anywhere in the system.

**THREE INDEPENDENT AUTHORIZATIONS, none sufficient alone.**

1. **A standing capability.** `integration.shopify.write` at **ACT** — above the
   default-granted band, a different capability string from the read, and
   `matchesApproval()` compares capability exactly, so the RECOMMEND-level read
   grant that P5-E/P5-F rely on can never satisfy it.
2. **A per-invocation `ApprovalGrant`,** bound to the exact arguments, single-use,
   expiring, and consumed by one conditional update. The tool's input is
   `{ actionId, contractDigest }` — **the digest is in the arguments on purpose**,
   because a grant that bound only an opaque id would leave the parameters free
   to move underneath it: a person approves 5% off and 50% off executes on their
   grant.
3. **The contract's own digest,** re-derived from the stored row at execution and
   compared to the approved one. Editing a parameter after approval therefore
   breaks two checks rather than none.

**AT MOST ONCE, INCLUDING ACROSS A CRASH.** `status: SUBMITTED` and `submittedAt`
are committed to the database **BEFORE** the network call, not after. That
ordering is the design: the window between the request leaving and the answer
arriving is exactly where a crash is most likely and exactly where the external
state may already exist, so a process that dies mid-flight leaves behind "may
have happened" — and every subsequent attempt is refused. `executionRunId` and
`executionStepId` are both `@unique`; a collision fails closed as a refusal
rather than throwing. The executor contributes the rest: a HOLD action gets
`maxAttempts = 0`, so there is no automatic retry at all.

**NO OUTCOME IS INFERRED FROM THE ABSENCE OF AN ERROR.** Success requires four
things at once — no transport failure, no top-level `errors[]`, an **empty
`userErrors`**, and a node carrying an id — and then a fifth: the echoed
parameters must **match the request**. A confirmation is not a match, and a
provider that created something different produces `ECHO_MISMATCH`, which is
neither success nor failure because external state exists in a shape nobody
authorized.

**UNKNOWN IS A FIRST-CLASS OUTCOME, RESOLVED ONLY BY ASKING.** A timeout, a 5xx,
an unreadable body and an echo mismatch are all `UNKNOWN`, never `FAILED` —
calling them failures is what licenses the retry that duplicates real external
state. The only thing that may resolve one is the store's own answer:
exists+matches → `SUCCEEDED`, absent → `FAILED`, **exists-but-mismatched → stays
`UNKNOWN`**, and a check that could not be made changes nothing at all.

**AND A SUCCESSFUL WRITE IS NOT REVENUE.** A created discount code writes no
measurement, no ledger row and no outcome; it leaves the experiment `PENDING`.
Redemptions are reported as a **count of uses** — never an amount, never a
currency, never revenue. Whether any order was caused by the code remains
unproven, and P5-G adds no causal methodology: it makes an intervention
*identifiable*, which is a precondition for attribution and not attribution
itself.

**Tests:** *NO GRANT: the run parks and the store is never called*, *READ ACCESS
IS NOT WRITE ACCESS*, *WRONG PARAMETERS / WRONG ACTION / WRONG EXECUTION IDENTITY
/ WRONG USER / EXPIRED / CONSUMED*, *SUBMITTED is committed to the database
BEFORE the network call*, *A CRASH MID-FLIGHT LEAVES SUBMITTED, AND IS NEVER
RETRIED*, *A TIMEOUT IS UNKNOWN, NOT A FAILURE*, *AN ECHO MISMATCH IS UNKNOWN*,
*A MISMATCHED DISCOUNT STAYS UNKNOWN*, *creates no measurement, no ledger row and
no economic result*, *the one external write is ACT and can never be ALLOW*.

---

## I17 — A forecast nobody grounded cannot be ranked, and a model's number cannot spend

P5-D through P5-G made MEASUREMENT honest and left FORECASTING alone. The
forecasting side had the same bug:

```ts
// src/lib/objectives/service.ts#scoreOpportunity
const value = o.estimatedValue ?? 1;
const riskPenalty = o.risk ? RISK_PENALTY[o.risk] : 0.15;
```

An opportunity nobody researched was scored as worth a dollar at moderate risk,
and the result was a plain `number` indistinguishable from one computed from
measured data. This is the `?? 0` hazard of I12 one layer up: there a failed
observation became a measured zero, here an absent estimate became a ranked
opportunity.

**AN UNKNOWN CARRIES NO VALUE.** `Estimate<T>` is a union whose unknown arm has
no `value` property, so `estimate.value ?? 0` is a type error. Every consumer is
forced to decide what to do about not knowing, and most correctly refuse.

**A DERIVED FIGURE TAKES ITS WORST INPUT'S BASIS.** `weakestBasis()` never
averages — averaging would let two measured inputs launder one invented one. An
expected profit combining a measured conversion rate with a model-suggested
price is a *model-suggested* figure.

**UNRANKABLE IS NOT LAST, IT IS SEPARATE.** `expectedValueOf()` returns a union
whose unrankable arm has no sortable field at all, and names the missing
dimensions. Sorting the unknown to the bottom would imply it is worse, when what
is true is that nobody knows — and some of it will outrank everything funded
once somebody looks.

**THE DOWNSIDE IS HALF THE EXPECTATION.** `E[net] = p × profit − (1−p) × maxLoss`,
in **cents**, not a dimensionless score — so it can be compared to capital,
subtracted for opportunity cost, and summed across a portfolio. Dropping the
second term is how a 2%-chance moonshot outranks a reliable small win.

**A MODEL'S NUMBERS CANNOT RESERVE MONEY.** `CAPITAL_MINIMUM_BASIS` is the rank
immediately above `MODEL_SUGGESTED`, and the portfolio routes anything weaker to
*corroborate* rather than *fund*.

> **Superseded in part by I19.** As written, P6-A made this guard live through
> `statedBasisFor()` — a heuristic over the single `Opportunity.source` column,
> named as one at the time, which made every figure on a row share one basis.
> **I19 replaced it with per-figure provenance**: each ev-material figure now
> clears the capital minimum on its own evidence, and the row-level basis is
> gone. Everything else in this invariant stands unchanged.

**N IS DERIVED, NEVER HARDCODED.** How many opportunities can be active comes
from four independent limits — capital less the governor's reserve, the
governor's concentration cap, a concurrency bound, and a non-negative
expectation — and whichever binds first binds. `portfolio.ts` imports
`RESERVE_FRACTION` and `CONCENTRATION_FRACTION` from `volara/governor.ts` rather
than redeclaring them, so there is exactly one of each.

**AND NONE OF IT ALLOCATES ANYTHING.** The decision layer imports no allocator,
no spend function and no executor; a test asserts that on the imports, because a
symbol that is never imported cannot be called. Committing capital remains
`requestCapital()` → a human's `ApprovalGrant` → `approveCapitalAllocation()`.

**Tests:** *AN UNKNOWN HAS NO VALUE FIELD AT ALL*, *a derived figure is only as
good as its worst input*, *REFUSES TO RANK AN UNRESEARCHED OPPORTUNITY*,
*SUBTRACTS THE DOWNSIDE*, *A MODEL'S NUMBERS NEVER RESERVE MONEY*, *AN UNKNOWN
CAPITAL REQUIREMENT IS NOT A ZERO ONE*, *N IS DERIVED, NOT HARDCODED*, *nothing
in the decision layer allocates, spends or executes*.

---

## I18 — A prediction is frozen, and scored only against the ledger

Nothing in VOX recorded a prediction before P6-A. `Opportunity.probabilityOfSuccess`
is a mutable column, so "what did VOX think would happen" was overwritten by
"what VOX thinks now" on every edit. **A system whose past beliefs are
unrecoverable cannot be shown to have been wrong, and therefore cannot improve —
it can only accumulate confidence.**

`ProfitPrediction` holds the two halves, and they must come from different
places:

| half | source | rule |
|---|---|---|
| the prediction | the expected-value engine | written **once**, digest-frozen, carrying the **weakest basis** of its inputs |
| the outcome | the **LEDGER** | `revenue − expenses` in cents, the same definition `decide()` uses |

A second prediction for the same experiment is **refused** — a forecast revisable
once the answer is in sight is not a forecast, and a calibration over revisable
predictions measures nothing. Revising means recording a new prediction against
a new experiment, leaving the first standing to be scored.

**A ZERO LEDGER IS A REAL OUTCOME** — that is how an optimistic prediction gets
caught. **NO LEDGER AT ALL IS NOT**: an experiment with no economic asset has
nothing to measure, writes no outcome, and records the reason. Same distinction
as OBSERVED ZERO versus UNAVAILABLE in I12.

`getCalibration()` returns `overallFactor: null` below `MIN_CALIBRATION_SAMPLE`,
because a correction factor from two data points would be applied to every
future forecast with the authority of statistics. Null, never 1.0 — a factor of
1 asserts "perfectly calibrated", which is the opposite of "unknown".

**Tests:** *REFUSES A SECOND PREDICTION FOR THE SAME EXPERIMENT*, *SCORES
AGAINST THE LEDGER, not against another estimate*, *A ZERO LEDGER IS A REAL
OUTCOME*, *NO LEDGER IS NOT A ZERO OUTCOME*, *WITHHOLDS A CALIBRATION FACTOR
BELOW THE MINIMUM SAMPLE*, *DETECTS SYSTEMATIC OPTIMISM once there is a sample*.

---

## I19 — Provenance is a property of the NUMBER, not of the row

P6-A derived every figure's basis from one column:

```ts
// src/lib/economic/opportunityModel.ts, P6-A
const stated = statedBasisFor(opportunity.source);   // then used for all 7 figures
```

`Opportunity.source` describes how the opportunity was **discovered**. It says
nothing about any individual figure on the row, and using it as a proxy for all
of them was wrong in both directions at once:

- **A person could not fix one figure.** Correcting a model's invented revenue
  changed nothing, because the row's discovery source had not changed.
- **Mixed provenance was unrepresentable.** "The probability is measured and the
  profit is a guess" could not be said at all — both read the same column.
- **A refusal could not be acted on.** "Its weakest monetary input is a model's
  proposal" never named the input, so the only responses were to re-derive the
  model by hand or to override the refusal.

**Provenance is now per figure.** `OpportunityEstimate` holds one row per
`(opportunityId, figure)` — unique-constrained, so a figure has one current
provenance rather than an accumulating pile of assertions — and each row answers
the six questions on its own:

| question | column |
|---|---|
| what is the value | `valueCents` / `valueRatio` / `valueDays`, **exactly one** set, chosen by the figure's kind |
| what is its basis | `basis` |
| where did the basis come from | `provenance` (required free text) |
| when was it established | `establishedAt` — **not** `createdAt`; a figure can be recorded today on last month's measurement |
| what evidence supports it | `experimentId` / `measurementId` / `researchItemId` / `comparableId`, **foreign keys** |
| may it influence capital | **derived on every read** by `canInfluenceCapital()`, never stored |

The closed figure registry is `src/lib/economic/figures.ts`. A figure that can be
invented at call time is a figure whose provenance rules nobody reviewed, so
adding one is a line in a diff — same posture as the observation registry (I11)
and the proposal registry.

**GLOBAL OPPORTUNITY PROVENANCE IS NO LONGER AUTHORITATIVE.** `monetaryBasis`
is gone from `OpportunityModelView`. `statedBasisFor()` is gone under that name:
what remains is `legacyColumnBasis()`, consulted **last**, only for a figure with
no recorded estimate, and **capped at `STATED`** — a value in a column carries no
evidence reference, so there is nothing to check, so it can never be `COMPARABLE`
or `MEASURED` however it got there. Every figure read that way reports
`authoritative: false` and `establishedAt: null`, and the replacement path
(`recordEstimate()`) is named at the definition. The old columns are still read,
because refusing them would make every pre-P6-B opportunity unfundable overnight.

### The ranking, and where the capital line sits on it

```
NONE  <  MODEL_SUGGESTED  <  STATED  <  COMPARABLE  <  MEASURED
                           ^
                           CAPITAL_MINIMUM_BASIS
```

`STATED` sits below `COMPARABLE` because both are beliefs and the ordering says
which is better anchored: a stated figure is anchored to somebody's memory, a
comparable to an outcome VOX **actually measured** on another opportunity. The
inference between cases is the weak joint; the thing extrapolated from is an
observation.

The capital line is drawn **immediately above `MODEL_SUGGESTED`** and that is the
whole specification. Fundable: `{STATED, COMPARABLE, MEASURED}`. Excluded:
`{NONE, MODEL_SUGGESTED}`. The constant's *value* moved from `COMPARABLE` to
`STATED` when the two ranks swapped; the membership of both sets did not change,
because the invariant was never "at least COMPARABLE" — it was always "better
than a model's unsupported proposal".

### Every material figure is checked on its own basis

`capitalBasisGate()` requires **every** ev-material figure to clear the bar
itself. There is no roll-up, no average, no governing basis. A measured
probability does not make an invented profit fundable: they are separate claims
about the world that happen to share a row. The blocking figures are **named**,
and the name reaches the portfolio deferral, the posture recommendation and the
UI — a refusal nobody can act on gets overridden.

One asymmetry, deliberate: a figure whose absence is handled by a conservative
default (`absenceIsConservative`, true for `TIME_TO_PAYOUT_DAYS` alone) does not
block by being **absent**, because `MAX_HORIZON_DAYS` makes the per-day rate
smaller and so cannot flatter the expectation. It still blocks when **present**
on a weak basis, because a model-suggested "7 days" where the truth is a year
inflates the rate 52×.

### UNKNOWN CAPITAL IS NOT ZERO CAPITAL

`portfolio.ts` used to read:

```ts
const want = required ?? 0;   // P6-A
```

An unknown bill read as a free opportunity. The gate now refuses an
unestablished capital requirement before that line, and the line itself is an
explicit refusal rather than a coalesce, so nothing downstream substitutes a
number for an absence. A **genuine zero** stays a real answer and stays fundable
— plenty of opportunities need time rather than money. Same distinction as
OBSERVED ZERO versus UNAVAILABLE in I12, one layer up.

### No provenance laundering

Only a reference to evidence that **exists** upgrades a figure. `MEASURED` must
name a measurement or experiment; `COMPARABLE` must name the opportunity it was
derived from; the service then checks the row exists **and belongs to this user**.
Without that check the strongest basis in the system would be the easiest one to
claim — you would write "measured from the store" in the provenance string.

None of the following upgrades anything, and none of them is an argument to any
function in `provenance.ts`:

| not evidence | why |
|---|---|
| a model's own confidence | a property of the claim, not of the evidence |
| repetition | the same figure proposed ten times is one unsupported figure; there is no counter to increment |
| ranking | coming first is a consequence of the number, not evidence for it |
| arithmetic | a derived figure takes its **weakest** input's basis; multiplication does not create knowledge |
| portfolio construction | being selected is downstream of the figure |
| elapsed time | an old estimate is an old estimate; nothing matures into a fact |
| a human approving a recommendation | consent to **do the thing**, not a statement about the number that motivated it |

`recordEstimate()` and `upgradeEstimate()` are deliberately separate.
`upgradeEstimate()` refuses anything that is not a rank increase, which is what
makes `economic.estimate.upgraded` in the event log mean that evidence genuinely
improved. Writing **downward** stays possible through `recordEstimate()`: a
measured conversion rate from a shop that has since changed its pricing is no
longer measured evidence about today, and provenance that could only strengthen
would leave the system unable to admit that what it knew is now stale.

### Recording provenance authorizes nothing

`provenance.ts` imports no `grantPermission`, no `createApprovalGrant`, no
`consumeApprovalGrant`, no `approveCapitalAllocation`, no `requestCapital`, no
`recordSpend` — a symbol that is never imported cannot be called. The dependency
direction runs one way: the permission check, the approval grant, the atomic
spend ceiling, the evidence loop and `decide()` import **nothing** from the
provenance layer, because a gate whose answer depended on a figure's basis would
be a gate that provenance could talk round, and provenance is recorded by
whoever is proposing the spend.

### Historical predictions are immutable

`ProfitPrediction.predictedBasis` records the basis **at prediction time** and is
never rewritten. If improving a figure's provenance rewrote it, the
`MODEL_SUGGESTED` calibration bucket would quietly empty itself as figures were
corroborated, and VOX would appear to have been better calibrated than it was.
Better evidence is a new current estimate, not a retroactive edit — I18 unchanged.

**Tests:** `tests/p6-b-figure-provenance.test.ts` — *A MEASURED PROBABILITY DOES
NOT MAKE AN INVENTED PROFIT MEASURED*, *holds for EVERY figure in turn, by
enumeration*, *A SINGLE WEAK FIGURE BLOCKS CAPITAL EVEN WHEN SIX ARE MEASURED*,
*AN UNKNOWN CAPITAL REQUIREMENT IS NOT A ZERO ONE*, *A GENUINE ZERO IS STILL A
REAL ANSWER*, *A MODEL_SUGGESTED CAPITAL REQUIREMENT CANNOT AUTHORIZE SPENDING*,
*ONLY THE HORIZON MAY BE ABSENT WITHOUT BLOCKING*, *CAN NEVER CLAIM THE TWO
STRONGEST BASES*, *A RECORDED ESTIMATE OVERRIDES THE COLUMN HEURISTIC IN BOTH
DIRECTIONS*, *A MALFORMED ESTIMATE ROW READS AS UNKNOWN*, *REFUSES A MEASURED
CLAIM THAT NAMES NO MEASUREMENT*, *REFUSES AN INVENTED EVIDENCE IDENTIFIER*,
*REFUSES ANOTHER USER'S EVIDENCE*, *REPETITION / ARITHMETIC / RANKING AND
SELECTION / TIME DOES NOT UPGRADE ANYTHING*, *IMPORTS NO PERMISSION, GRANT OR
ALLOCATION SYMBOL*, *IS DOWNSTREAM OF EVERY GATE, NEVER UPSTREAM*, *NO EXTERNAL
ACTION FOLLOWS FROM A FLATTERING MODEL-SUGGESTED EXPECTATION*, *A HISTORICAL
PREDICTION STAYS FROZEN WHEN PROVENANCE LATER CHANGES*.

---

## I20 — Discovery proposes; it cannot promote what it proposed

P6-C is the first thing in VOX that generates economic figures from nothing,
which makes it the first real test of I19's boundary. The attack is not subtle
and it is very easy to commit by accident:

```ts
await db.opportunity.create({ data: {
  title, description,
  expectedProfitCents: 50_000,     // "just for compatibility"
  probabilityOfSuccess: 0.3,
}});
```

Those two columns route through `legacyColumnBasis()`. A row with no `source`
reads as `STATED`, and `STATED` **is** the capital minimum — so a model's
invention would clear `capitalBasisGate()` without the provenance layer ever
being touched. Four structural guards exist for that one line.

### 1. A proposal has no field in which to claim a basis

`ProposedFigure` in `discovery/contract.ts` carries `figure`, `value` and the
model's `reasoning`. There is **no** `basis`, no evidence reference and no
confidence — not an optional one, no property at all. So the persister has
nothing to read a basis FROM: it writes `MODEL_SUGGESTED` as a literal, because
that is the only value in scope. Same move as the P5-E refusal that carries no
value and the I19 unknown arm that carries no value — **the way to stop a
dangerous assignment is to delete the field it would be assigned to.**

That handles our code and does nothing about the model, which will return
`"basis": "MEASURED"` if it decides that is what a good answer looks like. So
`CLAIM_KEYS` is checked **before** parsing and a proposal carrying any of them is
REJECTED with that reason recorded. A permissive parse would drop the key
silently, which is nearly as bad as honouring it: the pass would look like it
worked while the model's actual claim went unrecorded.

### 2. The forbidden columns are derived from the registry

`LEGACY_ECONOMIC_COLUMNS` is built from `FIGURE_SPECS` — every `legacyColumn`
plus every `legacyFallbackColumn` — so a figure added to the registry cannot be
forgotten. `assertNoLegacyEconomicColumns()` runs on the real `Opportunity`
create input before it reaches the database.

`legacyFallbackColumn` exists because of this invariant.
`TIME_TO_PAYOUT_DAYS` resolves from `timeToPayoutDays ?? estimatedTimeToRevenueDays`,
and a forbidden list built from `legacyColumn` alone would have left the second
column open — a hole exactly one write wide.

### 3. The discovery source is asserted against the single definition

`isHumanSource()` is exported from `opportunityModel.ts` and `DISCOVERY_SOURCE`
is checked against it **at module load**, so a rename that made discovery look
human fails the application's start rather than quietly promoting every
legacy-read figure on every discovered row. A copied list is a list that drifts,
and this drift would be silent.

### 4. A citation is a claim even when the basis does not need one

`recordEstimate()` now verifies **every** supplied evidence reference, not only
the one the basis requires. Two reasons, the second being the point: a bogus id
used to reach the foreign key and come back as an unhandled constraint error
rather than a refusal; and a pass attaching `researchItemId: "r-whatever"` to a
model-suggested figure **is asserting that a research result supports it**. That
assertion is displayed and a later corroboration step would read it, so an
invented id is refused even at a basis that requires nothing.

A real `ResearchItem` still cannot satisfy a `MEASURED` claim. **Source
observation is not economic evidence about a figure** — a blog post saying 40%
margins are typical is a thing somebody wrote, not a thing VOX measured.

### What a discovered opportunity can and cannot do

| it can | it cannot |
|---|---|
| exist, with a thesis and a rationale | carry a figure above `MODEL_SUGGESTED` |
| have every figure recorded and audited | write an `Opportunity` economic column |
| be ranked by expected net per day | pass `capitalBasisGate()` |
| name its own uncertainty | reserve capital or enter a commercial action |
| route to `CORROBORATE_OPPORTUNITY` with the blocking figures named | upgrade itself |

The ranking matters and is not a consolation: a model-suggested candidate with a
large expectation is worth looking at first, and that is the entire economic
value discovery adds. What it does not add is authority.

### Repetition and consensus are not corroboration

`proposalDigest()` is taken over the **title and figure values only, not the
prose**. Two passes that reword the same thesis around the same numbers are the
same proposal, and the second is rejected as `DUPLICATE_OF_EXISTING`. Without
that, five passes proposing the same idea would produce five opportunities with
five sets of `MODEL_SUGGESTED` estimates, which reads as five independent
candidates agreeing — and **model consensus is not evidence**. There is no
column for model confidence anywhere in the discovery schema, so there is
nothing for a future gate to be tempted by.

### Discovery grants nothing

`discovery/` imports no `grantPermission`, no `createApprovalGrant`, no
`requestCapital`, no `recordSpend`, no `approveCapitalAllocation` — and not
`capitalBasisGate` either, because a layer that could call the gate is a layer
that could be rewritten to interpret it. The gate is reached only through
`listOpportunityModels()`, read-only.

`economic.discover` at `RECOMMEND` is above `DEFAULT_GRANTED_LEVEL`, so
discovery is **off** until somebody grants it. `discovery.scan` is classified
`WRITE` / `PARTIALLY_REVERSIBLE` / `untrustedOutput: true`, which the gate
evaluates to **HOLD** — an agent run reaching discovery needs a human's approval
first, exactly like `research.run`.

There is no `corroborate()` function in the discovery layer. Upgrading a figure
goes through `upgradeEstimate()`, which refuses anything that is not a rank
increase. A convenience wrapper would be a second door onto the same lock, and
the second door is where the bolt gets left off.

### And it refuses rather than inventing

A provider that cannot return structured proposals produces
`PROVIDER_NOT_STRUCTURED` and zero candidates. **That is the state of this
repository**: the mock provider runs here and in any deployment without a key,
so `runDiscovery()` currently records a refusal every time. The run row says
which refusal, and the surface renders the reason — because "found nothing" and
"could not look" are identical as an empty list and completely different facts.

**Tests:** `tests/p6-c-discovery.test.ts` — *A PROPOSED FIGURE HAS NO BASIS FIELD
TO SET*, *REJECTS EVERY CLAIM KEY, AT EITHER LEVEL, BY ENUMERATION*, *THE
FORBIDDEN COLUMN LIST COVERS EVERY COLUMN THE COMPATIBILITY PATH READS*, *THROWS
ON ANY ATTEMPT TO WRITE AN ECONOMIC COLUMN*, *THE DISCOVERY SOURCE IS NOT A
HUMAN SOURCE*, *NOTHING ON THE ECONOMIC PATH READS THE RAW MODEL PROPOSAL*,
*RECORDS EVERY FIGURE AT MODEL_SUGGESTED, ONE AT A TIME*, *WRITES NO ECONOMIC
COLUMN ON THE OPPORTUNITY*, *REFUSES RATHER THAN INVENTING WHEN THE PROVIDER
CANNOT ANSWER*, *A FAVOURABLE EXPECTED VALUE IS NOT PROOF OF ANYTHING*,
*CORROBORATE_OPPORTUNITY NAMES THE FIGURES, not the confidence*, *REPEATED
DISCOVERY DOES NOT ACCUMULATE OR UPGRADE*, *MODEL AGREEMENT IS NOT EVIDENCE*,
*CANNOT CITE A RESEARCH RESULT THAT DOES NOT EXIST, AT ANY BASIS*, *A RESEARCH
RESULT IS NOT A MEASUREMENT*, *A PERSON CAN CORROBORATE ONE FIGURE, AND ONLY
THAT ONE MOVES*, *CORROBORATING EVERY MATERIAL FIGURE IS WHAT MAKES IT
FUNDABLE*, *NEVER DESCRIBES AN UNCHECKED FIGURE AS CHECKED*.

---

## I21 — A measurement is observed; a prediction is frozen before it

P6-A through P6-C built the capacity to REFUSE and nothing had ever been
measured. `getCalibration()` had reported NO BASIS since the day it was
written, because no prediction had ever been scored against a real ledger. P6-D
is the join:

```
corroborated -> experiment -> PREDICTION -> observed outcome
             -> MEASURED figure -> ledger -> reconciliation -> 1 calibration point
```

Every link already existed. `measurementLoop.ts` composes them and declares no
new gate, no second lifecycle and no new provenance vocabulary.

### The ordering is the whole invariant

**A measurement cannot be recorded for an experiment that has no frozen
prediction.** That single refusal makes the ordering STRUCTURAL rather than
conventional: the prediction row had to exist before the measurement call could
succeed, and `ProfitPrediction.experimentId` is UNIQUE so there is exactly one
and it cannot be swapped afterwards. An explicit
`prediction.createdAt < measurement` comparison is made as well, and a
backdated `occurredAt` that would violate it is **refused, not clamped**.

Without this the exercise is theatre. A system that can write the prediction
after seeing the result will always look well calibrated, and "VOX predicted
$8.00 and the ledger says $9.00" is the only sentence in this repository that
makes a forecast worth anything.

### What makes a figure MEASURED

An `ExperimentMeasurement` row, and only that. `upgradeEstimate()` demands it
and checks it exists and belongs to the user (I19), so `MEASURED` is reachable
from this module only by way of evidence a person or a provider actually
produced. **Model reasoning is not an argument to any function in the loop** —
there is nowhere to put it, and `OperatorOutcomeInput` has no `basis`,
`confidence`, `reasoning`, `externalProvider` or `responseDigest` field. The
route's schema is `.strict()`, so a request carrying one is rejected rather than
trimmed: an operator entry cannot be dressed up as a store's own answer.

**ONE FIGURE IS PROMOTED, NOT THE ROW.** The operator observes an amount, so
`EXPECTED_REVENUE_CENTS` becomes MEASURED and nothing else moves. A measured
revenue says nothing about the probability, the worst case or the capital
requirement, and I19 exists so that cannot be fudged. The promotion is also
CONSERVATIVE where the measured window is shorter than the figure's horizon:
the value becomes what arrived in the window, which can only be less than or
equal to the full horizon's total.

### Human-entered is not external-observed

| | source | ledger provenance | VOX observed it |
|---|---|---|---|
| operator entry | `HUMAN_ENTERED` | `USER_RECORDED` | **no** |
| P5-E/F observation | `EXTERNAL_OBSERVED` | `USER_RECORDED` | yes |
| model reasoning | — | — | never sufficient |

Every external field on a human-entered measurement stays **null**: no
provider, no scope, no response digest, no retrieval time, no window. The
amount goes inside the measurement's existing digest (the P5-F tagged money
block), so a hand-entered figure is as frozen as a machine-observed one.
`REALIZED` stays unreachable (I1) — nothing here confirms anything against an
external system of record, and the operator's own stated limitations are
returned with the result rather than filed away.

### Zero settles to nothing, and that is correct

`toCents()` refuses zero because a zero entry is not a transaction. So an
experiment that observed **zero** revenue writes **no ledger row**, the ledger
sums to zero, and `reconcilePrediction()` reads exactly that. OBSERVED ZERO and
NO LEDGER stay distinct, one layer further out than I12 drew the same line: the
asset exists and the sum is genuinely zero, whereas an experiment with no asset
is refused `NO_LEDGER` and writes nothing at all.

An observed zero is the single most useful measurement there is, because it is
how an optimistic forecast gets caught. It is reported as a result, never as a
failed measurement.

### Currency is a gate, not a default

The ledger is USD at scale 2. A measurement in another currency or at another
scale is **refused** (`CURRENCY_NOT_SETTLEABLE`), never converted: converting
needs an exchange rate, VOX has none, and inventing one would fabricate the
most load-bearing number in the chain. Even USD at the wrong scale is refused —
1250 at scale 3 is $1.25, not $12.50.

### One observation is not a track record

`getCalibration()` reports `totalResolved: 1` and `insufficientSample: true`
with `overallFactor: null`. The correction factor is **withheld**, not computed
weakly, because a factor derived from one result would be applied to every
future forecast with the authority of statistics. Buckets stay separate by
basis, so "a person's figures were 12% out" and "a model's were 100% out" are
never averaged into one meaningless number. The caveat is returned in the
operator's own result, in words.

And an **unscored** prediction is not an observation: `totalUnresolved` counts
it and no basis bucket claims it. That assertion exists because mutation M12
(reading an unresolved prediction as `observedNetCents ?? 0`) passed every other
test in the suite — the shape of "increment calibration without reconciling",
and a forecast counted as a hit before anyone looked.

### The loop moves no money

It creates no `CapitalAllocation`, no `ApprovalGrant`, no `CommercialAction` and
no `Permission`, and imports no allocator, grant, executor or AI provider. The
ledger rows it writes carry `measurementId` — a FOREIGN KEY, and UNIQUE, so a
settled row cannot cite a measurement that does not exist and one measurement
cannot settle twice on either side.

Duplicate protection is three independent layers: the loop's own check,
`recordExternalMeasurement()`'s check, and
`ExperimentMeasurement.experimentId @unique`. Removing both application checks
changes nothing observable — the database refuses with the same reason. That was
verified by mutation rather than assumed.

**Tests:** `tests/p6-d-measurement-loop.test.ts` — *CLOSES: corroborated ->
prediction -> operator outcome -> MEASURED -> reconciled -> one calibration
point*, *promotes ONLY the observed figure*, *REFUSES A MEASUREMENT FOR AN
EXPERIMENT NOBODY PREDICTED*, *PROVES prediction.createdAt < measurement time*,
*REFUSES A BACKDATED MEASUREMENT*, *THE MEASUREMENT CANNOT CREATE OR EDIT THE
PREDICTION*, *IMPROVING A FIGURE LATER DOES NOT REWRITE THE PREDICTION*, *A
MODEL_SUGGESTED FIGURE CANNOT BECOME MEASURED WITHOUT A MEASUREMENT*, *CANNOT
CITE ANOTHER USER'S MEASUREMENT*, *THE OPERATOR PATH TAKES NO FIELD A MODEL
COULD FILL*, *CREATES NO ALLOCATION, GRANT OR COMMERCIAL ACTION*, *NEVER WRITES
REALIZED PROVENANCE*, *A DUPLICATE MEASUREMENT*, *A DUPLICATE RECONCILIATION*,
*A CURRENCY OR SCALE THE LEDGER CANNOT HOLD*, *RECORDS A ZERO OUTCOME, WRITES NO
LEDGER ROW, AND RECONCILES*, *AN OBSERVED ZERO AND AN ABSENT FIGURE STAY
DISTINCT*, *AN UNSCORED PREDICTION IS NOT AN OBSERVATION*, *ONE RECONCILIATION
IS ONE OBSERVATION, AND NOT A TRACK RECORD*, *DOES NOT AVERAGE ACROSS BASES*,
*MARKS THE SOURCE AS HUMAN AND INVENTS NO EXTERNAL PROVENANCE*.

---

## I22 — A decision is only as accepted as the ledger under it

P6-D closed the loop to a measured, reconciled, ledger-backed result and nothing
consumed it. Three facts about the repository before I22:

- `deriveEvidenceStage()` terminates at `RECONCILED`, and `nextAction.ts` read
  `AWAITING_OBSERVATION` and `MEASUREMENT_RECORDED` and **not that** — so a
  reconciled experiment fell through to "fund something new" at the one point in
  the chain where VOX had the most evidence it will ever have about a live
  contract.
- `EconomicActionKind` **declared** `DECIDE_EXPERIMENT` and `PosturePanel`
  labelled it, and nothing in the codebase could produce it.
- `decide()` was reachable only from `runEconomicTick()`. A person looking at a
  finished experiment could not ask the question the apparatus exists to answer.

So VOX could measure and could not learn. `experimentDecision.ts` is the join,
and it is **read-only**.

### Why read-only, and why that is not a shortcut

`applyDecision()` in `scheduler.ts` already writes decision state, and writes it
carefully: the lesson is recorded BEFORE a KILL is marked terminal, so a crash
between the two loses neither; a KILL is auto-applied because stopping needs no
capability VOX lacks; a SCALE is parked at `AWAITING_HUMAN` because I7 holds.
The tick is its one caller.

A second writer would make "when did VOX last decide, and has the kill been
applied" ambiguous on `Experiment.lastDecisionAt` — the column an operator reads
to find out. `decide()` is **pure**, so the decision is derivable on demand from
the contract and the ledger; there is nothing to persist that is not already
recoverable. Deriving it is strictly safer than storing it twice.

### The new invariant: an unaccepted ledger is not accepted evidence

`decide()` is arithmetic over the ledger. It will return SCALE on a ledger
nobody has looked at, and it is right to — the tick has no human to ask and is
bounded by its own gates. But a RECOMMENDATION TO A PERSON has to say whether a
person has accepted the measurement underneath it:

| class | means | recommended? |
|---|---|---|
| `ACCEPTED` | `outcomeRecordedAt` set — a human recorded a verdict | **yes** |
| `PROVISIONAL` | a measurement exists, nobody accepted it | no — routed to reconcile |
| `NO_MEASUREMENT` | nothing observed this experiment at all | no |

The classification reads `outcomeRecordedAt`, never the `outcome` enum — P5-D's
own distinction between "a human decided this" and "the enum happens to hold a
value" (I10), one layer further down the chain.

A `HOLD` is skipped rather than recommended: it is a real decision and
recommending "hold" as the next best action would displace work worth doing.

### One ledger definition, not two

`measureExperiment()` is now **exported** from `scheduler.ts` and called by both
the tick and the decision surface. A second copy of that query is a second
answer to "is this experiment losing money", and the two would diverge on the
first change to `POLICY_CONSUMING_PROVENANCES` — which is exactly the number a
maximum-loss constraint is compared against. A test asserts the module contains
no ledger aggregate of its own.

### The posture could not see the operator path at all

`experimentStages()` filtered on `executionRunId: { not: null }` — only
experiments VOX had DISPATCHED. That was right when every measurement came from
an execution, and P6-D's operator path produces experiments with **no execution**
(a person observed the world and typed what they saw). Those were invisible, so
the posture could not recommend reconciling one either. `deriveEvidenceStage()`
had always handled the undispatched case explicitly; nothing was passing it one.
The filter is widened to include a measurement or a recorded outcome.

### The learning link across opportunities

`getMeasuredProbability()` already lifts an opportunity's OWN probability to
MEASURED once a verdict is recorded, so learning WITHIN one opportunity has
worked since P6-A. Across them it never did: a reconciled experiment on
opportunity A was invisible to opportunity B, so the second experiment anybody
ran was no better informed than the first.

`comparableCandidates()` surfaces where a comparison is **available** and
applies nothing. Both halves must be real: a target figure actually on
`MODEL_SUGGESTED`, and a source figure actually `MEASURED` and backed by an
experiment a human **reconciled**. An unjudged measurement is not citable, for
the same reason a PROVISIONAL decision is not recommended.

**AUTO-APPLYING THESE WOULD BE THE LAUNDERING I19 FORBIDS.** Whether two
opportunities are comparable is a judgement about the world — a print-on-demand
test and a consulting retainer share a figure name and nothing else — and
applying one automatically would promote an invented number because two rows
happened to sit in the same table. The upgrade stays `upgradeEstimate()`, which
demands the comparable id and verifies it.

The candidate scan covers EVERY figure, not only the ev-material ones. Scanning
`EV_MATERIAL_FIGURES` excluded `EXPECTED_REVENUE_CENTS` — `materialToExpectedValue:
false`, because revenue matters only as an input to the derived profit — and that
is the ONLY figure the P6-D loop ever promotes to MEASURED. The one comparison
the measurement loop can produce was the one comparison the function could never
offer.

**Tests:** `tests/p6-e-decision-loop.test.ts` — *ANSWERS SCALE, HOLD OR KILL ON
DEMAND*, *READS THE SAME LEDGER DEFINITION THE AUTONOMOUS TICK DOES*, *KILLS A
LOSER*, *REPORTS AN EMPTY LEDGER AS A REAL ZERO, NOT A GAP*, *CLASSIFIES A
MEASUREMENT NOBODY ACCEPTED AS PROVISIONAL*, *CLASSIFIES A DECISION WITH NO
MEASUREMENT AT ALL*, *WAS A DECLARED ACTION KIND WITH NO PRODUCER, AND NOW HAS
ONE*, *DOES NOT RECOMMEND A DECISION ON A PROVISIONAL MEASUREMENT*, *SKIPS A HOLD
RATHER THAN RECOMMENDING ONE*, *ASKING FOR A DECISION CHANGES NO STATE*, *A SCALE
REMAINS A RECOMMENDATION*, *OFFERS A COMPARABLE ONLY WHERE BOTH HALVES ARE REAL*,
*APPLIES NOTHING — THE CANDIDATE IS NOT AN UPGRADE*, *OFFERS NOTHING FROM AN
UNRECONCILED MEASUREMENT EVEN WHEN ANOTHER IS RECONCILED*, *A HUMAN CAN ACT ON A
CANDIDATE THROUGH THE EXISTING PATH*.

---

## I23 — A window measures the intervention, not the store

Most of this chain existed before I23, and saying which part did not is the
point. P5-G gave `CommercialAction` an `experimentId` (UNIQUE, so one
intervention per experiment), froze it by `contractDigest`, put execution behind
`integration.shopify.write` at ACT with a policy HOLD and therefore an
argument-bound `ApprovalGrant`, bound `executionRunId`/`executionStepId`
uniquely, and returned applied / refused / **unknown** with only the applied arm
carrying an `externalId`.

**The `externalId` went nowhere.** The observation contract named a store, a
window and a rule — no subject — so a declared window meant "every order this
store took in this period". That is a measurement OF THE STORE: an experiment
could be credited with a week of ordinary trading it had nothing to do with, and
the discount code it created was decoration.

### The subject's identity and its existence are different facts

The binding has an ordering problem. A frozen contract must be declared BEFORE
the experiment runs — `declareObservationContract()` refuses once an execution
identity exists, because choosing the question with the answer in view is what
the freeze prevents — but an `externalId` only exists AFTER the intervention has
run. It resolves by separating two things:

| | what it is | when | in the digest? |
|---|---|---|---|
| `observationSubject` | the discount code — **what is being asked about** | chosen at declare time, already frozen in the action's own `contractDigest` | **yes** |
| `observationSubjectExternalId` | the provider's id — **did the thing get made** | after execution, via `bindObservationSubject()` | no |

So the question stays frozen and the confirmation arrives late, which is the
correct shape. The subject is appended to the contract digest **tagged and only
when present**, the P5-F money-block pattern, so every contract frozen before
I23 hashes exactly as it did and `verifyEvidenceIntegrity()` does not report
historical experiments as altered.

**A WINDOW MAY ONLY NAME A CODE ITS OWN INTERVENTION CREATES.**
`declareObservationContract()` compares the subject against the experiment's own
declared `CommercialAction` and refuses `SUBJECT_MISMATCH` otherwise — including
when there is no intervention at all. Without that check attribution is a
free-text filter, and a window could claim another experiment's orders.

### This is what keeps an UNKNOWN write unknown

`openDeclaredWindow()` refuses a subject-naming window until the subject's
existence is confirmed. An ambiguous execution returns no `externalId`, so
nothing can be bound, so **the store is never asked**, so no measurement exists
to be mistaken for a result. The ambiguity stays ambiguous instead of resolving
itself into a zero — and `bindObservationSubject()` says so in the refusal
rather than silently declining:

> The intervention's outcome is UNKNOWN — it may or may not have been created.
> Confirming a subject from an unknown outcome would invent exactly the certainty
> the write port refuses to supply.

PLANNED, SUBMITTED and FAILED are refused by the same rule. Binding is
idempotent **by refusal, not by overwrite**: a second call is `ALREADY_BOUND`
even when it would write the identical value, because the external identity of
what was measured is established once, and a function that rewrites it can be
made to point a past measurement at a different subject. The write is a
conditional `updateMany` on the null column — the compare-and-set shape P5-G
uses for its execution claim, not a check-then-write.

### Attribution does not weaken the completeness proof

The provider still reads the WHOLE declared window and still checks it against
the store's own `ordersCount`. `orderCount` keeps its exact meaning — every
order in the window — and `attributedOrderCount` is new beside it. The attributed
subset is only trustworthy BECAUSE the full read is proven complete; summing a
filtered query instead would produce a smaller total with nothing to check it
against.

Attribution uses `Order.discountCodes: [String!]!`, verified against the live
Admin GraphQL schema rather than assumed, and matches case-insensitively
because Shopify's codes are case-insensitive at checkout — comparing exactly
would under-attribute, and a short sum looks exactly like a real one. **A
malformed `discountCodes` is a REFUSAL**, never "this order carried no code",
for the same reason.

**AN UNREDEEMED CODE IS AN OBSERVED ZERO.** The code existed, the window was
read completely, nobody used it. `sumDecimals([])` is an exact zero at scale 0 —
asserting no decimal scale it never observed — and that is the single most
useful result an intervention experiment can produce, so it is reported as a
result rather than as a refusal. OBSERVED ZERO and UNAVAILABLE stay distinct
(I12), one layer further along.

### And none of it is a second path

`intervention.ts` imports no `executeCommercialAction`, no
`declareCommercialAction`, no grant function, no `enforceCapability`, no
`executeRun`, and performs no `fetch`. It reads an action that has ALREADY
succeeded through the existing gated path and copies one identifier onto the
experiment that action already names. Declaring stays
`POST /api/commerce/actions`, executing stays the `commerce.create_discount_code`
tool through the executor, and asking the store whether the code exists stays
`POST /api/commerce/actions/[id]/observe`. The confirm endpoint takes **no body**,
so there is nowhere for a caller to supply an external id of their own choosing.

**Attribution over a declared window is not causation.** Orders carrying a code
are redemptions. Whether the code caused the purchase is a counterfactual VOX
cannot observe, and nothing in this chain claims otherwise.

**Tests:** `tests/p6-f-experiment-intervention.test.ts` — *DECLARES AN
INTERVENTION BOUND TO THE EXPERIMENT*, *REFUSES A SECOND INTERVENTION FOR THE
SAME EXPERIMENT*, *REFUSES A WINDOW ATTRIBUTING TO A CODE THIS EXPERIMENT DID
NOT CREATE*, *A SUBJECTLESS WINDOW STILL WORKS, AND ITS DIGEST IS UNCHANGED*,
*AN UNAPPROVED INTERVENTION DOES NOT EXECUTE AND CALLS NOTHING*, *A GRANT FOR
DIFFERENT PARAMETERS DOES NOT AUTHORIZE THIS ONE*, *THE INTERVENTION MODULE
OPENS NO SECOND EXECUTION OR AUTHORIZATION PATH*, *EXECUTES ONCE AND CARRIES THE
FULL EXECUTION IDENTITY*, *BINDS THE EXTERNAL ID AS THE WINDOW'S CONFIRMED
SUBJECT*, *THE OBSERVATION ATTRIBUTES ONLY TO THE INTERVENTION'S OWN CODE*, *AN
UNREDEEMED CODE IS AN OBSERVED ZERO, NOT A FAILURE*, *AN UNREADABLE DISCOUNT
LIST IS A REFUSAL*, *AN UNKNOWN WRITE CANNOT BE BOUND AS A SUBJECT*, *AND THE
WINDOW CANNOT BE OBSERVED, SO NO MEASUREMENT IS FABRICATED*, *BINDS ONCE*,
*REPLAYING THE EXECUTION CREATES NO SECOND COMMERCIAL EFFECT*, *REPOINTING THE
SUBJECT AFTER THE FREEZE BREAKS THE CONTRACT*.

## I24 — The live path is reachable, and reachability is not authority

P6-G's objective was to conduct VOX's first real commercial experiment. It did
not happen, and the reason is recorded here rather than worked around:

> **There is no live Shopify access in this environment by any route.** No
> Shopify environment variable is set (`env | grep -ci shopify` → 0), no
> `ConnectionCredential` row exists, and the only supported door —
> `connectShopifyStore()` — requires a custom-app Admin API token pasted in by a
> person. Autonomous credential acquisition is forbidden and was not attempted.
> Separately, the session's own Shopify tooling returns `operation_not_allowed`
> ("This shop is unavailable for API access"), so even that route is closed.
>
> `liveReadiness()` reports **`CREDENTIAL_MISSING`**. **No live Shopify write
> and no live Shopify observation has occurred.** There is no experiment id, no
> code identifier, no observation window, no order count and no observed order
> value, because none of those things exist.

So P6-G is plumbing: it made the path **reachable**, documented it in
`LIVE_EXPERIMENT_RUNBOOK.md`, and stopped before the external call.

### Two steps of the live path had no door at all

This is the part worth recording, because it was invisible from the tests:

| step | before P6-G | why that is a safety problem, not a convenience one |
|---|---|---|
| declaring the frozen observation window | `declareObservationContract()` existed since P5-E, took a subject since P6-F, and **its only callers were test files** | a window could be frozen in a spec and nowhere else — an operator conducting a real experiment could not declare the question through the application |
| dispatching the intervention | the only HTTP route into the executor is `POST /api/agents`, which hands an objective to a **PLANNER** | reaching the one write tool in VOX meant hoping a model chose `commerce.create_discount_code` and composed the right `actionId` and the right 64-hex `contractDigest`. The arguments to a real-store write should be derived from the frozen row, not written by a language model |

The P6-F tests build their run by hand, which is precisely why they could run
and the application could not. `POST .../contract` and
`POST /api/commerce/actions/{id}/dispatch` close those two gaps and nothing else.

### And neither one adds any authority

`dispatchIntervention()` is the same shape as P5-D's
`requestExperimentExecution()`: build one run with one step bound to one tool,
hand it to the EXISTING `executeRun()`, report where it stopped. It does not
call `executeCommercialAction()`, `enforceCapability()`, `grantPermission()`,
`createApprovalGrant()`, `evaluatePolicy()` or `approveAgentStep()`, and it
performs no `fetch`. The preflight imports no mutator either. Both are asserted
by source scan over comment-stripped code.

**A DISPATCH THAT PARKS IS A SUCCESSFUL DISPATCH.** `WAITING_FOR_PERMISSION`
with the action still `PLANNED` is the normal first response and it means nothing
was sent. Reporting it as an error is how an operator learns to retry past the
gate — the same reasoning P5-D applies to its own dispatch. The step is a policy
HOLD at `integration.shopify.write` / ACT and the grant is minted only at
`POST /api/agents/{runId}/steps/{stepId}/approve`, the one HTTP surface in VOX
where a person's decision becomes an `ApprovalGrant`. There is no threshold below
which approval is skipped, and P6-G introduced no bypass of any kind.

The dispatch route takes **no body**, so there is nowhere for a caller to name an
action's arguments; the confirm route takes no body for the same reason. The
test that exercises the whole sequence mints its grant against the step the
dispatch actually parked, with the arguments the dispatch actually built — so a
dispatch that composed the wrong arguments fails at `matchesApproval()` rather
than being papered over.

### The preflight answers one question and leaks nothing

`liveReadiness()` is **read-only, local, and makes no external call** — a
diagnostic that phoned Shopify to prove the token still works would itself be
the live request it is meant to be checking the preconditions for. Liveness was
proven once, at connect time, and is not re-proven. `CREDENTIAL_INVALID`
therefore means "a credential exists and cannot be used", **never** "Shopify
rejected it".

Its six stages are strictly ordered and it reports the **earliest** unmet one,
because five simultaneous complaints read as five problems when there is one next
step. It returns the shop domain, which is public and which an operator needs in
order to see WHICH store is about to be written to — and nothing else about the
credential: not the token, not a prefix, not a length, not a hash. Before the
credential resolves it returns `shopDomain: null` rather than a guess, because
the domain lives inside the encrypted payload.

`AUTHORIZATION_REQUIRED` — one bounded action prepared, waiting for a person —
**is the expected resting state of a correctly-gated system, and it is reported
as success rather than as a blocker.**

### The operator ordering is a real trap, so it is a test

`grantAccess()` is the Connections Hub path, and the Hub's registered SHOPIFY
provider is the stub, so it **always** finishes by setting the connection row to
`ERROR`. Granting write access *after* connecting therefore puts a store that
verified against the live API into `ERROR`, and the preflight correctly reports
`CREDENTIAL_MISSING`. Grant first, connect second. `connectShopifyStore()` also
resets the Hub's `writeEnabled` flag to false, and that flag is not what
authorizes the write — the ACT capability and the credential's `grantedScope`
are. Both facts are asserted so neither can quietly stop being true.

### What is still unexercised, unchanged by P6-G

The write scope is **declared by the operator, not proven**: VOX cannot prove a
write scope without performing a write. The three write outcomes still do not
collapse — APPLIED, REFUSED and **UNKNOWN**, with only APPLIED carrying an
`externalId`, and an UNKNOWN is never retried and never resolved into a zero.
An unredeemed code is still an OBSERVED ZERO and still a result. And attribution
over a declared window is still not causation (I23).

**Tests:** `tests/p6-g-live-readiness.test.ts` — the six states in operator
order; *NEVER RETURNS THE TOKEN, IN ANY STATE*; *MAKES NO EXTERNAL CALL*;
*WRITES NOTHING AND AUTHORIZES NOTHING*; *imports no executor, grant minter or
provider*; *the grant's MATCH is still decided at execution, not here*; *PARKS
WITHOUT A GRANT AND SENDS NOTHING*; *THE STEP'S ARGUMENTS COME FROM THE FROZEN
ROW, NOT FROM THE CALLER*; *refuses a second dispatch of the same action*;
*REFUSES TO DISPATCH AN ACTION WHOSE OUTCOME IS UNKNOWN*; *the dispatch module
opens no second authorization path*; *GRANT ACCESS FIRST, THEN CONNECT — the
other order breaks the connection*; *the documented order reaches
LIVE_CONNECTED*.

## I25 — A human who verified a payment is still a human, not a system of record

The revenue sprint (`REVENUE_SPRINT.md`) needed one thing the economic engine did
not have: a way to record that **a specific named person was asked to buy
something, and what they said.** `Opportunity` is a category, `Experiment` is a
test, `EconomicRevenue` is money — none of them is a pipeline. `OutreachAttempt`
is, and it brought exactly one new question with it.

### The temptation, and why it was refused

`confirmOutreachPayment()` is the "record revenue only when payment is verified"
path. The owner goes to Stripe, sees $450, copies the charge id, and records it.
Everything about that is genuine, and `LedgerProvenance` has a member that means
"confirmed" — so writing `REALIZED` would have felt like the accurate choice.

**It is written `USER_RECORDED`.** `REALIZED` means *VOX confirmed it against an
external system of record*, and VOX did not: a person did, and then typed the
result in. That is the enum's own definition of `USER_RECORDED` — "true as far as
VOX knows, unverified by anything" — and it describes this situation exactly.
Promoting it would be the same provenance laundering the P6-B figure layer
refuses: a human assertion upgraded to an external measurement because the human
sounded certain. I1 already said where `REALIZED` comes from when it comes at
all — a payment provider reading the charge itself, from inside its own module —
and this is not that module. **I1 is unchanged and `REALIZED` remains unreachable
from every API in the system.**

What makes the row worth having anyway is that the evidence is **mandatory**:
`processor` and `reference` are both required, with no default and no optional
path, so the claim is checkable by somebody other than the person who made it.
An unreferenced "they paid, trust me" is refused `EVIDENCE_INCOMPLETE` and writes
nothing. The write goes through the existing `addEconomicRevenue()` rather than
touching the ledger, so there is no second way in and the amount passes the same
`normalizeAmount()` validation as every other row.

### `AGREED` is not money, and `PAID` is not a status

The gap between "they said yes" and "the money arrived" is where optimistic
pipelines report revenue they do not have, so the two are different enum members
and only one has a ledger row behind it.

**`PAID` cannot be set as a status at all.** `recordOutreachResponse()` refuses
it (`PAID_NEEDS_CONFIRMATION`) and the HTTP schema omits it from the enum
entirely, so a caller cannot mark revenue without a processor and a reference
even by accident. Money has one door and that door demands evidence.

`NO_RESPONSE` is the default and is **not a failure state** — it is the most
common outcome of real outreach, it is tracked separately from `DECLINED`
because silence is not a no, and `respondedAt` stays null while it holds.
`verifiedRevenueCents` is **null, not zero**, until something is paid: same
reasoning as the Observer's `UNRECORDED`, one layer out. A sprint dashboard
showing `$0.00` on day one reads as a result rather than an absence.

### One payment, one ledger row — and the claim has to test what it sets

Confirmation is idempotent by refusal (`ALREADY_PAID`), and concurrent
confirmations are excluded by a compare-and-set.

**The first implementation of that guard was wrong, and the bug is worth
recording because it is subtle and the test caught it.** The conditional update
tested `revenueId: null` — but `revenueId` is only attachable *after* the ledger
row exists, so two concurrent callers both saw null, both passed the claim, and
both banked $450. Compare-and-set only excludes a second writer when the
condition is the column the winner *changes*. It now tests and sets `paidAt`, in
one statement, and the concurrency test fails against the old version.

### The module cannot contact anybody

`src/lib/revenue/outreach.ts` has no send path: no SMTP, no provider client, no
template renderer, no scheduler, and it imports nothing that reaches the network
— asserted by source scan. `recordOutreach()` records that a human **already
sent** something. The ordering is the whole point: a module that could send would
put a model's judgement about who deserves a cold pitch between a stranger and
their inbox, at whatever volume the model chose. There is also deliberately no
bulk-import endpoint, because an endpoint that accepted a thousand prospects is
the first half of a spammer.

### The sprint ranker is a second ranker, not a replacement

`scoreOpportunity()` already weighs every criterion a revenue sprint cares about,
and `src/lib/revenue/sprintRank.ts` reuses its columns rather than inventing a
parallel set. It exists for one reason: that function computes
`speedMultiplier = 30 / max(7, days)`, **clamped at seven**, so a one-day and a
seven-day opportunity score identically — and inside a three-day window that is
the only distinction that matters. A test asserts the general scorer genuinely
cannot tell those two apart.

`scoreOpportunity()` was left alone. Re-tuning a shared formula to answer one
time-boxed question would silently re-rank every opportunity in the system and
change what the Brain's "Why?" panel explains. The two rankers are expected to
disagree; the `/api/revenue/rank` response returns **both**, because showing one
would hide which question was asked. The ranker is a pure function over a row —
no database, no clock, no model, no network, asserted by source scan — because a
ranker that could reach any of those could rank on something it made up. An
unknown margin is assumed to be **0.5, not 1.0**: a service business keeping
every dollar it bills is the optimistic case, and defaulting to the optimistic
case is how a ranking starts flattering itself.

**A rank is not a forecast and a forecast is not a sale.** Every input is an
estimate somebody typed or a model suggested; the sprint candidates in
`prisma/seedRevenueSprint.ts` are `MODEL_SUGGESTED` throughout and no confidence
level implies more than a 65% chance of payment, because `CONFIRMED` on an
opportunity means the *opportunity* is corroborated, not that the person messaged
on Tuesday will pay by Friday.

### What is still not true

**No revenue exists.** `EconomicRevenue` holds zero rows, no prospect has been
contacted, and nothing in the sprint has been validated against a customer. The
72-hour probability stated in `REVENUE_SPRINT.md` is judgement, not measurement,
and it rests on one unverified assumption — that the owner's warm list exists.

**Tests:** `tests/revenue-sprint.test.ts` — *SEPARATES ONE DAY FROM SEVEN, WHERE
THE GENERAL SCORER CANNOT*; *AN UNKNOWN MARGIN IS NOT ASSUMED TO BE 100%*; *the
ranker reads rows and cannot write one*; *THE MODULE HAS NO SEND PATH*; *PAID
CANNOT BE SET AS A STATUS*; *REFUSES A PAYMENT WITH NO PROCESSOR OR NO
REFERENCE*; *A VERIFIED PAYMENT IS USER_RECORDED, NEVER REALIZED*; *BANKS ONE
PAYMENT ONCE*; *concurrent confirmations bank one row, not two*; *DECLINED AND
NO_RESPONSE STAY DIFFERENT FACTS*; *NO MONEY YET IS NULL, NOT ZERO*; *an AGREED
prospect is not revenue*; *refuses to book revenue against another user's asset*.

---

## What is still NOT true

Stated plainly, because the point of this document is that the numbers are
honest:

- **The engine is not autonomous.** It cannot transact. Every `SCALE` stops at a
  human — I22 makes the scale/kill decision *askable* on demand and changes
  nothing about who may act on it.
- **The intervention path is complete and has never been run against a real
  store.** I23 closed the architectural gap: an experiment declares one bounded
  discount code, a human's `ApprovalGrant` authorizes it, the executor creates
  it, its `externalId` becomes the window's confirmed subject, and the
  observation attributes only to orders carrying that code. Every test drives it
  through a stubbed `fetch`. **No live Shopify credentials exist in this
  repository**, so the path is architecturally complete and empirically
  unexercised — the same honest state P5-G and P5-E were left in, now joined
  end to end.
- **One action type, deliberately.** A percentage discount code is the only
  commercial intervention VOX can declare. It charges nobody, transfers nothing
  and is reversible. There is still no payment, banking, card, transfer, refund
  or purchasing integration anywhere in VOX.
- **VOX can now measure an amount, and an amount is not revenue.** `EXTERNAL_ORDER_VALUE`
  retrieves gross order value at order time, from the merchant's own store, over
  a window declared in advance. That is a real monetary fact about the world. It
  is **not revenue** (it survives no refund or cancellation), **not profit**
  (nothing is subtracted), **not attribution** (orders in a window are not orders
  the experiment caused), and **not causation**. VOX still cannot truthfully say
  it earned anything.
- **No money has moved, and nothing here can move any.** VOX can now create one
  bounded discount code, which charges nobody and transfers nothing. There is
  still no payment, banking, card, transfer, refund or purchasing integration
  anywhere in VOX, and the policy gate's money-moving cell (external + financial
  + irreversible) is still empty — `tests/policy-gate.test.ts` fails the build if
  that changes.
- **The loop closes, and it has never closed on live external evidence.** P6-D
  can carry an opportunity from corroborated to a scored prediction, and the
  tests do it end to end. Every one of those measurements is **operator-entered
  test data**: no live store credentials exist here, so VOX has never observed a
  figure in an external system of record and no `ExperimentMeasurement` in this
  repository has `source: EXTERNAL_OBSERVED` from a real provider call.
- **Calibration has no basis and will not have one soon.** `MIN_CALIBRATION_SAMPLE`
  is 5 and a correction factor is withheld below it, so even a handful of closed
  loops leaves every expected-value figure unadjusted. The machinery for
  learning exists, is exercised, and has learned nothing yet — which is the
  honest state of a system with one data point, not a defect.
- **VOX can propose opportunities, and has never actually proposed one.** P6-C
  built the discovery layer and it is architecturally complete: a pass creates
  `Opportunity` rows with every figure recorded at `MODEL_SUGGESTED` through the
  provenance layer, writes no economic column, and cannot reserve capital. It
  has produced **zero candidates in this repository**, because the mock provider
  cannot return structured proposals and `runDiscovery()` refuses with
  `PROVIDER_NOT_STRUCTURED` rather than inventing any. Every accepted-candidate
  test drives hand-written proposals through the same `recordCandidates()` the
  model path uses, so the persistence and safety behaviour is exercised and the
  **generation** is not.
- **Discovery does not run on its own schedule.** There is no cron, no agent
  loop and no trigger that starts a pass. A person starts one, or a supervised
  agent run does — and that run's `discovery.scan` step is a HOLD, so it waits
  for a human's approval. Nothing in VOX decides on its own to go looking.
- **Causation is still unproven, and P5-G does not change that.** A discount code
  is an intervention that can be identified, which is a precondition for
  attribution rather than attribution itself. Orders carrying the code are
  redemptions, not proof the code caused the purchase — the counterfactual
  (would that customer have bought anyway?) is exactly what VOX has no way to
  observe. Claiming causation would need an explicit causal methodology, and
  none exists here.
- **No live Shopify write has ever been performed in this repository.** The
  mutation is real and verified against the live schema; every test drives it
  through a stubbed `fetch`. The write path is architecturally complete and
  **empirically unexercised**, and the write SCOPE is declared by the operator
  rather than proven — because proving it would require creating an unrequested
  discount. P6-G made that path **reachable** through the application and
  documented it in `LIVE_EXPERIMENT_RUNBOOK.md`; reachable is not exercised, and
  `liveReadiness()` reports `CREDENTIAL_MISSING`.
- **No live Shopify observation has ever been performed in this repository.** The
  provider is real and the code path is real, but every test drives it through a
  stubbed `fetch`. No live store credentials exist here, so the integration is
  architecturally complete and **empirically unexercised** — it has never been
  run against a real merchant's store.
- **Per-figure provenance records what a number rests on; it does not check
  whether the number is right.** A `STATED` figure is a figure somebody stood
  behind, not a verified one, and the compatibility path still lets the old
  `Opportunity` columns reach the capital minimum at `STATED` without any
  evidence reference — that is a deliberate migration concession, flagged
  `authoritative: false` on every figure it produces, and it is the weakest link
  in the chain today.
- **No figure in this repository has ever been upgraded to `MEASURED` from live
  external evidence.** The `MEASURED` path requires a real `ExperimentMeasurement`
  row and the tests supply one through P5-D's own human-entered path. No live
  store credentials exist here, so nothing has been measured against a real
  external system of record.
- **A measured probability over one or two verdicts is not a success rate.**
  `ProbabilityEvidence` is returned whole — wins, losses, decided, and the basis
  each verdict rested on — precisely so a caller cannot render "1 of 1" as
  "100%".
- **`REALIZED` profit is $0 and will stay $0** until an external system of
  record exists to confirm anything. The revenue-sprint payment path does not
  change this: a human who checked Stripe writes `USER_RECORDED` (I25).
- **No revenue of any provenance exists yet.** `EconomicRevenue` holds zero
  rows. The 72-hour sprint in `REVENUE_SPRINT.md` has a ranked plan, sendable
  assets and a pipeline to record results in — and no customer, no outreach sent
  and no dollar. Its stated probability of a first sale is judgement, not
  measurement.
- **Available capital is `null`**, not zero — VOX has no account balance to read
  and does not synthesize one.
- **The spend ceiling is a policy limit, not money.** It bounds what VOX may
  spend on its own initiative; it does not assert the money exists.
- **`amountUsd` is still a Float column.** It is display-only and no canonical
  calculation reads it, but it is not gone yet — step 3 of the migration plan in
  `economic/money.ts`.
- **Direct user CRUD does not enforce the ceiling.** A human recording an
  expense they already made in the world is recording history; refusing it would
  make the ledger wrong without preventing the spend. The ceiling governs what
  VOX spends on its own initiative, which is the `recordPolicySpend()` path.
- **Atomicity rests on SQLite's single-writer semantics.** The guard is one
  statement, so it is correct under concurrent connections on this engine. A
  future move to a database with different isolation would need this re-verified
  — the guard's shape would carry over, but the reasoning must be redone.
