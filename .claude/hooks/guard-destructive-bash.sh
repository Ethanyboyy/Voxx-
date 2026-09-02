#!/usr/bin/env bash
# PreToolUse guard for Bash commands.
#
# WHAT THIS IS FOR. Not a security boundary — an agent running Bash can defeat
# any pattern match given enough effort, and this makes no attempt to stop a
# determined bypass. It is a guard against the ACCIDENT: the plausible-looking
# command that destroys something unrecoverable on the way to doing something
# reasonable. Every pattern below corresponds to a real hazard in this
# repository, and the first one has already happened here:
#
#   * `pkill -f "next"` was run in a previous session to stop a dev server. The
#     pattern also matched the agent's own shell process tree, which killed the
#     session's shell mid-task and silently aborted a build.
#   * prisma/dev.db and prisma/qa.db are gitignored, so `rm` on them is
#     unrecoverable. dev.db is the only copy of local economic ledger data.
#   * prisma/migrations/ is committed history. A deleted migration directory
#     desynchronises every existing database from the schema.
#   * `prisma migrate reset` drops and recreates the database. It is sometimes
#     genuinely the right call, which is exactly why it should be a decision
#     rather than a step inside a longer command.
#
# DESIGN: DELIBERATE, NOT IMPOSSIBLE. Exit code 2 blocks the call and returns
# the message on stderr to Claude, which can then explain and ask. None of these
# operations become unavailable — they stop being things that happen in passing.
# A human who wants one asks for it, and it is run knowingly.
#
# FAIL-OPEN ON ERROR. If this script cannot parse its input it exits 0 and the
# command proceeds. A guard that blocks all work when it breaks would be removed
# within a day, and then nothing is guarded at all.

set -uo pipefail

payload="$(cat 2>/dev/null || true)"
[ -z "$payload" ] && exit 0

# Prefer jq; fall back to node (always present in this project) so the guard
# still works on a machine without jq installed.
if command -v jq >/dev/null 2>&1; then
  cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
else
  cmd="$(printf '%s' "$payload" | node -e \
    'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{process.stdout.write(JSON.parse(s)?.tool_input?.command??"")}catch{}})' \
    2>/dev/null || true)"
fi

[ -z "$cmd" ] && exit 0

block() {
  # stderr + exit 2 is the PreToolUse contract for "refuse and tell the model why".
  printf 'BLOCKED by .claude/hooks/guard-destructive-bash.sh\n\n%s\n\n%s\n' \
    "$1" \
    "This is a guard against accidents, not a prohibition. If this operation is genuinely intended, say so explicitly and run it as a deliberate, single step — or ask the user to confirm first." >&2
  exit 2
}

# ---- Databases: gitignored, therefore unrecoverable -------------------------
if printf '%s' "$cmd" | grep -qE '\brm\b.*prisma/(dev|test|qa)\.db'; then
  block "Deleting a local SQLite database (prisma/dev.db | test.db | qa.db). These are gitignored — there is no copy. dev.db holds the only local economic ledger rows, which the economic invariants are measured against."
fi

# ---- Migration history: committed, and load-bearing -------------------------
if printf '%s' "$cmd" | grep -qE '\brm\b.*prisma/migrations'; then
  block "Deleting prisma/migrations. That directory is committed history; removing it desynchronises every existing database from the schema and cannot be reconstructed from the schema alone."
fi

if printf '%s' "$cmd" | grep -qE 'prisma\s+migrate\s+reset|db\s+push.*--force-reset|--accept-data-loss'; then
  block "A destructive Prisma operation (migrate reset / force-reset / accept-data-loss). This drops data. It is occasionally correct, which is why it should be an explicit decision rather than a step inside a larger command."
fi

# ---- Source trees and repository root ---------------------------------------
# The target must be a COMPLETE path token. A bare `\.` here also matched the
# leading dot of `.claude/skills/<name>`, so an ordinary nested cleanup was
# refused as if it were `rm -rf .` — caught by the hook's own test suite
# (/tmp/test-guard.sh pattern), and exactly the over-blocking that makes a guard
# get switched off.
if printf '%s' "$cmd" | grep -qE '\brm\s+(-[a-zA-Z]+\s+)*\s*(/|~|\$HOME|\.{1,2}|\*|/home/user/Voxx-)/?([[:space:]]|;|&|\||$)'; then
  block "Recursive delete targeting the repository root, the home directory, '/', or a bare glob."
fi

# Guards the ROOT of a tracked tree, not arbitrary paths beneath it.
#
# The first version of this check matched any path containing one of these
# names, which blocked `rm -rf .claude/skills/<one-skill>` — a routine, wholly
# reversible cleanup. A guard that fires on ordinary work gets ignored or
# removed, and then it guards nothing; so the target must be the tree root
# itself (`src`, `./src`, `src/`), not something inside it.
if printf '%s' "$cmd" | grep -qE '\brm\s+(-[a-zA-Z]+\s+)*(\./)?(src|tests|prisma|\.github|\.claude|node_modules|public)/?([[:space:]]|;|&|\||$)'; then
  block "Recursive delete of a tracked tree ROOT (src / tests / prisma / .github / .claude / public). Deleting a specific path inside one of these is fine and is not blocked."
fi

# ---- Process killing: the failure that already happened here ----------------
# `pkill -f next` matches the agent's own shell because the command line
# contains the pattern. Targeted kills by PID, and pkill on an exact process
# name (-x), are left alone.
if printf '%s' "$cmd" | grep -qE '\b(pkill|killall)\b' \
   && ! printf '%s' "$cmd" | grep -qE '\bpkill\b.*\s-x\s'; then
  block "A broad pkill/killall. In this repository 'pkill -f next' has already killed the agent's own shell, because the pattern matched the shell's command line. Prefer: find the PID (ps -eo pid,args | grep ...), verify it, then 'kill <pid>'. 'pkill -x <exact-name>' is also allowed."
fi

# ---- Git operations that discard committed or pushed work -------------------
if printf '%s' "$cmd" | grep -qE 'git\s+push\b.*(--force|-f)(\s|$)' \
   && ! printf '%s' "$cmd" | grep -q 'force-with-lease'; then
  block "git push --force without --force-with-lease. This can overwrite commits pushed by another session or machine. Use --force-with-lease, which refuses when the remote moved unexpectedly."
fi

if printf '%s' "$cmd" | grep -qE 'git\s+reset\s+--hard|git\s+clean\s+-[a-zA-Z]*[fd]|git\s+checkout\s+\.\s*$|git\s+branch\s+-D\b'; then
  block "A git operation that discards uncommitted or unmerged work (reset --hard / clean -fd / checkout . / branch -D). Uncommitted work is not recoverable afterwards."
fi

# ---- Secrets and production ------------------------------------------------
if printf '%s' "$cmd" | grep -qE '(>|>>)\s*\.env(\s|$)|flyctl?\s+secrets\b'; then
  block "Writing .env or setting Fly secrets. Per DEPLOYMENT.md these are set once, by hand, outside CI — a previous CI change silently overwrote the live VOX_ENCRYPTION_KEY and VOX_SESSION_SECRET with empty strings and broke auth and field decryption."
fi

if printf '%s' "$cmd" | grep -qE 'flyctl?\s+(deploy|apps\s+destroy|volumes\s+destroy|machine\s+destroy)'; then
  block "A direct Fly production operation. Deployment goes through .github/workflows/fly-deploy.yml, which requires the verification gate to pass first."
fi

exit 0
