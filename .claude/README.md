# VOX engineering environment (Claude Code)

Committed configuration. A fresh clone reproduces VOX's engineering conventions
without anyone re-deriving them from `CLAUDE.md` each session.

`settings.json` holds no comments (JSON), so the reasoning lives here.

## What is committed, and what is not

| Path | Committed | Why |
|---|---|---|
| `settings.json` | yes | Permissions + hook wiring — project policy |
| `hooks/` | yes | The scripts those hooks run |
| `commands/` | yes | `/gate`, `/eco-check`, `/migration-review` |
| `agents/` | yes | Three read-only specialists |
| `README.md` | yes | This file |
| `skills/` | **no** | Vendor payload, megabytes, reinstallable. Only `skills/README.md` is committed |
| `settings.local.json`, `*.local.json`, `.credentials.json` | **no** | Personal overrides and anything a tool may cache |

## Permissions

Three tiers, deliberately not one:

- **allow** — read-only inspection and the verification gate itself
  (`git status/diff/log`, `npm run typecheck|lint|build`, `npm test`,
  `npx prisma validate`, `Read`/`Glob`/`Grep`). These are run constantly and
  cannot damage anything, so prompting on them trains people to click through
  prompts, which is how a real prompt gets approved by reflex.
- **ask** — writes and state changes: `git push`, `git commit`, `npm install`,
  any `prisma migrate`, `rm`, `mv`, `kill`. Available, but a decision.
- **deny** — reading or editing `.env*`, and reading `prisma/*.db`. Secrets and
  raw ledger bytes should never enter a transcript. `.env.example` is not
  matched and stays readable.

There is deliberately **no blanket `Bash(*)`**.

## Hooks

**`PreToolUse` → `hooks/guard-destructive-bash.sh`** (Bash only)

Blocks the destructive command that gets typed *in passing*, and explains how to
proceed deliberately. It is not a security boundary — an agent with Bash can
defeat pattern matching — it is an accident guard. Every pattern maps to a real
hazard here; the process-kill one already happened:

- `rm` on `prisma/{dev,test,qa}.db` — gitignored, no other copy
- `rm` on `prisma/migrations` — committed history, not reconstructable
- `prisma migrate reset` / `--force-reset` / `--accept-data-loss`
- recursive delete of a tree **root** (`src`, `tests`, `prisma`, `.github`,
  `.claude`, `public`) — paths *inside* those trees are not blocked, because a
  guard that fires on routine cleanup gets ignored
- broad `pkill`/`killall` — `pkill -f next` has already killed the agent's own
  shell here, since the pattern matched the shell's own command line.
  `pkill -x <exact>` and `kill <pid>` are allowed
- `git push --force` without `--force-with-lease`; `reset --hard`; `clean -fd`;
  `branch -D`
- writing `.env` or `flyctl secrets` — per `DEPLOYMENT.md` these are set once by
  hand; a previous CI change overwrote the live `VOX_ENCRYPTION_KEY` and
  `VOX_SESSION_SECRET` with empty strings and broke auth and decryption
- direct `flyctl deploy` / destroy — deployment goes through CI, which now
  requires the gate

It **fails open**: if it cannot parse its input it exits 0. A guard that blocks
all work when it breaks gets deleted, and then nothing is guarded.

**Known limitation, hit twice while building this.** The guard matches the
command *string*, so a command that merely MENTIONS a dangerous pattern — a
`grep` filter, a test harness, an echo — is refused even though it does nothing
dangerous. That is the fail-safe direction and is left as-is rather than papered
over with quoting heuristics that would create real bypasses. The workaround is
to put such a script in a file and run the file:

```bash
# refused: the pattern is on the command line
grep -E 'flyctl secrets' something.log
# fine: the command line is just a path
bash /tmp/scan.sh
```

`bash .claude/hooks/test-guard.sh` exercises the guard this way — 30 cases, 17
that must block and 13 that must be allowed. Run it after editing any pattern;
the "must allow" half is what stops the guard drifting into blocking real work.

**`PostToolUse` → `hooks/economic-baseline-notice.sh`** (Edit/Write)

Prints a reminder when `src/lib/economic/**` is touched: the protected baseline
(commit `114d826`), and that `/eco-check` exists. Pure path matching, no
subprocess.

### Why there is no typecheck-on-edit hook

Measured in this repository:

```
npm run typecheck   26.5s
npx tsc --noEmit     8.3s
```

8.3s after **every** Edit adds minutes to any multi-file change, and a
mid-refactor typecheck reports errors that only mean "the other file isn't
updated yet". That trains everyone to ignore hook output, which is worse than no
hook. Typechecking belongs in CI, where it runs once against a complete tree —
see `.github/workflows/verify.yml`.

## Commands

| Command | Runtime | Purpose |
|---|---|---|
| `/gate` | ~5 min | Full gate: typecheck, lint, **full** suite, build. States that a passing subset is never the gate |
| `/eco-check` | ~59s | The 8 economic suites (182 tests). Explicitly **not** the gate |
| `/migration-review` | — | Read-only Prisma migration review. Never applies anything |

## Agents

All three are **read-only by default** and run in their own context window, so a
large sweep does not consume the main thread.

- **`economic-invariant-auditor`** — audits `src/lib/economic/**` against
  `ECONOMIC_INVARIANTS.md` (I1–I8). Classifies each finding as defect / test
  defect / documentation gap / intentional limitation. Never weakens an
  invariant to make a test pass.
- **`prisma-migration-reviewer`** — schema diff vs generated SQLite SQL.
  Knows VOX is SQLite (not Postgres), that table rebuilds hide backfill bugs in
  the `INSERT ... SELECT` column list, and that `ROUND` must precede `CAST` on
  money.
- **`visual-qa`** — drives the committed `tools/qa/` Playwright harness and
  *looks* at the PNG. Exists for defects `tsc`, ESLint and 914 unit tests
  provably cannot catch.

Spawning an agent is not free — each starts cold and re-derives context — so
they are for genuinely large sweeps, not routine work.

## Skills

`skills/` is gitignored. See `skills/README.md` for the expected set and the
pruning rationale.
