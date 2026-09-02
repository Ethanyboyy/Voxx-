---
description: Focused economic-engine verification — the 8 economic suites (~60s), NOT the full gate
---

# Economic engine check

A focused run of the suites that guard money. Measured at ~59s (182 tests)
against the full gate's ~172s + typecheck + lint + build, so there is a
legitimate faster loop when working in `src/lib/economic/`, and no reason to
reach for an ad-hoc subset.

```bash
npx vitest run \
  tests/economic-adversarial.test.ts \
  tests/economic-decide.test.ts \
  tests/economic-pnl.test.ts \
  tests/economic-scheduler.test.ts \
  tests/economic-time.test.ts \
  tests/economic-experiments.test.ts \
  tests/economic-engine.test.ts \
  tests/economic.test.ts
```

These are real files run through the project's real vitest config
(`vitest.config.mts`, which supplies `DATABASE_URL`, the mock providers and the
test encryption keys). Nothing here greps for strings or asserts on file
contents as a substitute for executing the code.

## What each suite defends

| Suite | Covers |
|---|---|
| `economic-adversarial` | I1–I8 attack cases: NaN/Infinity/zero/negative money, concurrent spend, ceiling boundaries, REALIZED injection, simulated contamination, halt + concurrency, stale ticks |
| `economic-decide` | The pure SCALE/HOLD/KILL function — hard-constraint precedence, max-loss short circuit, determinism |
| `economic-pnl` | Provenance separation, projection quarantine, window arithmetic, capital posture staying `null` |
| `economic-scheduler` | Tick lifecycle, lease reclaim, idempotency, the AWAITING_HUMAN boundary |
| `economic-time` | UTC day boundaries, DST in both directions, month/year/leap edges |
| `economic-experiments` | Contract completeness and coherence, `toDecisionContract` refusing to default a blank |
| `economic-engine` | End-to-end: capability + policy + atomic guard through the tool path |
| `economic` | The original engine suite |

Optionally also confirm ledger representation parity — that no row's
`amountUsd` and `amountCents` have drifted:

```bash
npx vitest run tests/economic-adversarial.test.ts -t "exact agreement"
```

## This is NOT the gate

Say so when reporting. This command verifies the economic engine; it does not
verify VOX. It runs 8 of 76 test files and does not typecheck, lint, or build.

Before committing, run `/gate`.

## If something fails

Diagnose the cause and distinguish the three possibilities, because they have
different fixes:

1. **A real defect** in the engine — fix the engine.
2. **A stale fixture** — e.g. a test writing ledger rows directly with
   `db.economicRevenue.create` instead of `seedLedgerEntry()` from
   `tests/helpers.ts`, leaving `amountCents` at 0. This has happened; the fix is
   the fixture, not the engine.
3. **A deliberate invariant** doing its job — the test is wrong, or the change
   is wrong.

**Never weaken an invariant to make a test pass.** The invariants and where each
is enforced are in `ECONOMIC_INVARIANTS.md`. Commit 114d826 is a protected
baseline: integer cents, the cumulative ceiling and its atomic guard,
concurrency, tick lifecycle, money validation, UTC handling, policy parity,
REALIZED protections, and AWAITING_HUMAN. If one of those genuinely looks wrong,
document the finding — do not redesign it silently.
