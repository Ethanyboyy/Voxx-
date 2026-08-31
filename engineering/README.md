# Engineering state

Durable project state, so a cold session can recover where things stand without
reconstructing it from conversation. Conversational memory does not survive; the
repository does.

## Recovering state (start every session here)

```bash
git status && git log --oneline -5
cat engineering/state.json          # architecture, phase, what is verified
cat engineering/backlog.json        # what to do next, in priority order
npm run typecheck && npm test       # confirm the recorded state is still true
```

The recorded verification in `state.json` is a claim about a specific commit. If
`git log` shows commits after `state.json#verifiedAt`, re-run the gate before
trusting it — a stale "all green" is worse than no record, because it is acted
on.

## Files

| File | Holds |
| --- | --- |
| `state.json` | Architecture map, current phase, last verification, known limitations |
| `backlog.json` | Prioritised work items, each with acceptance and verification criteria |

Two files, not eight. A state system that costs more to maintain than it saves
gets abandoned half-updated, and a half-updated state file is actively
misleading.

## Conventions

**Priority** is `P0`–`P6` as defined in the build directive: P0 broken or
dangerous, P1 core functionality, P2 architecture/UX/performance, P3 missing
functionality, P4 visual quality, P5 micro-polish, P6 cleanup.

**Status** is one of `todo`, `in_progress`, `blocked`, `verifying`, `done`.

**`needsOpus: true`** marks work requiring judgement — architecture, visual
design, non-obvious debugging. Deterministic work (formatting, dependency
bumps, asset compression, mechanical refactors) does not need it, and marking
everything as needing judgement defeats the split.

**Honesty rule.** `verification` records what was actually run and what it
returned. "Should work" is not a verification. An item is only `done` when its
`verificationCriteria` were checked and passed.
