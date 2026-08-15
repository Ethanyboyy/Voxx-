// Global (non-user-owned) Laboratory catalog: materials, seed scenarios,
// training modules, and tutorials. These models have a nullable userId (see
// prisma/schema.prisma) specifically so this catalog can be seeded once at
// migration time via prisma/seed.ts, before any VOX account exists — unlike
// LabSuit/LabGadget/LabProject/LabExperiment, which are real per-user owned
// records seeded per-account instead (see src/lib/lab/seedForUser.ts).
import { db } from "@/lib/db";
import { MATERIAL_SPECS, SCENARIO_SPECS, TRAINING_MODULE_SPECS, TUTORIAL_SPECS } from "@/lib/lab/seedData";

export async function seedLabCatalog(): Promise<void> {
  if ((await db.labMaterial.count({ where: { userId: null } })) === 0) {
    await db.labMaterial.createMany({ data: MATERIAL_SPECS });
  }

  if ((await db.labScenario.count({ where: { userId: null } })) === 0) {
    await db.labScenario.createMany({ data: SCENARIO_SPECS.map((s) => ({ ...s, isCustom: false })) });
  }

  if ((await db.labTrainingModule.count()) === 0) {
    await db.labTrainingModule.createMany({ data: TRAINING_MODULE_SPECS });
  }

  if ((await db.labTutorial.count()) === 0) {
    const idByKey = new Map<string, string>();
    for (const t of TUTORIAL_SPECS) {
      const created = await db.labTutorial.create({
        data: {
          title: t.title,
          category: t.category,
          difficulty: t.difficulty,
          lesson: t.lesson,
          demonstration: t.demonstration,
          exercisePrompt: t.exercisePrompt,
          quiz: JSON.stringify(t.quiz),
          prerequisiteId: t.prerequisiteKey ? idByKey.get(t.prerequisiteKey) : undefined,
        },
      });
      idByKey.set(t.key, created.id);
    }
  }
}
