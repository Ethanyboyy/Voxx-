#!/usr/bin/env bash
# PostToolUse notice for edits under src/lib/economic/.
#
# WHY THIS AND NOT A TYPECHECK. The obvious PostToolUse hook is "typecheck after
# every edit". It was measured in this repository and rejected:
#
#     npm run typecheck   26.5s   (next typegen dominates)
#     npx tsc --noEmit     8.3s   (project-wide, 676 files)
#
# 8.3s on every single Edit is minutes added to any multi-file change, and worse,
# a mid-refactor typecheck reports errors that are simply "file B not updated
# yet". That trains everyone to ignore the hook's output, which is worse than
# having no hook. The gate belongs in CI (.github/workflows/verify.yml), where
# it runs once per push against a complete tree.
#
# What IS worth doing on an economic edit costs nothing: a reminder that this
# directory has a protected baseline and a fast suite that covers it. Pure string
# matching on a path, no subprocess, no I/O beyond a printf.

set -uo pipefail

payload="$(cat 2>/dev/null || true)"
[ -z "$payload" ] && exit 0

if command -v jq >/dev/null 2>&1; then
  file="$(printf '%s' "$payload" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
else
  file="$(printf '%s' "$payload" | node -e \
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s)?.tool_input?.file_path??"")}catch{}})' \
    2>/dev/null || true)"
fi

case "$file" in
  *src/lib/economic/*)
    cat >&2 <<'NOTICE'
Economic engine touched. This directory has a protected baseline (commit 114d826)
covering: integer-cent accounting, the cumulative spend ceiling and its atomic
guard, concurrency, tick lifecycle/lease reclaim, money validation, UTC handling,
policy parity, REALIZED protections, and the AWAITING_HUMAN boundary.

Before considering the change done: run /eco-check (~59s), and read
ECONOMIC_INVARIANTS.md if an invariant looks like it is in the way. An invariant
is never weakened to make a test pass.
NOTICE
    ;;
esac

exit 0
