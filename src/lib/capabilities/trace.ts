/**
 * The trace: everything that happened in one task, in one read.
 *
 * A driven request leaves its record in four places — the AgentRun and its
 * steps (what VOX decided to do and how far it got), the CapabilityRun rows
 * (which provider was called, at what cost), the ArtifactVersions those calls
 * produced, and the Event log (reviews, iterations, selections). The workspace
 * needs all four at once, so assembling them belongs here rather than in a
 * component making four fetches and guessing how they line up.
 *
 * THE JOIN KEY IS `traceId`, and it is now persisted on the AgentRun itself.
 * It used to travel only through step input, which meant the link between a
 * run and its provider calls existed in memory and in tool arguments but
 * nowhere queryable — so a restarted process could find the run and never find
 * what it spent. `AgentRun.traceId` closes that, which is what makes this a
 * trace rather than a snapshot of the current process.
 *
 * WHAT THIS DELIBERATELY DOES NOT RETURN: step inputs and outputs, and
 * generation prompts. A step's output can hold recalled memories, prompt text,
 * or a reviewer's prose, and this feeds a client component. The trace needs
 * status, timing, cost and verdicts — not content — so content never enters
 * the payload.
 */

import { db } from "@/lib/db";
import type {
  AgentRunStatus,
  AgentStepStatus,
  CapabilityRunStatus,
  CapabilityLevel,
  ArtifactKind,
} from "@/generated/prisma/enums";

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

/**
 * What state an artifact version is in, from the user's point of view.
 *
 * Derived, never stored — every value here is read off the version row or the
 * recorded review, so it cannot claim an approval that did not happen.
 */
export type ArtifactState = "GENERATED" | "QA_FAILED" | "APPROVED" | "ACTIVE" | "SUPERSEDED";

export interface ProgressArtifact {
  versionId: string;
  artifactId: string;
  artifactLabel: string;
  kind: ArtifactKind;
  version: number;
  url: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  capability: string;
  provider: string;
  state: ArtifactState;
  /** The review score for this version, when one was recorded. */
  score: number | null;
}

/** One review verdict, as the workspace shows it. */
export interface TraceReview {
  artifactId: string;
  version: number;
  status: "PASS" | "FAIL";
  score: number;
  /** Concrete complaints. Never the reviewer's reasoning. */
  issues: string[];
  at: Date;
}

/** One bounded-iteration loop over an artifact. */
export interface TraceIteration {
  artifactId: string;
  attempts: { attempt: number; of: number; status: "PASS" | "FAIL" | "RUNNING"; score: number | null }[];
  /** The ceiling the loop was given, so the UI can say "2 / 3". */
  limit: number;
}

/** A line in the activity feed. */
export interface TraceActivity {
  id: string;
  type: string;
  at: Date;
  /** One short line. Derived from the event's own operational payload. */
  detail: string | null;
}

export interface RequestProgress {
  traceId: string;
  runId: string | null;
  objective: string | null;
  /** Null when no run was started — the router decided VOX should just answer. */
  status: AgentRunStatus | null;
  /** The routed plan, as persisted on the run. Null for non-routed runs. */
  plan: { strategy: string; degraded: boolean; notes: string[]; steps: { capability: string; reason: string; optional: boolean }[] } | null;
  steps: ProgressStep[];
  /** Set when the run is parked on a permission the user has not granted. */
  awaiting: { capability: string; requiredLevel: CapabilityLevel; toolName: string | null; description: string } | null;
  providerCalls: ProgressProviderCall[];
  artifacts: ProgressArtifact[];
  reviews: TraceReview[];
  iterations: TraceIteration[];
  activity: TraceActivity[];
  /** Sum of REPORTED costs. Null when nothing reported one — not zero, which
   * would read as "this was free". */
  costUsd: number | null;
  /** Calls that ran without reporting a cost, so the total can be read
   * correctly as a floor rather than a full accounting. */
  unpricedCalls: number;
  /** True while anything could still change, so a client knows to keep watching. */
  live: boolean;
}

const LIVE_RUN_STATUSES: AgentRunStatus[] = ["PLANNING", "RUNNING", "WAITING_FOR_PERMISSION"];

/** Event types worth showing in the activity feed, in the order they matter. */
const ACTIVITY_TYPES = [
  "capability.requested",
  "capability.routed",
  "capability.run_started",
  "capability.run_resumed",
  "capability.run_cancelled",
  "agent.run.started",
  "agent.step.completed",
  "agent.step.waiting_for_permission",
  "agent.run.completed",
  "agent.run.failed",
  "artifact.version_created",
  "artifact.selected",
  "artifact.attached",
  "iteration.started",
  "iteration.generated",
  "iteration.reviewed",
  "iteration.revision_created",
  "iteration.completed",
  "iteration.approved",
  "iteration.stopped",
  "iteration.failed",
];

function durationOf(startedAt: Date | null, completedAt: Date | null): number | null {
  if (!startedAt || !completedAt) return null;
  return completedAt.getTime() - startedAt.getTime();
}

function parseJson(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** A short, operational line for the feed. Never free-form model text. */
function activityDetail(type: string, payload: Record<string, unknown>): string | null {
  switch (type) {
    case "agent.step.completed":
      return typeof payload.tool === "string" ? payload.tool : null;
    case "agent.step.waiting_for_permission":
      return typeof payload.capability === "string" ? `needs ${payload.requiredLevel} on ${payload.capability}` : null;
    case "artifact.selected":
      return typeof payload.selectedVersion === "number" ? `version ${payload.selectedVersion}` : null;
    case "artifact.attached":
      return typeof payload.subjectType === "string" ? `to ${payload.subjectType}` : null;
    case "iteration.started":
      return typeof payload.attempt === "number" ? `attempt ${payload.attempt} of ${payload.of}` : null;
    case "iteration.generated":
      return typeof payload.revisionOf === "number" ? `revising attempt ${payload.revisionOf}` : null;
    case "iteration.reviewed":
    case "iteration.completed":
      return typeof payload.status === "string" ? `${payload.status} (${payload.score})` : null;
    case "iteration.revision_created":
      return typeof payload.directives === "number"
        ? `${payload.directives} change(s) requested`
        : null;
    case "iteration.approved":
    case "iteration.stopped":
      // The termination reason, which is the question a reader most wants
      // answered when a loop ends without passing.
      return typeof payload.decision === "string" ? String(payload.decision).toLowerCase().replace(/_/g, " ") : null;
    case "agent.run.failed":
      return typeof payload.error === "string" ? String(payload.error).slice(0, 120) : null;
    default:
      return null;
  }
}

export interface TraceLookup {
  /** Preferred: the run reveals its own traceId, so one id is enough. */
  runId?: string;
  /** For provider calls made outside a run, or when only the trace is known. */
  traceId?: string;
}

/**
 * Assembles everything known about one task.
 *
 * Either identifier works. Given a `runId` the traceId is read off the run —
 * which is the whole point of persisting it, and means the UI only ever has to
 * carry one id in a URL.
 */
export async function getRunTrace(userId: string, lookup: TraceLookup): Promise<RequestProgress> {
  const run = lookup.runId
    ? await db.agentRun.findFirst({
        where: { id: lookup.runId, userId },
        include: { steps: { orderBy: { order: "asc" } } },
      })
    : null;

  // The run is authoritative about its own trace; an explicitly supplied
  // traceId is the fallback for provider calls that belong to no run.
  const traceId = run?.traceId ?? lookup.traceId ?? "";

  const [capabilityRuns, events] = await Promise.all([
    traceId
      ? db.capabilityRun.findMany({
          where: { userId, traceId },
          orderBy: { startedAt: "asc" },
          include: {
            versions: {
              select: {
                id: true, artifactId: true, version: true, url: true, mimeType: true,
                width: true, height: true, approved: true,
                artifact: { select: { label: true, kind: true, currentVersionId: true } },
              },
              orderBy: { version: "asc" },
            },
          },
        })
      : Promise.resolve([]),
    traceId
      ? db.event.findMany({
          where: { userId, type: { in: ACTIVITY_TYPES } },
          orderBy: { createdAt: "asc" },
          take: 400,
        })
      : Promise.resolve([]),
  ]);

  // Events carry traceId inside their payload rather than in a column, so the
  // filter happens here. Run-scoped events are matched by subjectId instead,
  // since the executor writes those without knowing the trace.
  const traceEvents = events.filter((event) => {
    if (run && event.subjectId === run.id) return true;
    if (event.subjectId === traceId) return true;
    const payload = parseJson(event.payload);
    return payload.traceId === traceId;
  });

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
          // What will actually happen, in the plan's own words — the user is
          // approving an action, not a capability string.
          description: waitingStep.description,
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

  // Review verdicts, read from the selection events rather than recomputed —
  // the score shown is the one the reviewer actually returned.
  const reviews: TraceReview[] = [];
  const scoreByVersion = new Map<string, { score: number; status: "PASS" | "FAIL" }>();
  for (const event of traceEvents) {
    if (event.type !== "artifact.selected") continue;
    const payload = parseJson(event.payload);
    const artifactId = event.subjectId ?? "";
    const scores = Array.isArray(payload.scores) ? payload.scores : [];
    for (const entry of scores) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      if (typeof row.version !== "number" || typeof row.score !== "number") continue;
      const status = row.status === "PASS" ? "PASS" : "FAIL";
      reviews.push({ artifactId, version: row.version, status, score: row.score, issues: [], at: event.createdAt });
      scoreByVersion.set(`${artifactId}:${row.version}`, { score: row.score, status });
    }
  }

  const artifacts: ProgressArtifact[] = capabilityRuns.flatMap((call) =>
    call.versions.map((v) => {
      const verdict = scoreByVersion.get(`${v.artifactId}:${v.version}`);
      const isCurrent = v.artifact.currentVersionId === v.id;
      // Order matters: an approved version is approved whatever else is true,
      // and only a version nothing approved can be a plain failure.
      const state: ArtifactState = v.approved
        ? isCurrent
          ? "ACTIVE"
          : "APPROVED"
        : verdict?.status === "FAIL"
          ? "QA_FAILED"
          : isCurrent
            ? "GENERATED"
            : "SUPERSEDED";

      return {
        versionId: v.id,
        artifactId: v.artifactId,
        artifactLabel: v.artifact.label,
        kind: v.artifact.kind,
        version: v.version,
        url: v.url,
        mimeType: v.mimeType,
        width: v.width,
        height: v.height,
        capability: call.capability,
        provider: call.provider,
        state,
        score: verdict?.score ?? null,
      };
    }),
  );

  // Bounded iteration, reconstructed from its own events so the UI can show
  // "attempt 2 of 3" rather than implying an unbounded loop.
  const iterationsByArtifact = new Map<string, TraceIteration>();
  for (const event of traceEvents) {
    if (!event.type.startsWith("iteration.")) continue;
    const payload = parseJson(event.payload);
    const artifactId = event.subjectId ?? "";
    const attempt = typeof payload.attempt === "number" ? payload.attempt : null;
    if (attempt === null) continue;

    const limit = typeof payload.of === "number" ? payload.of : (iterationsByArtifact.get(artifactId)?.limit ?? attempt);
    const entry = iterationsByArtifact.get(artifactId) ?? { artifactId, attempts: [], limit };
    entry.limit = Math.max(entry.limit, limit);

    const existing = entry.attempts.find((a) => a.attempt === attempt);
    if (event.type === "iteration.started") {
      if (!existing) entry.attempts.push({ attempt, of: entry.limit, status: "RUNNING", score: null });
    } else if (event.type === "iteration.reviewed" || event.type === "iteration.completed") {
      // Two vocabularies, deliberately both accepted. `iteration.reviewed` is
      // written by the orchestrated loop in refine.ts; `iteration.completed` by
      // iterateWithReview, which callers still use directly. A trace that only
      // understood one would show the other's runs as permanently in progress.
      const status = payload.status === "PASS" ? "PASS" : "FAIL";
      const score = typeof payload.score === "number" ? payload.score : null;
      if (existing) {
        existing.status = status;
        existing.score = score;
      } else {
        entry.attempts.push({ attempt, of: entry.limit, status, score });
      }
    } else if (event.type === "iteration.failed" && existing) {
      existing.status = "FAIL";
    }
    iterationsByArtifact.set(artifactId, entry);
  }
  const iterations = [...iterationsByArtifact.values()].map((entry) => ({
    ...entry,
    attempts: entry.attempts.sort((a, b) => a.attempt - b.attempt).map((a) => ({ ...a, of: entry.limit })),
  }));

  const activity: TraceActivity[] = traceEvents.map((event) => ({
    id: event.id,
    type: event.type,
    at: event.createdAt,
    detail: activityDetail(event.type, parseJson(event.payload)),
  }));

  const priced = capabilityRuns.filter((c) => c.costUsd != null);
  const unpricedCalls = capabilityRuns.filter((c) => c.costUsd == null && c.status !== "REFUSED").length;

  const runIsLive = run ? LIVE_RUN_STATUSES.includes(run.status) : false;
  // A submitted video job keeps its CapabilityRun RUNNING until a later poll
  // closes it, so the trace is still live even once the agent run finished.
  const callIsLive = capabilityRuns.some((c) => c.status === "RUNNING");

  const planPayload = parseJson(run?.plan);

  return {
    traceId,
    runId: run?.id ?? null,
    objective: run?.objective ?? null,
    status: run?.status ?? null,
    plan:
      run?.plan && typeof planPayload.strategy === "string"
        ? {
            strategy: planPayload.strategy,
            degraded: planPayload.degraded === true,
            notes: Array.isArray(planPayload.notes) ? (planPayload.notes as string[]) : [],
            steps: Array.isArray(planPayload.steps)
              ? (planPayload.steps as { capability: string; reason: string; optional: boolean }[])
              : [],
          }
        : null,
    steps,
    awaiting,
    providerCalls,
    artifacts,
    reviews,
    iterations,
    activity,
    costUsd: priced.length > 0 ? priced.reduce((sum, c) => sum + (c.costUsd ?? 0), 0) : null,
    unpricedCalls,
    live: runIsLive || callIsLive,
  };
}

/**
 * Back-compatible entry point for callers that hold a traceId.
 *
 * Kept as a thin alias rather than a second implementation — two functions
 * assembling a trace would drift, and the second one would be the stale one.
 */
export async function getRequestProgress(
  userId: string,
  traceId: string,
  runId?: string | null,
): Promise<RequestProgress> {
  const trace = await getRunTrace(userId, { runId: runId ?? undefined, traceId });
  // A runId belonging to someone else resolves to no run, and the supplied
  // traceId must not then be used to show that trace's provider calls either.
  if (runId && !trace.runId) {
    return { ...trace, traceId, providerCalls: [], artifacts: [], reviews: [], iterations: [], activity: [], costUsd: null, unpricedCalls: 0, live: false };
  }
  return { ...trace, traceId: trace.traceId || traceId };
}
