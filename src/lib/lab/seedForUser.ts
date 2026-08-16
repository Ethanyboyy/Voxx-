// Per-user Laboratory seed: populates a freshly-registered VOX account with a
// believable, fully-fictional design catalog (60+ suits, gadgets, components,
// a web profile, projects, simulations+runs, experiments) so the lab feels
// alive immediately — see prisma/seed.ts for why this is a per-user hook
// (called from registerFirstUser) rather than a migration-time seed: Lab
// suits/gadgets/projects/experiments are owned records (real userId FK), and
// no User exists yet at migration time in VOX's real single-account flow.
//
// Idempotent: no-ops if this user already has any LabSuit.
import { db } from "@/lib/db";
import { createSuit } from "@/lib/lab/suits";
import { createGadget } from "@/lib/lab/gadgets";
import { createComponent } from "@/lib/lab/components";
import { createWebProfile, addLoadModel } from "@/lib/lab/webLab";
import { createLabProject } from "@/lib/lab/projects";
import { createSimulation, executeSimulation } from "@/lib/lab/simulations";
import { createExperiment, addExperimentResult, updateExperiment, nextExperimentCode } from "@/lib/lab/experiments";
import {
  SUIT_SPECS,
  generateSuitDesign,
  GADGET_SPECS,
  PROJECT_SPECS,
  EXPERIMENT_SPECS,
  generateSuitStats,
  suitDescription,
} from "@/lib/lab/seedData";

async function materialId(name: string): Promise<string | undefined> {
  const m = await db.labMaterial.findFirst({ where: { name } });
  return m?.id;
}

async function buildDeepComponents(suitId: string, materials: Record<string, string | undefined>) {
  const mask = await createComponent({
    suitId, name: "Mask", description: "Full-coverage head unit housing optics and comms.",
    materialId: materials["Polymer Weave"], massKg: 0.4, confidence: "ESTIMATED", order: 0,
  });
  const lens = await createComponent({
    suitId, parentId: mask.id, name: "Lens System", description: "Dual-lens optical assembly with adaptive aperture.",
    materialId: materials["Photoreactive Coating"], massKg: 0.08, confidence: "ESTIMATED", order: 0,
  });
  await createComponent({
    suitId, parentId: lens.id, name: "Optical Module", description: "Primary imaging module behind the lens.",
    materialId: materials["Piezoelectric Film"], massKg: 0.03, confidence: "HYPOTHETICAL", order: 0,
  });
  await createComponent({
    suitId, parentId: lens.id, name: "Sensor Component", description: "Multi-spectrum micro-sensor array.",
    materialId: materials["Conductive Thread"], massKg: 0.02, confidence: "HYPOTHETICAL", order: 1,
  });
  await createComponent({
    suitId, name: "Structural Layer", description: "Load-bearing rigid substructure.",
    materialId: materials["Carbon Composite Plate"], massKg: 0.9, confidence: "VERIFIED", order: 1,
  });
  await createComponent({
    suitId, name: "Electronics", description: "Central suit electronics bus.",
    materialId: materials["Conductive Thread"], massKg: 0.3, confidence: "ESTIMATED", order: 2,
  });
  await createComponent({
    suitId, name: "Gloves", description: "Articulated grip units with tactile sensors.",
    materialId: materials["Reinforced Elastomer"], massKg: 0.2, confidence: "ESTIMATED", order: 3,
  });
}

async function buildStandardComponents(
  suitId: string,
  archetype: string,
  materials: Record<string, string | undefined>
) {
  const secondary = archetype === "Combat" || archetype === "Tactical" ? "Ballistic Weave" : "Polymer Weave";
  await createComponent({
    suitId, name: "Outer Layer", description: "Primary environment-facing shell.",
    materialId: materials[secondary], massKg: 0.6, confidence: "ESTIMATED", order: 0,
  });
  await createComponent({
    suitId, name: "Electronics", description: "Distributed sensor and comms wiring.",
    materialId: materials["Conductive Thread"], massKg: 0.25, confidence: "ESTIMATED", order: 1,
  });
  await createComponent({
    suitId,
    name: archetype === "Recon" ? "Sensor Module" : "Mask",
    description: archetype === "Recon" ? "Head-mounted multi-spectrum sensor array." : "Head-coverage unit.",
    materialId: materials["Polymer Weave"], massKg: 0.35, confidence: "ESTIMATED", order: 2,
  });
}

export async function seedLabForUser(userId: string): Promise<void> {
  const already = await db.labSuit.count({ where: { userId } });
  if (already > 0) return;

  const materialNames = [
    "Polymer Weave", "Carbon Composite Plate", "Ballistic Weave", "Conductive Thread",
    "Photoreactive Coating", "Piezoelectric Film", "Reinforced Elastomer",
  ];
  const materials: Record<string, string | undefined> = {};
  for (const name of materialNames) materials[name] = await materialId(name);

  // --- Suits (60+) ---
  const createdSuits: { id: string; codename: string; archetype: string }[] = [];
  for (let i = 0; i < SUIT_SPECS.length; i++) {
    const spec = SUIT_SPECS[i];
    const stats = generateSuitStats(spec.archetype, i);
    const design = generateSuitDesign(spec.archetype, i);
    const suit = await createSuit({
      userId,
      codename: spec.codename,
      designation: `MK-${i + 1}`,
      archetype: spec.archetype,
      description: suitDescription(spec),
      colorPrimary: spec.colorPrimary,
      colorSecondary: spec.colorSecondary,
      silhouette: design.silhouette,
      materialLanguage: design.materialLanguage,
      patternStyle: design.patternStyle,
      armorLevel: design.armorLevel,
      maskLensStyle: design.maskLensStyle,
      stats,
    });
    createdSuits.push({ id: suit.id, codename: suit.codename, archetype: spec.archetype });

    if (i < 3) {
      await buildDeepComponents(suit.id, materials);
    } else {
      await buildStandardComponents(suit.id, spec.archetype, materials);
    }
  }

  // --- Gadgets (15+) ---
  const createdGadgets: { id: string; name: string }[] = [];
  for (const g of GADGET_SPECS) {
    const gadget = await createGadget({
      userId,
      name: g.name,
      category: g.category,
      description: `${g.name} — a ${g.category.toLowerCase()} concept device.`,
      stats: {
        massKg: g.massKg,
        powerRequirementW: g.powerRequirementW,
        batteryLifeHours: g.batteryLifeHours,
        durability: g.durability,
        sensorAccuracy: g.sensorAccuracy,
        rangeM: g.rangeM,
        manufacturingComplexity: g.manufacturingComplexity,
        estimatedCostUsd: g.estimatedCostUsd,
        reliability: g.reliability,
        confidence: "ESTIMATED",
      },
    });
    createdGadgets.push({ id: gadget.id, name: gadget.name });
    await createComponent({
      gadgetId: gadget.id, name: "Housing", description: "Outer protective enclosure.",
      materialId: materials["Reinforced Elastomer"], massKg: g.massKg * 0.4, confidence: "ESTIMATED", order: 0,
    });
    await createComponent({
      gadgetId: gadget.id, name: "Core Module", description: "Primary functional core.",
      materialId: materials["Conductive Thread"], massKg: g.massKg * 0.5, confidence: "HYPOTHETICAL", order: 1,
    });
  }

  // --- Web profile ---
  const webProfile = await createWebProfile({
    userId,
    name: "Standard Web-Fluid Line System",
    description: "Baseline theoretical web-line system profile for load and deployment modeling.",
    material: {
      densityGCm3: 1.05, tensileStrengthMpa: 900, elasticityPercent: 45, abrasionResistance: 60,
      temperatureResistanceC: 90, moistureResistance: 55, storageVolumeCm3: 12, massG: 18, confidence: "HYPOTHETICAL",
    },
    deployment: {
      deploymentSpeedMs: 35, lineLengthM: 60, cartridgeSizeCm3: 8, systemMassG: 210,
      energyRequirementJ: 40, deploymentReliabilityPct: 88, confidence: "HYPOTHETICAL",
    },
    attachment: {
      attachmentType: "Adhesive micro-anchor", theoreticalHoldingStrengthN: 4500,
      environmentalAssumptions: "Dry, clean, non-porous urban surface at 15-25°C.",
      geometry: "Conical multi-point contact tip, 6mm diameter.",
      structuralAssumptions: "Single-point static load, no lateral shear beyond 10 degrees.",
      estimatedFailureProbabilityPct: 8, confidence: "HYPOTHETICAL",
    },
  });
  await addLoadModel(userId, webProfile.id, {
    label: "Standard swing, 75kg user", userMassKg: 75, equipmentMassKg: 4.5, swingRadiusM: 12, velocityMs: 8,
  });
  await addLoadModel(userId, webProfile.id, {
    label: "High-velocity swing, 75kg user", userMassKg: 75, equipmentMassKg: 4.5, swingRadiusM: 12, velocityMs: 16,
  });

  // --- Projects (5) ---
  const projects: { id: string; name: string }[] = [];
  for (const p of PROJECT_SPECS) {
    const project = await createLabProject({ userId, name: p.name, description: p.description });
    projects.push({ id: project.id, name: project.name });
  }
  const nightcrawler = createdSuits.find((s) => s.codename === "Nightcrawler");
  if (nightcrawler) {
    await db.labSuit.update({ where: { id: nightcrawler.id }, data: { projectId: projects[0]?.id } });
  }
  if (createdGadgets[7]) {
    await db.labGadget.update({ where: { id: createdGadgets[7].id }, data: { projectId: projects[1]?.id } });
  }
  await db.labWebProfile.update({ where: { id: webProfile.id }, data: { projectId: projects[1]?.id } });

  // --- Scenarios + Simulations + runs ---
  const scenarios = await db.labScenario.findMany({ where: { userId: null }, take: 6 });
  const simSuits = createdSuits.slice(0, 6);
  for (let i = 0; i < Math.min(scenarios.length, simSuits.length); i++) {
    const simulation = await createSimulation({
      userId,
      name: `${simSuits[i].codename} — ${scenarios[i].name}`,
      scenarioId: scenarios[i].id,
      suitId: simSuits[i].id,
      userMassKg: 75,
      skillLevel: 50 + (i % 4) * 10,
    });
    await executeSimulation(userId, simulation.id, 1000 + i);
  }

  // --- Experiments ---
  for (let i = 0; i < EXPERIMENT_SPECS.length; i++) {
    const spec = EXPERIMENT_SPECS[i];
    const suit = createdSuits[i % createdSuits.length];
    const code = await nextExperimentCode(userId);
    const experiment = await createExperiment({
      userId,
      code,
      title: spec.title,
      hypothesis: spec.hypothesis,
      suitId: suit.id,
      confidence: spec.confidence,
      variables: [{ name: "target suit", value: suit.codename }],
    });
    if (spec.status !== "PLANNED") {
      await updateExperiment(userId, experiment.id, { status: spec.status });
    }
    if (spec.outcome) {
      await addExperimentResult(userId, experiment.id, { outcome: spec.outcome, confidence: spec.confidence });
    }
  }
}
