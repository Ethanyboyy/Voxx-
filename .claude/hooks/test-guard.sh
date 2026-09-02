#!/usr/bin/env bash
# Test suite for guard-destructive-bash.sh. Run: bash .claude/hooks/test-guard.sh
#
# Exercises the guard without putting the
# dangerous strings on the outer command line (which the guard would match).
# Resolve the repo root from this script's own location, not a hardcoded path —
# a fresh clone lives somewhere else, and a test that only runs on one machine
# is not a test.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)" || exit 1
H=.claude/hooks/guard-destructive-bash.sh
fails=0

check() { # check <expect: BLOCK|ALLOW> <command>
  local expect="$1" cmd="$2" rc
  printf '{"tool_input":{"command":%s}}' \
    "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$cmd")" \
    | bash "$H" >/dev/null 2>&1
  rc=$?
  local got="ALLOW"; [ $rc -eq 2 ] && got="BLOCK"
  if [ "$got" = "$expect" ]; then
    printf '  ok    %-6s %s\n' "$got" "$cmd"
  else
    printf '  FAIL  expected %s got %s: %s\n' "$expect" "$got" "$cmd"; fails=$((fails+1))
  fi
}

echo "=== must BLOCK ==="
check BLOCK 'rm -f prisma/dev.db'
check BLOCK 'rm prisma/qa.db'
check BLOCK 'rm -rf prisma/migrations'
check BLOCK 'npx prisma migrate reset --force'
check BLOCK 'npx prisma db push --force-reset'
check BLOCK 'rm -rf src'
check BLOCK 'rm -rf ./tests'
check BLOCK 'rm -rf .claude/'
check BLOCK 'pkill -f next'
check BLOCK 'killall node'
check BLOCK 'git push --force origin main'
check BLOCK 'git reset --hard HEAD~1'
check BLOCK 'git clean -fdx'
check BLOCK 'git branch -D claude/old'
check BLOCK 'echo SECRET > .env'
check BLOCK 'flyctl secrets set A=b'
check BLOCK 'flyctl deploy --app vox'

echo "=== must ALLOW ==="
check ALLOW 'npm test'
check ALLOW 'npm run build'
check ALLOW 'npm run typecheck'
check ALLOW 'git status --short'
check ALLOW 'git push -u origin claude/spider-man-lab-foundation-mvjayy'
check ALLOW 'git push --force-with-lease origin main'
check ALLOW 'rm -rf .claude/skills/some-skill'
check ALLOW 'rm /tmp/scratch.log'
check ALLOW 'kill 12345'
check ALLOW 'pkill -x chromium'
check ALLOW 'npx prisma migrate dev --name add_thing'
check ALLOW 'cat .env.example'
check ALLOW 'npx prisma validate'

echo
[ $fails -eq 0 ] && echo "ALL GUARD CASES PASS" || echo "$fails CASE(S) FAILED"
exit $fails
