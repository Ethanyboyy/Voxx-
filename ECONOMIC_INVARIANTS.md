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

## What is still NOT true

Stated plainly, because the point of this document is that the numbers are
honest:

- **The engine is not autonomous.** It cannot transact. Every `SCALE` stops at a
  human.
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
