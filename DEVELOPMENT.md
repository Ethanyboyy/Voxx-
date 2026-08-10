# Development

## Environment

- Node.js 20.9+ (developed against Node 22)
- npm (lockfile committed; other package managers aren't tested here)
- No external services required — SQLite is a local file, and the app runs fully on
  the mock AI/research providers without any API key.

## First-time setup

```bash
npm install                 # runs `prisma generate` automatically (postinstall)
cp .env.example .env
# generate real secrets:
openssl rand -base64 32     # → VOX_ENCRYPTION_KEY
openssl rand -base64 32     # → VOX_SESSION_SECRET
npm run db:migrate           # creates prisma/dev.db from prisma/migrations/
npm run dev
```

Open http://localhost:3000 — the first visit prompts you to create the single local
account (see SECURITY.md for why there's only one).

Without `ANTHROPIC_API_KEY` set, chat runs on a deterministic mock provider
(`src/lib/ai/mock.ts`) so the whole app is exercisable offline.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server, Turbopack, hot reload |
| `npm run build` | Production build (also type-checks) |
| `npm start` | Run the production build |
| `npm run typecheck` | `next typegen` (regenerates route-param types) then `tsc --noEmit` |
| `npm run lint` | ESLint, flat config |
| `npm test` | Vitest — provisions `prisma/test.db` first (see below), then runs all specs |
| `npm run test:watch` | Vitest in watch mode |
| `npm run db:migrate` | `prisma migrate dev` — create + apply a new migration |
| `npm run db:generate` | Regenerate the Prisma client into `src/generated/prisma` |
| `npm run db:seed` | Run `prisma/seed.ts` |
| `npm run db:studio` | Prisma Studio, browsing `prisma/dev.db` |

Before considering any change complete: `npm run typecheck && npm run lint && npm test
&& npm run build`, all green.

## Database

- `prisma/schema.prisma` is the source of truth for the domain model.
- The Prisma client is generated (not committed) to `src/generated/prisma`, imported
  from app code as `@/generated/prisma/client` (and `@/generated/prisma/enums` for enum
  const objects/types). Run `npm run db:generate` after pulling a schema change.
- SQLite is accessed through `@prisma/adapter-better-sqlite3` (Prisma 7's driver-adapter
  model — plain `datasource.url` alone is no longer enough). `src/lib/db.ts` and
  `prisma.config.ts` both resolve `file:./relative` URLs to an absolute path from
  `process.cwd()` so the CLI and the running app always agree on which file they're
  using; if you add a new entry point that touches the database directly, reuse that
  same resolution helper rather than relying on Prisma's default (which resolves
  relative to `schema.prisma`'s own directory, not `cwd`).
- After changing `prisma/schema.prisma`, run `npm run db:migrate` to create a migration
  and update `prisma/dev.db`.

## Testing

Tests run against a dedicated `prisma/test.db` (never `dev.db`), provisioned by the
`pretest` script via `prisma migrate deploy` against that file. Environment variables
for the whole test run (isolated `DATABASE_URL`, `VOX_AI_PROVIDER=mock`, deterministic
encryption/session secrets) are set in `vitest.config.mts`'s `test.env`, guaranteed to
apply before any module — in particular `src/lib/db.ts`, which reads `DATABASE_URL` at
import time — is evaluated.

Tests share one SQLite file (`fileParallelism: false` in `vitest.config.mts`, so test
files run sequentially rather than racing on the same file). Each test creates its own
user(s) via `tests/helpers.ts#createTestUser()` rather than relying on a clean slate,
so tests are independent of execution order — except the single-user registration
boundary tests in `tests/auth.test.ts`, which explicitly wipe `User`/`Session` first
since they're testing that exact constraint.

Coverage by area (`tests/*.test.ts`): memory (create/list/edit/delete/confidence/
encryption), permissions (default policy, grant/revoke, audit events), AI provider
abstraction (mock generate/stream, cost estimation), research (mock provider + the real
Anthropic web-search provider's response parsing, tested against hand-built fixtures
matching the SDK's real types — no live network needed), embeddings (local provider
determinism/similarity ranking), semantic memory (retrieval ranking, relations,
supersession, contradiction detection via an injected fake AI provider), knowledge
graph (FK-linking, cascade delete, bounded BFS traversal), the durable event timeline
(subject filtering, domain state-transition events), the cognition proposal engine
(propose → permission-gated approve → execute → result, including the denied-permission
path), chat context assembly (semantic ranking, the Context Inspector trace),
projects/goals/tasks/decisions/ideas/experiments, cognitive observations (profile
computation, pattern detection), auth (password hashing, sessions, single-user
boundary, login), API error handling (the shared `apiErrorResponse`/validation layer
every route handler uses), and one end-to-end integration test
(`tests/integration-full-loop.test.ts`) exercising the complete observe → memory →
research → graph → pattern → proposal → permission → result loop across real
subsystems.

Route handlers that call `cookies()` (`next/headers`) can't be invoked directly outside
a real Next.js request context, so the full HTTP path (auth boundary, status codes) for
those routes is verified by running the dev server and exercising it directly (`curl`
plus a Playwright-driven click-through of the actual UI — approve/deny buttons,
permission-denied states, graph node creation), not by an automated integration-test
harness — kept out to keep the dependency surface small. Adding one (e.g. hitting a
`next start` server in CI) is a reasonable next-phase addition if the API surface grows.

## Code style / structure

See CLAUDE.md for the permanent rules (provider abstraction boundaries, permission
enforcement, encryption). In short: UI in `src/components/`, routes in `src/app/`,
all business logic in `src/lib/*` services — pages and route handlers should stay thin
and call into a service function rather than embedding Prisma calls directly.

## Deployment

VOX is meant to run as a persistent, always-on cloud instance, not only on localhost —
see [DEPLOYMENT.md](./DEPLOYMENT.md) for the Fly.io runbook, `Dockerfile` /
`docker-entrypoint.sh` for the production container, and `SECURITY.md` → "Remote access
hardening" for what changes when VOX is internet-reachable (CSRF/Origin checks on
mutating requests, login rate limiting, security headers, SQLite WAL mode).

## Upgrading Next.js

This project pins to whatever `create-next-app` generated at the time (Next.js 16),
which ships version-matched agent docs at `node_modules/next/dist/docs/`. `AGENTS.md`
points there — read the relevant guide before making framework-level changes, since
Next.js's own docs note this version may differ substantially from a model's training
data (async `params`/`cookies()`/`headers()`, `middleware` → `proxy`, Turbopack as the
default bundler, etc.).
