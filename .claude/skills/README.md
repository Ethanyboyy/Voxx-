# Skills expected by VOX

`.claude/skills/` itself is **gitignored** — the directories under it are
third-party vendor payloads (megabytes, reinstallable) and do not belong in
VOX's history. This file is committed so a fresh clone still knows which set the
project expects and, more usefully, which set it has already rejected.

## Why this matters for context

A skill's **description loads into every session** whether or not it is ever
invoked; only the body is lazy. So an irrelevant skill is a permanent per-session
tax, and — worse than the tokens — a standing chance of misfiring on the wrong
task.

## Keep

**`r3f-*` (11)** — `animation`, `fundamentals`, `geometry`, `interaction`,
`lighting`, `loaders`, `materials`, `physics`, `postprocessing`, `shaders`,
`textures`.

Kept on measured usage, not on principle:

| Symbol | Files in `src/` |
|---|---|
| `three` | 64 |
| `@react-three/fiber` | 18 |
| `useFrame` | 15 |
| `@react-three/drei` | 13 |
| `Environment` | 6 |
| `useGLTF` | 3 |

These back the Brain visualization (`src/components/brain/three/`) and the
Suit/Lab viewer. ~1,500 tokens/session for the set, and they are load-bearing.

Two are kept for cohesion rather than current use, and are the first candidates
if further trimming is ever wanted: **`r3f-physics`** (`@react-three/rapier` — 0
files, `RigidBody` — 0) and **`r3f-postprocessing`** (`@react-three/postprocessing`
— 0 files, `EffectComposer` — 0).

**`ui-ux-pro-max`** — generic UI/UX intelligence. Kept for its accessibility and
responsive guidance, which is directly relevant to VOX's 390px-first work. It is
by far the largest remaining item (3.8 MB / 71 files) though its description is
only ~390 tokens; the cost is disk, not context.

## Removed, and why

14 skills, ≈13.5 KB of always-loaded descriptions — **≈3,400 tokens reclaimed per
session**, which is the figure that matters.

On disk the picture is mixed and worth stating precisely rather than rounding
up: entries here are a blend of real directories and symlinks into
`.agents/skills/`. Removing a real directory freed its bytes; removing a symlink
only unlinked it, leaving the payload in the shared `.agents/` store (gitignored
tooling state, ~1.6 MB). Either way the skill no longer loads, which is the
point — but "2.4 MB freed" would have been wrong.

| Removed | Reason |
|---|---|
| `higgsfield-brandkit`, `-generate`, `-marketplace-cards`, `-product-photoshoot`, `-soul-id`, `-video-explainer`, `-youtube-thumbnail` | Marketing image/video/brand generation via the Higgsfield CLI. No engineering role in VOX |
| `higgsfield-websites` | Builds **Cloudflare Worker + TanStack Start** apps. VOX is Next.js on Fly.io — actively the wrong stack to take advice from |
| `banner-design`, `brand`, `design`, `slides` | Marketing and presentation deliverables |
| `design-system` | Prescribes a three-layer primitive→semantic→component token architecture plus slide generation. **Conflicts** with VOX's own design language (`VOX_2.0_DESIGN_SYSTEM.md` and the `Instrument` primitives) |
| `ui-styling` | shadcn/ui + Radix. Verified absent from VOX: `@radix-ui` 0 files, `shadcn` 0, `class-variance-authority` 0. VOX uses Tailwind plus its own `Button`/`Card`/`Field`/`Instrument` components |

### Checked before deleting

`src/` contains 5 matches for "higgsfield" — these are VOX's **own video
provider** (`src/lib/video/higgsfield.ts`, which calls the Higgsfield HTTP API),
entirely unrelated to the `higgsfield-*` CLI skills. Removing the skills does not
affect the provider. `brand` and `slides` had no real matches in `.ts`/`.tsx`.

## Do not install

Per the environment review: Playwright MCP (the committed `tools/qa/` harness
already covers it), Prisma Postgres tooling (VOX is SQLite via
`better-sqlite3`), CockroachDB, and the large enterprise MCP bundles — Asana,
Atlassian, Datadog, Slack, PagerDuty, Gmail, Google Calendar, Miro, GrowthBook,
Auth0. Each adds permanent tool-schema weight for workflows VOX does not have.

## Reinstalling

Skills are installed with the plugin/skill tooling, not by this repository.
`/plugin` is unavailable in the Claude Code **web** environment — install from
the desktop app or CLI.
