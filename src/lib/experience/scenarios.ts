import type { BrainStateName } from "@/lib/experience/state";
import type { BaySuitItem } from "@/components/lab/SuitBaySpatial";

/**
 * Deterministic synthetic state for the visual QA environment.
 *
 * Every value here is invented for the purpose of rendering a scene, and none
 * of it touches the database, the session, or any provider. That is the whole
 * security posture of the preview route: it cannot leak real memories,
 * credentials, connections or financial data because it never has access to
 * them in the first place — rather than being a real page with redaction
 * bolted on, which is the version that eventually leaks.
 *
 * The components rendered against this data are the REAL production
 * components. A preview built from a parallel set of mock components would
 * verify nothing.
 */

export type ScenarioId =
  | "brain-idle"
  | "brain-listening"
  | "brain-thinking"
  | "brain-memory"
  | "brain-reasoning"
  | "brain-execution"
  | "brain-complete"
  | "brain-error"
  | "suit-bay"
  | "suit-selected"
  | "suit-inspection"
  | "wrist-inspection"
  | "wrist-exploded"
  | "wrist-reassembled";

export interface ScenarioDefinition {
  id: ScenarioId;
  label: string;
  /** Which surface renders. */
  surface: "brain" | "suit-bay" | "wrist";
  brainState: BrainStateName;
  /** Synthetic event types, shaping the Brain's signal mix. */
  eventTypes: string[];
  /** Suit Bay: whether the camera has moved in on a subject. */
  focused?: boolean;
  /** Wrist: how far the assembly is separated, 0–1. */
  explode?: number;
  /** Wrist: which part is selected. */
  selectedPart?: string;
}

export const SCENARIOS: Record<ScenarioId, ScenarioDefinition> = {
  "brain-idle": { id: "brain-idle", label: "Brain — idle", surface: "brain", brainState: "idle", eventTypes: [] },
  "brain-listening": {
    id: "brain-listening",
    label: "Brain — listening",
    surface: "brain",
    brainState: "idle",
    eventTypes: ["memory.created"],
  },
  "brain-thinking": {
    id: "brain-thinking",
    label: "Brain — thinking",
    surface: "brain",
    brainState: "thinking",
    eventTypes: ["cognition.patterns_detected", "supervisor.planning", "proposal.created"],
  },
  "brain-memory": {
    id: "brain-memory",
    label: "Brain — memory retrieval",
    surface: "brain",
    brainState: "learning",
    eventTypes: ["memory.created", "memory.updated", "memory.relation_created", "research.recorded"],
  },
  "brain-reasoning": {
    id: "brain-reasoning",
    label: "Brain — reasoning",
    surface: "brain",
    brainState: "researching",
    eventTypes: ["cognition.patterns_detected", "research.performed", "supervisor.replanning", "proposal.created"],
  },
  "brain-execution": {
    id: "brain-execution",
    label: "Brain — execution",
    surface: "brain",
    brainState: "executing",
    eventTypes: ["agent.run.started", "task.completed", "proposal.executed", "lab.experiment.created", "objective.progress"],
  },
  "brain-complete": {
    id: "brain-complete",
    label: "Brain — complete",
    surface: "brain",
    brainState: "idle",
    eventTypes: ["objective.verified", "agent.run.completed", "outcome.recorded"],
  },
  "brain-error": {
    id: "brain-error",
    label: "Brain — error",
    surface: "brain",
    brainState: "error",
    eventTypes: ["agent.run.failed", "supervisor.failed"],
  },
  "suit-bay": { id: "suit-bay", label: "Suit Bay — establishing", surface: "suit-bay", brainState: "idle", eventTypes: [], focused: false },
  "suit-selected": { id: "suit-selected", label: "Suit Bay — subject", surface: "suit-bay", brainState: "idle", eventTypes: [], focused: true },
  "suit-inspection": {
    id: "suit-inspection",
    label: "Suit — inspection",
    surface: "suit-bay",
    brainState: "thinking",
    eventTypes: ["lab.suit.created"],
    focused: true,
  },
  "wrist-inspection": { id: "wrist-inspection", label: "Wrist — inspection", surface: "wrist", brainState: "thinking", eventTypes: [], explode: 0 },
  "wrist-exploded": {
    id: "wrist-exploded",
    label: "Wrist — exploded",
    surface: "wrist",
    brainState: "analyzing" as BrainStateName,
    eventTypes: [],
    explode: 1,
    selectedPart: "wristCartridge",
  },
  "wrist-reassembled": { id: "wrist-reassembled", label: "Wrist — reassembled", surface: "wrist", brainState: "idle", eventTypes: [], explode: 0 },
};

export const SCENARIO_IDS = Object.keys(SCENARIOS) as ScenarioId[];

export function getScenario(id: string): ScenarioDefinition | null {
  return (SCENARIOS as Record<string, ScenarioDefinition>)[id] ?? null;
}

/**
 * Synthetic events with stable ids and timestamps.
 *
 * Deterministic on purpose: a visual QA capture that differs run to run cannot
 * be diffed, and a scenario whose activity level depends on `Date.now()` is not
 * a scenario, it is a slot machine.
 */
export function scenarioEvents(scenario: ScenarioDefinition) {
  const epoch = Date.UTC(2026, 0, 1, 12, 0, 0);
  return scenario.eventTypes.map((type, i) => ({
    id: `preview-${scenario.id}-${i}`,
    type,
    subjectType: null,
    subjectId: null,
    createdAt: new Date(epoch - i * 45_000).toISOString(),
  }));
}

/**
 * Synthetic suits for the bay.
 *
 * Original, non-branded designations. These exist to prove the room, the
 * platforms, the camera and the selection behaviour — not to stand in as
 * finished hero assets.
 */
export const SCENARIO_SUITS: BaySuitItem[] = [
  {
    id: "preview-suit-1",
    codename: "MERIDIAN",
    designation: "VX-01",
    archetype: "Utility",
    status: "ACTIVE",
    realityStatus: "PROTOTYPE",
    modelUrl: null,
    colorPrimary: "#7c5cff",
    colorSecondary: "#131318",
    silhouette: "ATHLETIC",
    materialLanguage: "COMPOSITE",
    patternStyle: "PANEL",
    armorLevel: "LIGHT",
    maskLensStyle: "ANGULAR",
    stats: { stealth: 72, durability: 64, mobility: 88, weightKg: 4.2, estimatedCostUsd: 18400 },
  },
  {
    id: "preview-suit-2",
    codename: "HALFLIGHT",
    designation: "VX-02",
    archetype: "Stealth",
    status: "ACTIVE",
    realityStatus: "CONCEPT",
    modelUrl: null,
    colorPrimary: "#2dd4bf",
    colorSecondary: "#0e1414",
    silhouette: "LEAN",
    materialLanguage: "TEXTILE",
    patternStyle: "SEAM",
    armorLevel: "MINIMAL",
    maskLensStyle: "ROUNDED",
    stats: { stealth: 94, durability: 41, mobility: 91, weightKg: 3.1, estimatedCostUsd: 22100 },
  },
  {
    id: "preview-suit-3",
    codename: "LONGWAVE",
    designation: "VX-03",
    archetype: "Recon",
    status: "DRAFT",
    realityStatus: "CONCEPT",
    modelUrl: null,
    colorPrimary: "#f59e0b",
    colorSecondary: "#16130d",
    silhouette: "ATHLETIC",
    materialLanguage: "COMPOSITE",
    patternStyle: "WEB",
    armorLevel: "LIGHT",
    maskLensStyle: "ANGULAR",
    stats: { stealth: 58, durability: 70, mobility: 79, weightKg: 4.8, estimatedCostUsd: 15900 },
  },
  {
    id: "preview-suit-4",
    codename: "COLDHARBOUR",
    designation: "VX-04",
    archetype: "Endurance",
    status: "ACTIVE",
    realityStatus: "BUILDABLE",
    modelUrl: null,
    colorPrimary: "#60a5fa",
    colorSecondary: "#0c1018",
    silhouette: "HEAVY",
    materialLanguage: "COMPOSITE",
    patternStyle: "PANEL",
    armorLevel: "MEDIUM",
    maskLensStyle: "VISOR",
    stats: { stealth: 44, durability: 92, mobility: 62, weightKg: 7.6, estimatedCostUsd: 31200 },
  },
  {
    id: "preview-suit-5",
    codename: "SLIPSTREAM",
    designation: "VX-05",
    archetype: "Speed",
    status: "ACTIVE",
    realityStatus: "PROTOTYPE",
    modelUrl: null,
    colorPrimary: "#f472b6",
    colorSecondary: "#150f14",
    silhouette: "LEAN",
    materialLanguage: "TEXTILE",
    patternStyle: "SEAM",
    armorLevel: "MINIMAL",
    maskLensStyle: "ROUNDED",
    stats: { stealth: 66, durability: 48, mobility: 96, weightKg: 2.9, estimatedCostUsd: 19800 },
  },
];
