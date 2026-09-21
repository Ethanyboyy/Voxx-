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

## What is still NOT true

Stated plainly, because the point of this document is that the numbers are
honest:

- **The engine is not autonomous.** It cannot transact. Every `SCALE` stops at a
  human.
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
  discount.
- **No live Shopify observation has ever been performed in this repository.** The
  provider is real and the code path is real, but every test drives it through a
  stubbed `fetch`. No live store credentials exist here, so the integration is
  architecturally complete and **empirically unexercised** — it has never been
  run against a real merchant's store.
- **A measured probability over one or two verdicts is not a success rate.**
  `ProbabilityEvidence` is returned whole — wins, losses, decided, and the basis
  each verdict rested on — precisely so a caller cannot render "1 of 1" as
  "100%".
- **`REALIZED` profit is $0 and will stay $0** until an external system of
  record exists to confirm anything.
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
