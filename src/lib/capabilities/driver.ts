/**
 * The driver: turning a CapabilityPlan into a run that actually happens.
 *
 * This is the piece that was missing. Routing produced a correct plan and
 * every stage worked, but nothing walked the plan — so the acceptance sentence
 * ("make three variations, pick the best, build it in, then film it") stopped
 * at a list of intentions.
 *
 * It is a TRANSLATION LAYER, not an execution engine. AgentRun/AgentStep and
 * agents/executor.ts already do ordered execution, permission gating,
 * retries, step-output references and pause/resume; building a second engine
 * for capability plans would mean two things to keep correct and two places
 * for a permission check to be forgotten. So the driver's whole job is to
 * express each capability as a step the existing executor already knows how to
 * run, and hand it over.
 *
 * The one genuinely new behaviour is CHAINING: a step that consumes what an
 * earlier one produced references it with the executor's own
 * `{{stepN.output...}}` syntax. That is why the review step can name an
 * artifact version the generation step had not created yet at planning time.
 */

import { recordEvent } from "@/lib/observability/events";
import { startAgentRun } from "@/lib/agents/service";
import { planObjective, type PlanStep } from "@/lib/agents/planner";
import { offsetStepReferences } from "@/lib/agents/references";
import { routeRequest, type RoutingContext } from "@/lib/capabilities/router";
import { getCapabilityAvailability } from "@/lib/capabilities/availability";
import { newTraceId } from "@/lib/capabilities/ledger";
import type { Capability, CapabilityPlan } from "@/lib/capabilities/types";

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

/**
 * Expands one capability into concrete steps.
 *
 * `previousImageStep` is the index of the step whose output later stages
 * consume. It is threaded rather than recomputed because the reference has to
 * name the RIGHT step: in a plan that both generates and reviews, the reviewer
 * must point at the generation, not at the memory lookup that preceded it.
 */
function stepsForCapability(
  capability: Capability,
  options: DriveOptions,
  state: { imageStepIndex: number | null; nextIndex: number },
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
      return [{
        description: capability === "IMAGE_EDIT" ? "Edit the reference image as requested." : "Generate the requested image.",
        toolName: "media.image.generate",
        input: {
          prompt: options.request,
          subjectType: options.subjectType,
          subjectId: options.subjectId,
          // An edit needs its reference; a fresh generation may still have one
          // to condition on, and passing it also records the lineage.
          referenceVersionIds: references,
          traceId: options.traceId,
        },
      }];

    case "VIDEO_GENERATION":
      return [{
        description: "Generate the cinematic sequence.",
        toolName: "media.video.generate",
        input: {
          prompt: options.request,
          subjectType: options.subjectType,
          subjectId: options.subjectId,
          // Prefer the image this run just produced; fall back to what was
          // already in scope. This is the chaining the brief describes, and it
          // resolves at execution time rather than at planning time.
          referenceVersionIds:
            state.imageStepIndex !== null
              ? [`{{step${state.imageStepIndex}.output.versions.0.versionId}}`]
              : references,
          traceId: options.traceId,
        },
      }];

    case "VISUAL_QA": {
      // Nothing produced in this run and nothing supplied means there is
      // literally no image to judge. Emitting a step that would fail on a
      // missing reference is worse than emitting none.
      const candidate =
        state.imageStepIndex !== null
          ? `{{step${state.imageStepIndex}.output.versions.0.versionId}}`
          : references[0];
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
  const state = { imageStepIndex: null as number | null, nextIndex: 0 };

  for (const planStep of plan.steps) {
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
      steps.push(step);
      state.nextIndex += 1;
    }
  }

  if (steps.length === 0) {
    return { plan, traceId, runId: null, steps: [] };
  }

  const run = await startAgentRun({
    userId: options.userId,
    objective: options.request,
    projectId: options.projectId,
    steps,
  });

  return { plan, traceId, runId: run.id, steps };
}
