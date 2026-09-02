---
description: Review a Prisma migration for data-loss and backfill hazards — read-only, never applies
---

# Migration review

**This command reviews. It does not create, edit, or apply a migration.** If the
review finds a problem, report it and propose the corrected SQL for a human to
apply deliberately.

## Why this exists

The `economic_hardening_cents_and_tick_lifecycle` migration in this repository
added `amountCents Int @default(0)` to `EconomicRevenue` and `EconomicExpense`.
Prisma's generated SQL rebuilt each table and copied the old columns across —
**leaving `amountCents` at 0 for every historical row.**

Nothing would have failed. The migration applies cleanly, the schema validates,
every test passes on a fresh database. But `amountUsd` still looked correct while
every canonical calculation reading `amountCents` — the spend ceiling, P&L, the
policy position — silently reported zero for all pre-existing data. It was caught
by reading the generated SQL before applying it, and fixed by hand:

```sql
-- generated (wrong): amountCents omitted from the column list, defaults to 0
INSERT INTO "new_EconomicExpense" ("amountUsd", "assetId", ...) SELECT ...

-- corrected: backfilled in the same statement
INSERT INTO "new_EconomicExpense" ("amountUsd", "amountCents", "assetId", ...)
SELECT "amountUsd", CAST(ROUND("amountUsd" * 100) AS INTEGER), "assetId", ...
```

Note `ROUND` before `CAST`: SQLite's `CAST` truncates toward zero, so
`CAST(19.99 * 100 AS INTEGER)` is 1998, not 1999 — one cent lost per row, which
is precisely the class of error the cents migration existed to eliminate.

## Procedure

1. **Read the schema diff.** `git diff prisma/schema.prisma` — every added field,
   changed type, changed nullability, new enum member, dropped field.

2. **Read the generated SQL in full.** `prisma/migrations/<latest>/migration.sql`.
   Do not skim it. SQLite has no `ALTER COLUMN`, so Prisma rebuilds whole tables
   via create-new → `INSERT ... SELECT` → drop → rename, and the hazard is always
   in the column list of that `INSERT`.

3. **Check each item below.**

## Checklist

**New columns**
- Is the column in the `INSERT ... SELECT` column list at all? If it is absent it
  takes its `DEFAULT` for every existing row.
- Is that default correct *as data*, or merely syntactically valid? `0` is a
  valid default and a false ledger value.
- If it derives from another column, is the derivation in the SQL? Lazy
  backfilling at read time means one missed call site is invisible.

**Currency and integer conversions**
- `ROUND` before `CAST`, never `CAST` alone.
- Does the new representation agree with the old on every existing row? Verify
  after applying:
  ```
  SELECT COUNT(*) FROM "EconomicExpense" WHERE CAST(ROUND(amountUsd*100) AS INTEGER) <> amountCents;
  ```
  Expected: 0.

**Nullability**
- `NULL` → `NOT NULL` on a table with rows fails unless every row is backfilled
  first, or a default is supplied. Is it?
- `NOT NULL` → `NULL`: does downstream code distinguish "absent" from "zero"?
  In this codebase that distinction is load-bearing — `CapitalPosture.availableUsd`
  is `null` specifically because zero would read as a measured balance.

**Destructive operations**
- `DROP TABLE` on anything other than the `new_*` scratch table.
- `DROP COLUMN` — is the data reconstructable? `amountUsd` is deliberately still
  present as display-only during the cents migration; dropping it is step 3 of
  the plan documented in `src/lib/economic/money.ts`, not something to fold into
  an unrelated migration.
- Column renames Prisma has interpreted as drop + add, which loses the data.

**Foreign keys and indexes**
- `PRAGMA foreign_keys=OFF` during a rebuild is normal; confirm it is restored.
- Are indexes and unique constraints recreated after the rename? Losing
  `@@unique([userId, tickKey])` would silently remove the scheduler's idempotency
  guarantee.

**SQLite and the economic layer specifically**
- The atomic spend guard in `src/lib/economic/spend.ts` is a single
  `INSERT ... SELECT ... WHERE` whose correctness depends on SQLite's
  single-writer semantics and on summing `amountCents`. A migration that changes
  the shape or indexing of `EconomicExpense` may affect it — re-read that guard
  and run `/eco-check`.

## Report

State, for each finding: the file and line, what would happen if applied as-is,
and the corrected SQL. Then say plainly whether the migration is safe to apply.

If nothing is wrong, say that — a clean review is a real result. Do not invent
findings, and do not edit the migration.
