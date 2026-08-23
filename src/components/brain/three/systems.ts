import type { BrainNodeType } from "@/lib/brain/graph";

/**
 * The Brain's semantic-zoom taxonomy — purely a presentation grouping over
 * the real BrainNodeType values from src/lib/brain/graph.ts. This file adds
 * no new entities and no new state; it only decides which visual "region"
 * an already-real node renders in and what color/shape identifies it. A
 * node's underlying data (status, meta, edges) is untouched.
 */
export type BrainSystem =
  | "OBJECTIVES"
  | "MEMORY"
  | "RESEARCH"
  | "PROJECTS"
  | "EXECUTION"
  | "ECONOMICS"
  | "COGNITION"
  | "CONNECTIONS";

export const SYSTEM_OF: Record<BrainNodeType, BrainSystem> = {
  OBJECTIVE: "OBJECTIVES",
  OPPORTUNITY: "OBJECTIVES",
  MEMORY: "MEMORY",
  RESEARCH: "RESEARCH",
  PROJECT: "PROJECTS",
  TASK: "PROJECTS",
  AGENT_RUN: "EXECUTION",
  SUPERVISOR_RUN: "EXECUTION",
  ECONOMIC_ASSET: "ECONOMICS",
  PROPOSAL: "COGNITION",
  CONNECTION: "CONNECTIONS",
};

export const SYSTEM_ORDER: BrainSystem[] = [
  "OBJECTIVES",
  "MEMORY",
  "RESEARCH",
  "PROJECTS",
  "EXECUTION",
  "ECONOMICS",
  "COGNITION",
  "CONNECTIONS",
];

export const SYSTEM_LABEL: Record<BrainSystem, string> = {
  OBJECTIVES: "Objectives",
  MEMORY: "Memory",
  RESEARCH: "Research",
  PROJECTS: "Projects",
  EXECUTION: "Execution",
  ECONOMICS: "Economics",
  COGNITION: "Cognition",
  CONNECTIONS: "Connections",
};

// Drawn straight from the existing design tokens in globals.css (--accent,
// --core-listening, --accent-2, --accent-steel, --core-executing/--warning,
// --success, --core-thinking) — no new hues invented for this milestone.
export const SYSTEM_COLOR: Record<BrainSystem, string> = {
  OBJECTIVES: "#a855f7",
  MEMORY: "#38bdf8",
  RESEARCH: "#6366f1",
  PROJECTS: "#94a3b8",
  EXECUTION: "#fbbf24",
  ECONOMICS: "#34d399",
  COGNITION: "#c084fc",
  CONNECTIONS: "#7c94a8",
};

export type NodeGeometry =
  | "icosahedron"
  | "tetrahedron"
  | "dodecahedron"
  | "sphere"
  | "torus"
  | "octahedron"
  | "ring"
  | "cone"
  | "coneLarge"
  | "hexPrism";

// Shape carries "what kind of thing is this" (per-type); color carries
// "which system does it belong to" (per-system, above) — together they let
// a viewer read a node without a label, per the directive's own framing.
export const GEOMETRY_OF: Record<BrainNodeType, NodeGeometry> = {
  OBJECTIVE: "icosahedron",
  OPPORTUNITY: "tetrahedron",
  PROJECT: "dodecahedron",
  TASK: "sphere",
  RESEARCH: "torus",
  PROPOSAL: "octahedron",
  CONNECTION: "ring",
  MEMORY: "icosahedron",
  AGENT_RUN: "cone",
  SUPERVISOR_RUN: "coneLarge",
  ECONOMIC_ASSET: "hexPrism",
};

// Relative base scale per type so e.g. a SupervisorRun visibly outranks the
// AgentRuns it drives, and a Task reads smaller than its parent Objective —
// purely a rendering constant, not a new importance ranking (importanceOf()
// in importance.ts remains the one place that decides visual weight from
// real fields; this is just a per-type floor).
export const BASE_SCALE: Record<BrainNodeType, number> = {
  OBJECTIVE: 1,
  OPPORTUNITY: 0.75,
  PROJECT: 0.85,
  TASK: 0.5,
  RESEARCH: 0.7,
  PROPOSAL: 0.7,
  CONNECTION: 0.55,
  MEMORY: 0.5,
  AGENT_RUN: 0.7,
  SUPERVISOR_RUN: 0.95,
  ECONOMIC_ASSET: 0.75,
};

// Real Event.subjectType strings this app records (see ActivityTimeline.tsx
// for the same mapping applied to the 2D graph) -> which system region
// should visibly react. Anything not listed here simply doesn't pulse
// anything — never a guessed/invented mapping.
export const SUBJECT_TYPE_TO_SYSTEM: Record<string, BrainSystem> = {
  Objective: "OBJECTIVES",
  Opportunity: "OBJECTIVES",
  Memory: "MEMORY",
  Project: "PROJECTS",
  Task: "PROJECTS",
  AgentRun: "EXECUTION",
  SupervisorRun: "EXECUTION",
  EconomicAsset: "ECONOMICS",
  Proposal: "COGNITION",
  Connection: "CONNECTIONS",
};
