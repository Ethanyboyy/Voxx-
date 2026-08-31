/**
 * What is happening right now, in one read.
 *
 * A driven request leaves its record in three places: the AgentRun and its
 * steps (what VOX decided to do, and how far it got), the CapabilityRun rows
 * (which provider was actually called, what it cost, how long it took), and
 * the ArtifactVersions those calls produced. The progress surface needs all
 * three at once, so assembling them belongs here rather than in a component
 * making three fetches and guessing how they line up.
 *
 * The join key between the run and the provider calls is `traceId`, not
 * `agentRunId`: a capability tool receives its traceId through its own input
 * and has no handle on the run that invoked it. traceId is the identifier that
 * is genuinely threaded end to end, so it is the one used here.
 *
 * WHAT THIS DELIBERATELY DOES NOT RETURN: step inputs and outputs. A step's
 * output can hold recalled memories, prompt text, or a reviewer's prose, and
 * this feeds a client component. Progress needs status, timing and cost — not
 * content — so content never enters the payload.
 */

import { db } from "@/lib/db";
import type { AgentRunStatus, AgentStepStatus, CapabilityRunStatus, CapabilityLevel } from "@/generated/prisma/enums";

export interface ProgressStep {
  order: number;
  description: string;
  toolName: string | null;
  capability: string | null;
  requiredLevel: CapabilityLevel;
  status: AgentStepStatus;
  /** Present on a FAILED step. The tool's message, never a stack trace. */
  error: string | null;
  durationMs: number | null;
  retryCount: number;
}

export interface ProgressProviderCall {
  id: string;
  capability: string;
  provider: string;
  model: string | null;
  status: CapabilityRunStatus;
  error: string | null;
  durationMs: number | null;
  /** USD, only when the provider actually reported one. Null stays null. */
  costUsd: number | null;
  startedAt: Date;
}

export interface ProgressArtifact {
  versionId: string;
  artifactId: string;
  version: number;
  url: string;
  mimeType: string;
  capability: string;
  provider: string;
}

export interface RequestProgress {
  traceId: string;
  runId: string | null;
  objective: string | null;
  /** Null when no run was started — the router decided VOX should just answer. */
  status: AgentRunStatus | null;
  steps: ProgressStep[];
  /** Set when the run is parked on a permission the user has not granted. */
  awaiting: { capability: string; requiredLevel: CapabilityLevel; toolName: string | null } | null;
  providerCalls: ProgressProviderCall[];
  artifacts: ProgressArtifact[];
  /** Sum of REPORTED costs. Null when nothing reported one — not zero, which
   * would read as "this was free". */
  costUsd: number | null;
  /** Calls that ran without reporting a cost, so the total can be read
   * correctly as a floor rather than a full accounting. */
  unpricedCalls: number;
  /** True while anything could still change, so a client knows to keep polling. */
  live: boolean;
}

const LIVE_RUN_STATUSES: AgentRunStatus[] = ["PLANNING", "RUNNING", "WAITING_FOR_PERMISSION"];

function durationOf(startedAt: Date | null, completedAt: Date | null): number | null {
  if (!startedAt || !completedAt) return null;
  return completedAt.getTime() - startedAt.getTime();
}

/**
 * Assembles the progress of one driven request.
 *
 * `runId` is optional because a plan can legitimately produce no run at all;
 * the provider calls and artifacts for the trace are still returned, so a
 * direct (non-agent) capability call is visible here too.
 */
export async function getRequestProgress(
  userId: string,
  traceId: string,
  runId?: string | null,
): Promise<RequestProgress> {
  const [run, capabilityRuns] = await Promise.all([
    runId
      ? db.agentRun.findFirst({
          where: { id: runId, userId },
          include: { steps: { orderBy: { order: "asc" } } },
        })
      : Promise.resolve(null),
    db.capabilityRun.findMany({
      where: { userId, traceId },
      orderBy: { startedAt: "asc" },
      include: {
        versions: {
          select: { id: true, artifactId: true, version: true, url: true, mimeType: true },
          orderBy: { version: "asc" },
        },
      },
    }),
  ]);

  const steps: ProgressStep[] = (run?.steps ?? []).map((step) => ({
    order: step.order,
    description: step.description,
    toolName: step.toolName,
    capability: step.capability,
    requiredLevel: step.requiredLevel,
    status: step.status,
    error: step.error,
    durationMs: durationOf(step.startedAt, step.completedAt),
    retryCount: step.retryCount,
  }));

  // The step the executor actually parked on — read from the step rows rather
  // than from currentStep, so what the UI offers to grant is the permission
  // the executor really asked for.
  const waitingStep = run?.steps.find((s) => s.status === "WAITING_FOR_PERMISSION");
  const awaiting =
    waitingStep && waitingStep.capability
      ? {
          capability: waitingStep.capability,
          requiredLevel: waitingStep.requiredLevel,
          toolName: waitingStep.toolName,
        }
      : null;

  const providerCalls: ProgressProviderCall[] = capabilityRuns.map((call) => ({
    id: call.id,
    capability: call.capability,
    provider: call.provider,
    model: call.model,
    status: call.status,
    error: call.error,
    durationMs: call.durationMs,
    costUsd: call.costUsd,
    startedAt: call.startedAt,
  }));

  const artifacts: ProgressArtifact[] = capabilityRuns.flatMap((call) =>
    call.versions.map((v) => ({
      versionId: v.id,
      artifactId: v.artifactId,
      version: v.version,
      url: v.url,
      mimeType: v.mimeType,
      capability: call.capability,
      provider: call.provider,
    })),
  );

  const priced = capabilityRuns.filter((c) => c.costUsd != null);
  const unpricedCalls = capabilityRuns.filter((c) => c.costUsd == null && c.status !== "REFUSED").length;

  const runIsLive = run ? LIVE_RUN_STATUSES.includes(run.status) : false;
  // A submitted video job keeps its CapabilityRun RUNNING until a later poll
  // closes it, so the trace is still live even once the agent run finished.
  const callIsLive = capabilityRuns.some((c) => c.status === "RUNNING");

  return {
    traceId,
    runId: run?.id ?? null,
    objective: run?.objective ?? null,
    status: run?.status ?? null,
    steps,
    awaiting,
    providerCalls,
    artifacts,
    costUsd: priced.length > 0 ? priced.reduce((sum, c) => sum + (c.costUsd ?? 0), 0) : null,
    unpricedCalls,
    live: runIsLive || callIsLive,
  };
}
