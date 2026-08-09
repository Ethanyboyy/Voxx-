// VOX intentionally ships no demo/fixture data: a personal cognitive operating
// system with fabricated memories, projects, or observations would be actively
// misleading. Onboarding happens through the real first-run flow at /setup,
// which creates the single local account.
//
// This script exists so `npm run db:seed` / `prisma db seed` is a valid,
// idempotent no-op rather than an error — a natural place to add real,
// non-fabricated seed data later (e.g. default Permission rows) if needed.
import { db } from "../src/lib/db";

async function main() {
  console.log("VOX: nothing to seed in Phase 1 — create your account at /setup.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
