import type { BrainNodeType } from "@/lib/brain/graph";

/**
 * The 8 real VOX subsystems (same taxonomy this app has used since the
 * first 3D Brain pass) mapped onto approximate anatomical surface points
 * on the procedural brain built by brainGeometry.ts. These are INTERFACE
 * SEMANTICS — a memorable, defensible metaphor for where each kind of VOX
 * activity "lives" on the visualization — not a claim about literal
 * neuroscience. A couple of the mappings borrow real neuroscience where it
 * happens to fit naturally (temporal lobe ~ memory, occipital lobe ~
 * incoming information/research); most are simply spatially distinct,
 * memorable anchor points.
 */
export type BrainSystem = "OBJECTIVES" | "EXECUTION" | "MEMORY" | "RESEARCH" | "PROJECTS" | "COGNITION" | "CONNECTIONS" | "ECONOMICS";

export const SYSTEM_OF: Record<BrainNodeType, BrainSystem> = {
  OBJECTIVE: "OBJECTIVES",
  OPPORTUNITY: "OBJECTIVES",
  AGENT_RUN: "EXECUTION",
  SUPERVISOR_RUN: "EXECUTION",
  MEMORY: "MEMORY",
  RESEARCH: "RESEARCH",
  PROJECT: "PROJECTS",
  TASK: "PROJECTS",
  PROPOSAL: "COGNITION",
  CONNECTION: "CONNECTIONS",
  ECONOMIC_ASSET: "ECONOMICS",
};

export const SYSTEM_ORDER: BrainSystem[] = ["OBJECTIVES", "EXECUTION", "MEMORY", "RESEARCH", "PROJECTS", "COGNITION", "CONNECTIONS", "ECONOMICS"];

export const SYSTEM_LABEL: Record<BrainSystem, string> = {
  OBJECTIVES: "Objectives",
  EXECUTION: "Execution",
  MEMORY: "Memory",
  RESEARCH: "Research",
  PROJECTS: "Projects",
  COGNITION: "Cognition",
  CONNECTIONS: "Connections",
  ECONOMICS: "Economics",
};

export const SYSTEM_REGION_LABEL: Record<BrainSystem, string> = {
  OBJECTIVES: "Frontal pole",
  EXECUTION: "Motor cortex",
  MEMORY: "Temporal lobe",
  RESEARCH: "Occipital lobe",
  PROJECTS: "Parietal lobe",
  COGNITION: "Prefrontal core",
  CONNECTIONS: "Brainstem",
  ECONOMICS: "Cerebellum",
};

// Drawn from the same dark-theme token values as the rest of VOX
// (--accent, --accent-2, --accent-blue, --core-*) — see globals.css.
export const SYSTEM_COLOR: Record<BrainSystem, string> = {
  OBJECTIVES: "#a855f7",
  EXECUTION: "#fbbf24",
  MEMORY: "#38bdf8",
  RESEARCH: "#6366f1",
  PROJECTS: "#94a3b8",
  COGNITION: "#c084fc",
  CONNECTIONS: "#f472b6",
  ECONOMICS: "#34d399",
};

export const SUBJECT_TYPE_TO_SYSTEM: Record<string, BrainSystem> = {
  Objective: "OBJECTIVES",
  Opportunity: "OBJECTIVES",
  AgentRun: "EXECUTION",
  SupervisorRun: "EXECUTION",
  Memory: "MEMORY",
  Project: "PROJECTS",
  Task: "PROJECTS",
  Proposal: "COGNITION",
  Connection: "CONNECTIONS",
  EconomicAsset: "ECONOMICS",
};

export type Vec3 = [number, number, number];

/**
 * Fixed anchor points in the same local unit space brainGeometry.ts shapes
 * the mesh in (ellipsoid ~0.72 x 0.58 x 0.95 before per-vertex fold
 * displacement) — each sits just outside the smooth base surface so a
 * marker decal reads as sitting ON the brain rather than floating away
 * from or buried inside it.
 */
export const SYSTEM_ANCHOR: Record<BrainSystem, Vec3> = {
  OBJECTIVES: [0.4, 0.1, 0.92],
  EXECUTION: [-0.52, 0.38, 0.22],
  MEMORY: [0.64, -0.22, 0.12],
  RESEARCH: [-0.4, 0.08, -0.88],
  PROJECTS: [0.5, 0.42, -0.22],
  COGNITION: [0.14, 0.18, 0.4],
  CONNECTIONS: [0, -0.78, -0.12],
  ECONOMICS: [0, -0.7, -0.78],
};
