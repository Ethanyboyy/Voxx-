@AGENTS.md

# VOX — permanent development rules

VOX is a personal Cognitive Operating System (Next.js 16 App Router + TypeScript
+ Prisma/SQLite). Read `ARCHITECTURE.md` and `SECURITY.md` before making
structural changes. These rules apply to every change, not just Phase 1.

## Non-negotiables

1. Do not fabricate APIs, package versions, or config syntax — check
   `node_modules/<pkg>` types/docs or run `npm view <pkg> version` before
   assuming an API shape, especially for Next.js, Prisma, and the Anthropic SDK.
2. Keep AI-provider code behind `src/lib/ai/provider.ts` — never call
   `@anthropic-ai/sdk` (or any future provider SDK) outside `src/lib/ai/`.
3. Keep research-provider code behind `src/lib/research/provider.ts` for the
   same reason.
4. Memory confidence is never silently upgraded. An inference stays an
   inference (`MemoryCategory.INFERENCE` / low `Confidence`) until a human
   or a corroborating explicit fact promotes it.
5. Consequential actions (capability level `RECOMMEND` and above) must check
   `src/lib/permissions/service.ts` and, once performed, write an `Event` row
   via `src/lib/observability/events.ts`. Nothing consequential happens
   silently.
6. Never commit `.env`, `prisma/dev.db`, or anything under `src/generated/`.
7. Run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build`
   before considering a change complete. Fix failures — do not disable checks
   to make them pass.
8. New domain features need: a Prisma model/field (if needed), a service
   function in `src/lib/`, a route handler in `src/app/api/`, a test in
   `tests/`, and a UI surface if user-facing.

## Commands

- `npm run dev` — start the dev server (Turbopack, port 3000)
- `npm run build` / `npm start` — production build / run
- `npm run typecheck` — runs `next typegen` then `tsc --noEmit`
- `npm run lint` — ESLint (flat config)
- `npm test` — Vitest (single run) / `npm run test:watch`
- `npm run db:migrate` — create + apply a dev migration
- `npm run db:generate` — regenerate the Prisma client (also runs on `postinstall`)
- `npm run db:seed` — run `prisma/seed.ts`
- `npm run db:studio` — Prisma Studio

## Project layout

- `src/app/` — routes (pages + `api/*` route handlers)
- `src/lib/ai/` — provider-agnostic AI abstraction (Anthropic + mock)
- `src/lib/research/` — provider-agnostic research abstraction (mock in Phase 1)
- `src/lib/memory/`, `src/lib/cognition/`, `src/lib/knowledge/`,
  `src/lib/permissions/`, `src/lib/observability/` — domain services
- `src/lib/auth/` — password hashing + session cookies
- `src/components/` — UI
- `prisma/schema.prisma` — domain model (see `ARCHITECTURE.md` for the entity map)
- `tests/` — Vitest specs, one area per file
