// VOX intentionally ships no demo/fixture data about the *user* — a personal
// cognitive operating system with fabricated memories, projects, or
// observations would be actively misleading. Onboarding happens through the
// real first-run flow at /setup, which creates the single local account.
//
// The Spider-Man Laboratory is different: it's an explicitly fictional
// design/engineering sandbox (original suit concepts, materials, training
// modules), not a claim about the user's real life, so a seeded starter
// catalog is appropriate there (see ARCHITECTURE.md). Only the *global*
// catalog (materials, seed scenarios, training modules, tutorials) is seeded
// here, since it has no owning user and this script runs before any account
// exists. Per-account Lab content (suits, gadgets, projects, experiments) is
// seeded once, per-user, right after registerFirstUser() creates the account
// — see src/lib/lab/seedForUser.ts.
import { db } from "../src/lib/db";
import { seedLabCatalog } from "../src/lib/lab/seedCatalog";

async function main() {
  await seedLabCatalog();
  console.log("VOX: Laboratory catalog seeded (materials, scenarios, training modules, tutorials).");
  console.log("VOX: nothing else to seed in Phase 1 — create your account at /setup.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
