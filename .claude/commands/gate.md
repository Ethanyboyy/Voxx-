---
description: Run VOX's complete verification gate — typecheck, lint, FULL tests, build
---

# The verification gate

Run all four stages, in this order, and report the real result of each.

```bash
npm run typecheck   # next typegen && tsc --noEmit   (~27s)
npm run lint        # eslint flat config
npm test            # vitest run — FULL suite, 914+ tests, ~172s
npm run build       # next build (turbopack)
```

`npm test` is preceded automatically by `pretest`, which runs
`prisma migrate deploy` against `prisma/test.db`. If a dev server is holding
that file the migration will fail — stop the server first, and stop it by PID
rather than with a broad `pkill` pattern.

## The one rule

**A passing subset is never equivalent to the gate.**

Do not report the gate as passing on the strength of:

- one test file, or one directory of test files
- `--changed`, `-t`, or any filtered vitest invocation
- typecheck and lint alone, with tests "expected to pass"
- a previous run, if anything has been edited since

This is not a hypothetical. A commit in this repository was reported green
having run only the Brain subset, and had a failing test in the tree at the
time. If the full suite has not run to completion **since the last edit**, the
honest report is "not verified", not "passing".

## Reporting

State each stage as PASS or FAIL with its evidence — the test count for tests,
the error count for lint, the exit status for build. If a stage fails, report
the failure and diagnose it. Do not re-run a narrower command and report that
instead.

Lint currently emits 13 pre-existing warnings and 0 errors. Warnings do not fail
the gate; a single error does.

## Relationship to CI

`.github/workflows/verify.yml` runs exactly these four stages on every push to
`main` / `claude/**` and on every pull request, and `fly-deploy.yml` requires it
before deploying. Running this command locally is the fast feedback loop; CI is
the thing that actually enforces it.
