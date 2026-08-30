# Generation ledger

Every generation job against a paid engine is recorded here **before** it runs,
and its verdict recorded after. The point is credit discipline: a failed
generation gets diagnosed before another is spent, and near-identical failures
are never repeated.

## Running totals

| Engine | Jobs submitted | Credits spent | Accepted | Rejected |
| --- | --- | --- | --- | --- |
| Tripo | 0 | 0 | 0 | 0 |
| Meshy | 0 | 0 | 0 | 0 |

**No generation has been attempted. No credits have been spent.** Both engines
are blocked — see `AI_GENERATION_ARCHITECTURE.md` §1 for the evidence.

## Jobs

| # | Date | Engine | Type | Brief / input | Task ID | Credits | Verdict | Reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | — | — | — | *none — engines unreachable* | — | 0 | — | — |

## Recording rules

1. **Write the row before submitting.** A job that exists only in shell history
   is a job that gets accidentally repeated.
2. **Read the balance, don't estimate it.** Meshy exposes `meshy_check_balance`;
   record the real figure before and after.
3. **A rejection must carry a diagnosis**, not just "bad". "Hands fused, four
   digits merged into two masses" is actionable; "looked wrong" is not.
4. **Never re-run a near-identical brief after a rejection.** Change the concept,
   the input images, or the engine — otherwise the credits buy the same failure.
5. **Prefer concept-stage rejection.** A text-to-image concept costs a fraction
   of a 3D generation; reject at the cheapest possible stage.
