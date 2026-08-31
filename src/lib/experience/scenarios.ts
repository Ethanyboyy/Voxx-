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
  | "wrist-reassembled"
  | "progress-running"
  | "progress-waiting"
  | "progress-complete";

export interface ScenarioDefinition {
  id: ScenarioId;
  label: string;
  /** Which surface renders. */
  surface: "brain" | "suit-bay" | "wrist" | "progress";
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
  "progress-running": { id: "progress-running", label: "Progress — working", surface: "progress", brainState: "executing", eventTypes: [] },
  "progress-waiting": { id: "progress-waiting", label: "Progress — needs permission", surface: "progress", brainState: "waiting", eventTypes: [] },
  "progress-complete": { id: "progress-complete", label: "Progress — finished", surface: "progress", brainState: "idle", eventTypes: [] },
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
    // The one suit with an authored bundle. Everything else in this list is
    // deliberately without one, so the scenarios also cover the fallback.
    assetId: "vx-01-meridian",
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

/**
 * Synthetic progress frames for the `progress` surface.
 *
 * These are invented, like everything else in this module — no run, no
 * provider call and no artifact behind them. Their job is to let the three
 * states the panel has to get right be inspected side by side: work in
 * flight, work parked on a permission, and work finished with its cost known.
 *
 * The finished frame deliberately mixes a priced call with an unpriced one,
 * because "$0.0042+" versus "$0.0042" is exactly the distinction the panel
 * exists to keep honest, and it is invisible in a scenario where every call
 * reported a price.
 */
export function scenarioProgress(scenario: ScenarioDefinition) {
  const base = {
    traceId: `preview-${scenario.id}`,
    runId: "preview-run",
    objective: "Make three variations of the mask, pick the best, then build it in",
    plan: {
      strategy: "deterministic",
      degraded: false,
      notes: [] as string[],
      steps: [
        { capability: "MEMORY", reason: "The request refers to earlier decisions.", optional: false },
        { capability: "IMAGE_GENERATION", reason: "The user asked for visual concepts.", optional: false },
        { capability: "VISUAL_QA", reason: "Several candidates need comparing.", optional: false },
      ],
    },
    awaiting: null as { capability: string; requiredLevel: string; toolName: string | null; description: string } | null,
    reviews: [] as { artifactId: string; version: number; status: "PASS" | "FAIL"; score: number; issues: string[]; at: string }[],
    iterations: [] as { artifactId: string; attempts: { attempt: number; of: number; status: "PASS" | "FAIL" | "RUNNING"; score: number | null }[]; limit: number }[],
    activity: [] as { id: string; type: string; at: string; detail: string | null }[],
    artifacts: [] as {
      versionId: string; artifactId: string; artifactLabel: string; kind: string;
      version: number; url: string; mimeType: string; capability: string;
      provider: string; state: "GENERATED" | "QA_FAILED" | "APPROVED" | "ACTIVE" | "SUPERSEDED";
      score: number | null;
    }[],
    unpricedCalls: 0,
  };

  if (scenario.id === "progress-waiting") {
    return {
      ...base,
      status: "WAITING_FOR_PERMISSION" as const,
      awaiting: {
        capability: "media.image.generate",
        requiredLevel: "ACT",
        toolName: "media.image.generate",
        description: "Generate three variations.",
      },
      steps: [
        { order: 0, description: "Recall what was decided about the mask", toolName: "memory.search", capability: "memory.search", requiredLevel: "OBSERVE", status: "COMPLETED" as const, error: null, durationMs: 240, retryCount: 0 },
        { order: 1, description: "Generate three variations", toolName: "media.image.generate", capability: "media.image.generate", requiredLevel: "ACT", status: "WAITING_FOR_PERMISSION" as const, error: null, durationMs: null, retryCount: 0 },
        { order: 2, description: "Check the result against what was asked for", toolName: "qa.visual_review", capability: "qa.visual_review", requiredLevel: "RECOMMEND", status: "PENDING" as const, error: null, durationMs: null, retryCount: 0 },
      ],
      providerCalls: [],
      costUsd: null,
      live: true,
    };
  }

  if (scenario.id === "progress-complete") {
    return {
      ...base,
      status: "COMPLETED" as const,
      unpricedCalls: 1,
      steps: [
        { order: 0, description: "Recall what was decided about the mask", toolName: "memory.search", capability: "memory.search", requiredLevel: "OBSERVE", status: "COMPLETED" as const, error: null, durationMs: 240, retryCount: 0 },
        { order: 1, description: "Generate three variations", toolName: "media.image.generate", capability: "media.image.generate", requiredLevel: "ACT", status: "COMPLETED" as const, error: null, durationMs: 8420, retryCount: 0 },
        { order: 2, description: "Check the result against what was asked for", toolName: "qa.visual_review", capability: "qa.visual_review", requiredLevel: "RECOMMEND", status: "COMPLETED" as const, error: null, durationMs: 3100, retryCount: 0 },
        { order: 3, description: "Apply the chosen lens profile to the Suit Bay build", toolName: "workspace.patch", capability: "workspace.write", requiredLevel: "ACT", status: "COMPLETED" as const, error: null, durationMs: 90, retryCount: 0 },
      ],
      providerCalls: [
        { id: "preview-call-1", capability: "IMAGE_GENERATION", provider: "gemini", model: "nano-banana-2", status: "SUCCEEDED" as const, error: null, durationMs: 8420, costUsd: 0.0042, startedAt: "2026-01-01T12:00:00.000Z" },
        { id: "preview-call-2", capability: "VISUAL_QA", provider: "anthropic", model: "claude-opus-5", status: "SUCCEEDED" as const, error: null, durationMs: 3100, costUsd: null, startedAt: "2026-01-01T12:00:09.000Z" },
      ],
      costUsd: 0.0042,
      // Three candidates in the three states a comparison actually produces:
      // two rejected and kept, one approved and live.
      artifacts: [
        { versionId: "pv1", artifactId: "preview-artifact", artifactLabel: "Mask concept", kind: "IMAGE", version: 1, url: "", mimeType: "application/octet-stream", capability: "IMAGE_GENERATION", provider: "gemini", state: "QA_FAILED" as const, score: 71 },
        { versionId: "pv2", artifactId: "preview-artifact", artifactLabel: "Mask concept", kind: "IMAGE", version: 2, url: "", mimeType: "application/octet-stream", capability: "IMAGE_GENERATION", provider: "gemini", state: "QA_FAILED" as const, score: 78 },
        { versionId: "pv3", artifactId: "preview-artifact", artifactLabel: "Mask concept", kind: "IMAGE", version: 3, url: "", mimeType: "application/octet-stream", capability: "IMAGE_GENERATION", provider: "gemini", state: "ACTIVE" as const, score: 94 },
      ],
      reviews: [
        { artifactId: "preview-artifact", version: 1, status: "FAIL" as const, score: 71, issues: ["Material still reads as armored"], at: "2026-01-01T12:00:09.000Z" },
        { artifactId: "preview-artifact", version: 2, status: "FAIL" as const, score: 78, issues: ["Shoulder silhouette too rigid"], at: "2026-01-01T12:00:10.000Z" },
        { artifactId: "preview-artifact", version: 3, status: "PASS" as const, score: 94, issues: [], at: "2026-01-01T12:00:11.000Z" },
      ],
      // Deliberately no iterations here: this scenario is a SELECTION among
      // three candidates, not a retry loop. The quality-loop panel belongs to
      // the running scenario, and showing both with the same numbers made two
      // distinct panels read as duplicates.
      iterations: [],
      activity: [
        { id: "a1", type: "capability.requested", at: "2026-01-01T12:00:00.000Z", detail: null },
        { id: "a2", type: "capability.routed", at: "2026-01-01T12:00:01.000Z", detail: null },
        { id: "a3", type: "artifact.version_created", at: "2026-01-01T12:00:08.000Z", detail: null },
        { id: "a4", type: "artifact.selected", at: "2026-01-01T12:00:11.000Z", detail: "version 3" },
        { id: "a5", type: "agent.run.completed", at: "2026-01-01T12:00:12.000Z", detail: null },
      ],
      live: false,
    };
  }

  return {
    ...base,
    status: "RUNNING" as const,
    steps: [
      { order: 0, description: "Recall what was decided about the mask", toolName: "memory.search", capability: "memory.search", requiredLevel: "OBSERVE", status: "COMPLETED" as const, error: null, durationMs: 240, retryCount: 0 },
      { order: 1, description: "Generate three variations", toolName: "media.image.generate", capability: "media.image.generate", requiredLevel: "ACT", status: "RUNNING" as const, error: null, durationMs: null, retryCount: 0 },
      { order: 2, description: "Check the result against what was asked for", toolName: "qa.visual_review", capability: "qa.visual_review", requiredLevel: "RECOMMEND", status: "PENDING" as const, error: null, durationMs: null, retryCount: 0 },
      { order: 3, description: "Apply the chosen lens profile to the Suit Bay build", toolName: "workspace.patch", capability: "workspace.write", requiredLevel: "ACT", status: "PENDING" as const, error: null, durationMs: null, retryCount: 0 },
    ],
    providerCalls: [
      { id: "preview-call-1", capability: "IMAGE_GENERATION", provider: "gemini", model: "nano-banana-2", status: "RUNNING" as const, error: null, durationMs: null, costUsd: null, startedAt: "2026-01-01T12:00:00.000Z" },
    ],
    costUsd: null,
    unpricedCalls: 1,
    live: true,
  };
}
