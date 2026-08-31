/**
 * The orchestrator: turning a CapabilityPlan into a run that actually happens.
 *
 * Routing produced a correct plan and every stage worked, but nothing walked
 * the plan — so the acceptance sentence ("make three variations, pick the
 * best, build it in, then film it") stopped at a list of intentions.
 *
 * It is a COORDINATION LAYER, not an execution engine. AgentRun/AgentStep and
 * agents/executor.ts already do ordered execution, permission gating, retries,
 * step-output references and pause/resume; building a second engine for
 * capability plans would mean two things to keep correct and two places for a
 * permission check to be forgotten. So the orchestrator's job is confined to
 * what the executor genuinely does not do:
 *
 *   - decide WHICH steps a routed plan becomes
 *   - wire each step's inputs to what an earlier step will produce
 *   - persist the trace link and the plan, so a restart can reconstruct both
 *   - emit the capability-level lifecycle events
 *   - hand over to the executor, and hand back what it returns
 *
 * Everything else — running a step, checking `checkCapability()`, parking at
 * WAITING_FOR_PERMISSION, resuming from `currentStep`, skipping steps already
 * COMPLETED — is the executor's, unchanged.
 *
 * ORDERING IS THE DEPENDENCY MODEL. A step that needs an earlier step's output
 * references it, the executor fails any step whose reference cannot resolve,
 * and a failed step stops the run before its dependents are reached. That is a
 * complete dependency graph for plans that are linear, which routed plans are;
 * a separate DAG would be a second scheduler with nothing extra to schedule.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { startAgentRun, resumeAgentRun, cancelAgentRun } from "@/lib/agents/service";
import { planObjective, type PlanStep } from "@/lib/agents/planner";
import { offsetStepReferences } from "@/lib/agents/references";
import { routeRequest, type RoutingContext } from "@/lib/capabilities/router";
import { getCapabilityAvailability } from "@/lib/capabilities/availability";
import { newTraceId } from "@/lib/capabilities/ledger";
import type { Capability, CapabilityPlan } from "@/lib/capabilities/types";
import { LAB_SUBJECT_TYPES } from "@/lib/lab/artifacts";

export interface DriveOptions {
  userId: string;
  request: string;
  /** Overrides for what the router is allowed to assume. */
  context?: Omit<RoutingContext, "request">;
  /** Artifact versions already in scope — a pasted reference, a chosen concept. */
  referenceVersionIds?: string[];
  subjectType?: string;
  subjectId?: string;
  projectId?: string;
  /** Groups every provider call in this task. Generated when absent. */
  traceId?: string;
}

export interface DriveResult {
  plan: CapabilityPlan;
  traceId: string;
  /** Null when the plan was empty — VOX should simply answer. */
  runId: string | null;
  steps: PlanStep[];
}

/** Number words the request might use, up to the point where asking for more
 * variations stops being a design exercise and starts being a spend problem. */
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
};

const MAX_VARIATIONS = 6;

/**
 * How many candidates the user actually asked for.
 *
 * Read from the request rather than assumed, because the difference between
 * one image and three is the difference between one provider charge and three.
 * Only counts that are attached to a variation noun are honoured — "three
 * variations" is an instruction, but the "three" in "the Mark Three suit" is
 * a name, and generating three images from it would be spending money on a
 * misreading.
 */
export function requestedVariations(request: string): number {
  // The `(?:\w+\s+){0,2}` mirrors the router's own VARIATION pattern: a real
  // request says what it wants variations OF between the count and the noun
  // ("three SUIT concepts"), and requiring adjacency misses it entirely.
  const pattern = /\b(\d+|one|two|three|four|five|six)\s+(?:\w+\s+){0,2}(variations?|versions?|concepts?|options?|designs?|takes?|ideas?)\b/i;
  const match = pattern.exec(request);
  if (!match) return 1;

  const raw = match[1].toLowerCase();
  const count = NUMBER_WORDS[raw] ?? Number.parseInt(raw, 10);
  if (!Number.isFinite(count) || count < 1) return 1;
  return Math.min(count, MAX_VARIATIONS);
}

/**
 * The order stages have to run in, whatever order they were planned in.
 *
 * The router decides WHICH capabilities a request needs; it emits them in the
 * order its own checks happen to run, which is not the order they can execute
 * in. "Create three concepts, pick the strongest, then build it into the Suit
 * Bay" routes to EXECUTION before IMAGE_GENERATION — and building the chosen
 * design before anything has been chosen is not a plan, it is a plan-shaped
 * object. Sequencing is the orchestrator's job precisely because it is the
 * layer that knows what consumes what.
 *
 * Gather, produce, judge, apply, film. A second VISUAL_QA is ranked AFTER
 * execution rather than beside the first, because a request that asks for both
 * wants the media checked and then the implementation checked — and an
 * implementation cannot be checked before it exists.
 */
const STAGE_RANK: Record<Capability, number> = {
  MEMORY: 0,
  RESEARCH: 1,
  IMAGE_GENERATION: 2,
  IMAGE_EDIT: 2,
  MODEL_3D: 2,
  VISUAL_QA: 3,
  EXECUTION: 4,
  VIDEO_GENERATION: 6,
};

const POST_EXECUTION_QA_RANK = 5;

/** Sorts a routed plan into an order that can actually run. */
export function sequencePlan<T extends { capability: Capability }>(steps: T[]): T[] {
  let qaSeen = 0;
  const ranked = steps.map((step, index) => {
    let rank = STAGE_RANK[step.capability];
    if (step.capability === "VISUAL_QA") {
      // The first review judges what was produced; a later one judges what was
      // built, which has to wait for the building.
      if (qaSeen > 0) rank = POST_EXECUTION_QA_RANK;
      qaSeen += 1;
    }
    return { step, rank, index };
  });

  // Stable: equal ranks keep the router's own order, so nothing is reshuffled
  // for the sake of it.
  ranked.sort((a, b) => (a.rank - b.rank) || (a.index - b.index));
  return ranked.map((entry) => entry.step);
}

/**
 * Words that ask for the result to be made BETTER, not merely produced.
 *
 * This is the signal that turns a one-shot generation into a bounded loop, so
 * it is deliberately narrow. Iterating costs a provider call per attempt, and
 * inferring "improve it" from a request that never said so would spend the
 * user's money on an assumption.
 */
const REFINEMENT_INTENT = [
  "improve", "refine", "iterate", "make it better", "better version",
  "if necessary", "if needed", "until it", "keep going until",
  "polish", "fix it until", "get it right",
];

/**
 * Whether the request asks VOX to keep working at the result.
 *
 * Two independent signals, either of which is enough:
 *
 *   - an explicit refinement verb ("improve the strongest design");
 *   - a REQUIRED quality bar from the router. The router already marks
 *     VISUAL_QA non-optional when the request states a bar to clear, and
 *     "make sure it matches the reference" is an instruction to keep working
 *     until it does, not an instruction to check once and report failure.
 */
export function wantsRefinement(request: string, qaIsRequired: boolean): boolean {
  const text = request.toLowerCase();
  return qaIsRequired || REFINEMENT_INTENT.some((phrase) => text.includes(phrase));
}

/** True when a subject is one the Lab actually renders. */
function isLabSubject(subjectType: string | undefined): boolean {
  return !!subjectType && (LAB_SUBJECT_TYPES as readonly string[]).includes(subjectType);
}

interface ExpansionState {
  /** Index of the step whose output later stages consume. */
  imageStepIndex: number | null;
  /** Index of the step that approved a specific version, if any. */
  selectionStepIndex: number | null;
  /** Index of the bounded improvement loop, when one was planned. */
  refineStepIndex: number | null;
  /** How many candidates the image step was asked for. */
  variations: number;
  /** Whether the request asks VOX to keep working until the result is good. */
  refine: boolean;
  nextIndex: number;
}

/**
 * A reference to the artifact version a later step should act on.
 *
 * Ordered by how settled the choice is: a refined version was improved until
 * it passed, a selected one won a comparison, a generated one is merely the
 * first thing that came back. A later stage should film or attach the most
 * settled result available, never an earlier draft of it.
 */
function chosenVersionReference(state: ExpansionState): string | null {
  if (state.refineStepIndex !== null) {
    return `{{step${state.refineStepIndex}.output.selectedVersionId}}`;
  }
  if (state.selectionStepIndex !== null) {
    return `{{step${state.selectionStepIndex}.output.selectedVersionId}}`;
  }
  if (state.imageStepIndex !== null) {
    return `{{step${state.imageStepIndex}.output.versions.0.versionId}}`;
  }
  return null;
}

/** The artifact a later stage should attach or extend, by the same ordering. */
function chosenArtifactReference(state: ExpansionState): string | null {
  if (state.refineStepIndex !== null) return `{{step${state.refineStepIndex}.output.artifactId}}`;
  if (state.selectionStepIndex !== null) return `{{step${state.selectionStepIndex}.output.artifactId}}`;
  if (state.imageStepIndex !== null) return `{{step${state.imageStepIndex}.output.artifactId}}`;
  return null;
}

/**
 * Expands one capability into concrete steps.
 *
 * `state` is threaded rather than recomputed because a reference has to name
 * the RIGHT step: in a plan that generates, selects and then films, the video
 * stage must point at the SELECTED version, not at the first one generated.
 */
function stepsForCapability(
  capability: Capability,
  options: DriveOptions,
  state: ExpansionState,
): PlanStep[] {
  const references = options.referenceVersionIds ?? [];

  switch (capability) {
    case "MEMORY":
      return [{
        description: `Recall what VOX already knows relevant to: ${options.request.slice(0, 160)}`,
        toolName: "memory.search",
        input: { query: options.request.slice(0, 500) },
      }];

    case "RESEARCH":
      return [{
        description: "Research what is needed to answer this.",
        toolName: "research.run",
        input: { query: options.request.slice(0, 500) },
      }];

    case "IMAGE_GENERATION":
    case "IMAGE_EDIT":
      // One candidate that has to be GOOD is the improvement loop's own shape:
      // generate, judge, revise, repeat until it clears the bar. Emitting a
      // separate generate step and then a separate review step would produce
      // exactly one attempt and no way to act on the verdict.
      if (state.variations === 1 && state.refine) {
        return [{
          description: "Generate the image, review it, and revise until it clears the bar.",
          toolName: "media.image.refine",
          input: {
            requirements: options.request,
            prompt: options.request,
            subjectType: options.subjectType,
            subjectId: options.subjectId,
            referenceVersionIds: references,
            traceId: options.traceId,
          },
        }];
      }

      return [{
        description:
          state.variations > 1
            ? `Generate ${state.variations} variations.`
            : capability === "IMAGE_EDIT"
              ? "Edit the reference image as requested."
              : "Generate the requested image.",
        toolName: "media.image.generate",
        input: {
          prompt: options.request,
          subjectType: options.subjectType,
          subjectId: options.subjectId,
          // An edit needs its reference; a fresh generation may still have one
          // to condition on, and passing it also records the lineage.
          referenceVersionIds: references,
          count: state.variations,
          traceId: options.traceId,
        },
      }];

    case "VIDEO_GENERATION": {
      const source = chosenVersionReference(state);
      return [{
        description: "Generate the cinematic sequence.",
        toolName: "media.video.generate",
        input: {
          prompt: options.request,
          subjectType: options.subjectType,
          subjectId: options.subjectId,
          // Prefer what this run chose, then what it generated, then what was
          // already in scope. Resolved at execution time, not at planning time.
          referenceVersionIds: source ? [source] : references,
          traceId: options.traceId,
        },
      }];
    }

    case "VISUAL_QA": {
      // The refinement loop reviews every attempt as it goes, so a review step
      // after it would pay a second time to learn what it already recorded.
      if (state.refineStepIndex !== null) return [];

      // With several candidates in play, the review IS the comparison: judging
      // each one and approving the strongest answers "is this good?" and
      // "which of these?" in a single pass. Emitting a separate review after a
      // selection that already reviewed everything would just pay twice.
      if (state.imageStepIndex !== null && state.variations > 1) {
        const compare: PlanStep = {
          description: `Compare the ${state.variations} candidates and approve the strongest.`,
          toolName: "artifact.select_best",
          input: {
            artifactId: `{{step${state.imageStepIndex}.output.artifactId}}`,
            requirements: options.request,
            referenceVersionIds: references,
            traceId: options.traceId,
          },
        };

        if (!state.refine) return [compare];

        // "Make three, then improve the strongest" — comparison first, then
        // the loop, on the artifact the comparison approved. The loop's own
        // first act is a review, so a winner that already passes costs nothing
        // further; only a winner that does not gets revised.
        return [
          compare,
          {
            description: "Improve the chosen design until it clears the bar.",
            toolName: "media.image.refine",
            input: {
              // Resolved at execution time from the comparison's output — the
              // artifact does not exist yet at planning time.
              artifactId: `{{step${state.nextIndex}.output.artifactId}}`,
              requirements: options.request,
              prompt: options.request,
              subjectType: options.subjectType,
              subjectId: options.subjectId,
              referenceVersionIds: references,
              traceId: options.traceId,
            },
          },
        ];
      }

      // Nothing produced in this run and nothing supplied means there is
      // literally no image to judge. Emitting a step that would fail on a
      // missing reference is worse than emitting none.
      const candidate = chosenVersionReference(state) ?? references[0];
      if (!candidate) return [];

      return [{
        description: "Check the result against what was asked for.",
        toolName: "qa.visual_review",
        input: {
          requirements: options.request,
          candidateVersionId: candidate,
          // The reference is only a reference when it is not also the thing
          // being judged.
          referenceVersionIds: state.imageStepIndex !== null ? references : references.slice(1),
          traceId: options.traceId,
        },
      }];
    }

    case "MODEL_3D":
      // No tool wraps the generation provider yet, so this stage is described
      // rather than bound. The executor records it and moves on instead of
      // failing on an unknown tool name.
      return [{ description: "Produce or update the 3D asset.", toolName: null }];

    case "EXECUTION":
      // Filled in by the real planner — see driveRequest.
      return [];
  }
}

/**
 * Routes a request, expands the plan into steps, and starts a run.
 *
 * Returns without starting anything when the plan is empty, which is the
 * router saying "just answer" — creating an AgentRun with no steps would put a
 * meaningless entry in the activity feed for every ordinary question.
 */
export async function driveRequest(options: DriveOptions): Promise<DriveResult> {
  const traceId = options.traceId ?? newTraceId();
  const resolved: DriveOptions = { ...options, traceId };

  await recordEvent({
    userId: options.userId,
    type: "capability.requested",
    subjectType: "CapabilityPlan",
    subjectId: traceId,
    payload: { request: options.request.slice(0, 300), traceId },
  });

  const plan = await routeRequest({
    request: options.request,
    hasVisualReference: (options.referenceVersionIds?.length ?? 0) > 0,
    ...options.context,
    // Real availability wins over anything a caller assumed — it is spread
    // LAST deliberately. A caller may declare a capability the providers know
    // nothing about (EXECUTION, MEMORY, RESEARCH, VISUAL_QA have no provider
    // row), but it can never talk the router into planning a provider-backed
    // stage that the provider itself reports as unconfigured.
    available: { ...options.context?.available, ...getCapabilityAvailability() },
  });

  await recordEvent({
    userId: options.userId,
    type: "capability.routed",
    subjectType: "CapabilityPlan",
    subjectId: traceId,
    payload: {
      traceId,
      strategy: plan.strategy,
      degraded: plan.degraded,
      // Operational metadata only — capability and a one-line reason. No
      // reasoning is stored; see the router's own note on this.
      steps: plan.steps.map((s) => ({ capability: s.capability, reason: s.reason, optional: s.optional })),
      notes: plan.notes,
    },
  });

  if (plan.steps.length === 0) {
    return { plan, traceId, runId: null, steps: [] };
  }

  const steps: PlanStep[] = [];
  // A REQUIRED review is the router saying the request states a bar to clear.
  // Clearing a bar means working at it until it is cleared, which is what
  // turns a one-shot generation into a bounded loop.
  const qaIsRequired = plan.steps.some((s) => s.capability === "VISUAL_QA" && !s.optional);
  const state: ExpansionState = {
    imageStepIndex: null,
    selectionStepIndex: null,
    refineStepIndex: null,
    variations: requestedVariations(options.request),
    refine: wantsRefinement(options.request, qaIsRequired),
    nextIndex: 0,
  };

  for (const planStep of sequencePlan(plan.steps)) {
    if (planStep.capability === "EXECUTION") {
      // The real planner decides which workspace tools an engineering task
      // needs. Duplicating that here would be a second, worse planner.
      //
      // Its steps are renumbered by however many steps already precede them.
      // The planner counts from its own zero, so without this a plan that
      // recalls memory before building would have every `{{step0.output}}` in
      // the engineering half pointing at the memory lookup — a reference that
      // resolves, to the wrong value, with nothing failing.
      //
      // The offset is the position the BLOCK starts at, identical for every
      // step in it — planner step 3 referencing planner step 1 must land on
      // base+1, not on base+3.
      const base = state.nextIndex;
      const expanded = await planObjective(options.request);
      for (const step of expanded) {
        steps.push(offsetStepReferences(step, base));
        state.nextIndex += 1;
      }
      continue;
    }

    const expanded = stepsForCapability(planStep.capability, resolved, state);
    for (const step of expanded) {
      if (planStep.capability === "IMAGE_GENERATION" || planStep.capability === "IMAGE_EDIT") {
        state.imageStepIndex = state.nextIndex;
      }
      if (step.toolName === "artifact.select_best") {
        state.selectionStepIndex = state.nextIndex;
      }
      if (step.toolName === "media.image.refine") {
        state.refineStepIndex = state.nextIndex;
      }
      steps.push(step);
      state.nextIndex += 1;
    }
  }

  // Phase 18: putting the chosen result where the Lab can see it. Only when
  // the subject is genuinely a Lab subject and something was actually chosen —
  // attaching a version nothing selected would promote an arbitrary candidate.
  const finalArtifact = chosenArtifactReference(state);
  const somethingWasChosen = state.refineStepIndex !== null || state.selectionStepIndex !== null;
  if (isLabSubject(options.subjectType) && options.subjectId && somethingWasChosen && finalArtifact) {
    steps.push({
      description: `Attach the approved design to the ${options.subjectType}.`,
      toolName: "lab.attach_artifact",
      input: {
        artifactId: finalArtifact,
        subjectType: options.subjectType,
        subjectId: options.subjectId,
        traceId,
      },
    });
    state.nextIndex += 1;
  }

  if (steps.length === 0) {
    return { plan, traceId, runId: null, steps: [] };
  }

  const run = await startAgentRun({
    userId: options.userId,
    objective: options.request,
    projectId: options.projectId,
    steps,
    // Persisted, not merely passed: this is what lets a restarted process get
    // from the run back to the provider calls it made.
    traceId,
    plan: JSON.stringify({
      strategy: plan.strategy,
      degraded: plan.degraded,
      notes: plan.notes,
      steps: plan.steps.map((s) => ({ capability: s.capability, reason: s.reason, optional: s.optional })),
    }),
  });

  await recordEvent({
    userId: options.userId,
    type: "capability.run_started",
    subjectType: "AgentRun",
    subjectId: run.id,
    // The one place traceId and runId appear together in the event log, which
    // is what lets the activity feed join a run to its provider spend.
    payload: { traceId, steps: steps.length, status: run.status },
  });

  return { plan, traceId, runId: run.id, steps };
}

/**
 * Continues a run that stopped for a permission.
 *
 * Everything that makes this safe already exists in the executor: it rebuilds
 * step outputs from the persisted rows, skips anything COMPLETED, and re-runs
 * the real `checkCapability()` — so a still-ungranted permission parks the run
 * again rather than slipping through. What the orchestrator adds is the event,
 * and refusing to touch a run that is not actually waiting.
 *
 * There is deliberately no "force" path. If resuming does not work, the
 * permission has not been granted, and the answer is to grant it.
 */
export async function resumeRun(userId: string, runId: string) {
  const before = await db.agentRun.findFirst({
    where: { id: runId, userId },
    select: { id: true, status: true, currentStep: true, traceId: true },
  });
  if (!before) return null;
  if (before.status !== "WAITING_FOR_PERMISSION") return before;

  await recordEvent({
    userId,
    type: "capability.run_resumed",
    subjectType: "AgentRun",
    subjectId: runId,
    payload: { traceId: before.traceId, fromStep: before.currentStep },
  });

  return resumeAgentRun(userId, runId);
}

/**
 * Stops a run without destroying what it already did.
 *
 * `cancelAgentRun` marks the unreached steps SKIPPED and the run CANCELLED. It
 * deletes nothing — completed steps keep their outputs, and every artifact and
 * lineage row written before the cancellation stays exactly where it is. That
 * matters because the expensive half of a cancelled run is usually the half
 * that already succeeded.
 */
export async function cancelRun(userId: string, runId: string) {
  const run = await db.agentRun.findFirst({
    where: { id: runId, userId },
    select: { id: true, status: true, traceId: true },
  });
  if (!run) return null;

  const cancelled = await cancelAgentRun(userId, runId);
  await recordEvent({
    userId,
    type: "capability.run_cancelled",
    subjectType: "AgentRun",
    subjectId: runId,
    payload: { traceId: run.traceId },
    consequential: true,
  });
  return cancelled;
}
