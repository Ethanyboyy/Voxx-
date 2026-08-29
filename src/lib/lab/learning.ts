import {
  recordExperience,
  labConfidenceToMemoryConfidence,
  EXPERIENCE_PROVENANCE,
  type ExperienceAnchor,
} from "@/lib/cognition/experience";
import type { FailureAnalysisEntry } from "@/lib/lab/physics";
import type { LabConfidence } from "@/generated/prisma/enums";

/**
 * The Lab's write-back into VOX's knowledge.
 *
 * The Lab was the largest genuinely-implemented domain in the codebase and
 * also the most isolated one: experiments recorded outcomes and simulations
 * produced real deterministic telemetry, and none of it ever reached Memory,
 * the Knowledge Graph, or a planning pass. Engineering work that VOX could
 * not learn from is engineering work VOX repeats.
 *
 * The hard constraint here is the honesty of the framing. A simulation is a
 * model evaluated against modeled inputs. Its numbers are real numbers, and
 * they are real *outputs of a model* — not measurements, not proof that
 * anything physical happened or would happen. Every simulation memory says
 * so in its first sentence, because the memory is what a future planning
 * pass reads, and by then the context that produced it is gone.
 */

const MAX_LISTED_FAILURES = 4;
const MAX_LISTED_WARNINGS = 3;

export interface ExperimentResultExperienceInput {
  userId: string;
  experimentId: string;
  code: string;
  title: string;
  hypothesis: string;
  /** Raw JSON string as stored on LabExperiment.variables. */
  variablesJson: string | null;
  expectedOutcome: string | null;
  outcome: string;
  learnings: string | null;
  confidence: LabConfidence;
}

/**
 * Records what an experiment actually produced: the hypothesis it was
 * testing, the configuration it ran under, the outcome as recorded, and the
 * confidence the recorder assigned — not a verdict VOX invented.
 */
export async function recordExperimentResultExperience(
  input: ExperimentResultExperienceInput
): Promise<string | null> {
  const parts: string[] = [
    `Lab experiment ${input.code} ("${input.title}") produced a recorded result.`,
    `Hypothesis under test: ${input.hypothesis}`,
  ];

  const config = describeVariables(input.variablesJson);
  if (config) parts.push(`Configuration: ${config}`);

  if (input.expectedOutcome) {
    // Expected vs actual side by side is the part that makes a result
    // useful later — a result that matched expectation and a result that
    // contradicted it teach very different things.
    parts.push(`Expected: ${input.expectedOutcome}`);
  }
  parts.push(`Actual recorded outcome: ${input.outcome}`);
  if (input.learnings) parts.push(`Recorded learnings: ${input.learnings}`);

  parts.push(
    `Confidence in this result, as recorded in the Lab: ${input.confidence}. ` +
      `This is the experimenter's own assessment; VOX has not independently confirmed it.`
  );

  const anchors: ExperienceAnchor[] = [
    {
      entityType: "LAB_EXPERIMENT",
      entityId: input.experimentId,
      label: `${input.code} — ${input.title}`.slice(0, 120),
      description: input.hypothesis.slice(0, 240),
      relation: "produced_result",
    },
  ];

  const result = await recordExperience({
    userId: input.userId,
    content: parts.join("\n"),
    // An experiment result is something VOX observed happening, not a
    // conclusion it drew about the world.
    category: "OBSERVATION",
    confidence: labConfidenceToMemoryConfidence(input.confidence),
    provenance: EXPERIENCE_PROVENANCE.LAB_EXPERIMENT_RESULT,
    anchors,
    event: {
      type: "lab.experiment.result_recorded",
      subjectType: "LabExperiment",
      subjectId: input.experimentId,
      payload: { code: input.code, confidence: input.confidence },
      consequential: true,
    },
  });

  return result?.memoryId ?? null;
}

export interface SimulationRunExperienceInput {
  userId: string;
  simulationId: string;
  simulationName: string;
  runId: string;
  scenarioName: string;
  seed: number;
  durationS: number;
  /** The modeled inputs the run was evaluated against. */
  inputs: {
    gravityMs2: number;
    windMs: number;
    temperatureC: number;
    elevationM: number;
    obstacleCount: number;
    difficulty: string;
    userMassKg: number;
    equipmentMassKg: number;
    mobility: number;
    reactionTimeMs: number;
    skillLevel: number;
  };
  /** The model's outputs. Real numbers; outputs of a model, not measurements. */
  measurements: {
    peakVelocityMs: number;
    peakForceN: number;
    peakThermalLoadC: number;
    fatigueEstimatePct: number;
  };
  warnings: string[];
  failures: FailureAnalysisEntry[];
  suitName: string | null;
}

/**
 * Records a simulation run. Deliberately verbose about provenance: seed and
 * full input configuration are included so the run is reproducible from the
 * memory alone, and the framing sentence is non-negotiable.
 */
export async function recordSimulationRunExperience(input: SimulationRunExperienceInput): Promise<string | null> {
  const { inputs, measurements } = input;

  const header =
    `SIMULATED RESULT — not a physical measurement. VOX ran its deterministic kinematic model ` +
    `(simulation "${input.simulationName}", scenario "${input.scenarioName}", seed ${input.seed}, ` +
    `${input.durationS}s modeled). These numbers are outputs of that model and are not evidence that ` +
    `any physical system was built, tested, or would behave this way in reality.`;

  const configuration =
    `Modeled inputs: gravity ${inputs.gravityMs2} m/s², wind ${inputs.windMs} m/s, ` +
    `temperature ${inputs.temperatureC}°C, elevation ${inputs.elevationM} m, ` +
    `${inputs.obstacleCount} obstacles, difficulty ${inputs.difficulty}; ` +
    `user mass ${inputs.userMassKg} kg, equipment mass ${inputs.equipmentMassKg.toFixed(2)} kg` +
    `${input.suitName ? ` (suit: ${input.suitName})` : ""}, mobility ${inputs.mobility}, ` +
    `reaction time ${inputs.reactionTimeMs} ms, skill level ${inputs.skillLevel}.`;

  const results =
    `Model outputs: peak velocity ${measurements.peakVelocityMs.toFixed(2)} m/s, ` +
    `peak force ${measurements.peakForceN.toFixed(0)} N, ` +
    `peak thermal load ${measurements.peakThermalLoadC.toFixed(1)}°C, ` +
    `fatigue estimate ${measurements.fatigueEstimatePct.toFixed(0)}%.`;

  const parts = [header, configuration, results];

  if (input.failures.length > 0) {
    const listed = input.failures
      .slice(0, MAX_LISTED_FAILURES)
      .map((f) => `- ${f.category}: ${f.explanation} Suggested change: ${f.suggestion}`)
      .join("\n");
    parts.push(`The model exceeded ${input.failures.length} threshold(s):\n${listed}`);
  } else {
    parts.push(`The model exceeded no thresholds under these inputs.`);
  }

  if (input.warnings.length > 0) {
    parts.push(`Model warnings:\n${input.warnings.slice(0, MAX_LISTED_WARNINGS).map((w) => `- ${w}`).join("\n")}`);
  }

  // The uncertainty statement is part of the record, not a disclaimer bolted
  // on for the UI. A future planning pass reads this text and nothing else.
  parts.push(
    `Uncertainty: this is a kinematic approximation over the listed inputs only. ` +
      `Effects it does not model — material fatigue, collision dynamics, control-system behaviour, ` +
      `manufacturing tolerance — are absent from these figures, not shown to be negligible.`
  );

  const anchors: ExperienceAnchor[] = [
    {
      entityType: "LAB_SIMULATION",
      entityId: input.simulationId,
      label: `${input.simulationName} — ${input.scenarioName}`.slice(0, 120),
      description: `Deterministic kinematic model. Latest run seed ${input.seed}.`,
      relation: "simulated",
    },
  ];

  const result = await recordExperience({
    userId: input.userId,
    content: parts.join("\n"),
    category: "OBSERVATION",
    // Always LOW. A model output is the weakest form of evidence VOX holds,
    // regardless of how precise its numbers look, and precision is exactly
    // what makes simulation output easy to over-trust later.
    confidence: "LOW",
    provenance: EXPERIENCE_PROVENANCE.LAB_SIMULATION_RUN,
    anchors,
    event: {
      type: input.failures.length > 0 ? "lab.simulation.result_recorded_failed" : "lab.simulation.result_recorded",
      subjectType: "LabSimulationRun",
      subjectId: input.runId,
      payload: {
        simulationId: input.simulationId,
        seed: input.seed,
        failureCategories: input.failures.map((f) => f.category),
      },
      consequential: true,
    },
  });

  return result?.memoryId ?? null;
}

/**
 * Renders LabExperiment.variables (a JSON array of {name, value, unit}) as
 * readable text. Returns null for absent or malformed data rather than
 * guessing at a shape — a configuration that cannot be read is better
 * omitted than misreported.
 */
function describeVariables(variablesJson: string | null): string | null {
  if (!variablesJson) return null;
  try {
    const parsed: unknown = JSON.parse(variablesJson);
    if (!Array.isArray(parsed)) return null;
    const rendered = parsed
      .filter((v): v is { name: string; value: string; unit?: string } => {
        return (
          typeof v === "object" &&
          v !== null &&
          typeof (v as { name?: unknown }).name === "string" &&
          typeof (v as { value?: unknown }).value === "string"
        );
      })
      .map((v) => `${v.name} = ${v.value}${v.unit ? ` ${v.unit}` : ""}`);
    return rendered.length > 0 ? rendered.join(", ") : null;
  } catch {
    return null;
  }
}
