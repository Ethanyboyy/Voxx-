import { db } from "@/lib/db";
import { POLICY_CONSUMING_PROVENANCES } from "@/lib/economic/accounting";
import { fromCents } from "@/lib/economic/money";
import { recordEvent } from "@/lib/observability/events";
import { getObjective } from "@/lib/objectives/service";
import { createAgent, updateAgent } from "@/lib/agents/agents";
import { startAgentRun, resumeAgentRun, cancelAgentRun, getAgentRun } from "@/lib/agents/service";
import { planObjective, type PlanStep } from "@/lib/agents/planner";
import { buildPlanningContext } from "@/lib/agents/context";
import { getTool } from "@/lib/tools/registry";
import { createMemory } from "@/lib/memory/service";
import { ensureNodeForEntity, createConnection } from "@/lib/knowledge/service";
import { verifyObjective, type VerificationResult } from "@/lib/objectives/verification";
import type { AgentRun, AgentStep, SupervisorRun } from "@/generated/prisma/client";
import type { AgentRunStatus, AutonomyMode, OutcomeStatus, SupervisorRunStatus } from "@/generated/prisma/enums";

/**
 * The Supervisor — the Brain <-> Agent Runtime bridge (see the doc comment
 * on the SupervisorRun model in schema.prisma). It does not execute
 * anything itself: it calls the existing planner once, selects or creates
 * an Agent by capability, and drives the existing AgentRun/AgentStep engine
 * exactly as a human using the Agent UI would — through startAgentRun(),
 * resumeAgentRun(), and cancelAgentRun(). Every consequential boundary is
 * still the real checkCapability()/Agent.allowedCapabilities gate; the
 * Supervisor only decides *when* to call those existing entry points.
 */

const DEFAULT_MAX_ITERATIONS = 2;
const AGENT_NAME_MAX = 80;

type SupervisorRunWithRelations = SupervisorRun & {
  agentRuns: (AgentRun & { steps: AgentStep[] })[];
};

function requiredCapabilitiesFor(steps: PlanStep[]): string[] {
  const caps = new Set<string>();
  for (const step of steps) {
    if (!step.toolName) continue;
    const tool = getTool(step.toolName);
    if (tool) caps.add(tool.capability);
  }
  return [...caps];
}

/**
 * Capability-based agent selection (never a hardcoded per-domain mapping):
 * reuse any existing non-archived Agent whose allowlist already covers
 * every capability the plan needs; otherwise create a new one scoped to
 * exactly those capabilities — never more. Under AutonomyMode.MANUAL a
 * newly-created agent gets an empty allowlist regardless of what the plan
 * needs, so every tool-bound step blocks until a human intervenes.
 */
export async function selectOrCreateAgent(userId: string, requiredCapabilities: string[], objectiveTitle: string) {
  const candidates = await db.agent.findMany({ where: { userId, status: { not: "ARCHIVED" } } });
  const match = candidates.find((a) => {
    const allowed: string[] = JSON.parse(a.allowedCapabilities);
    return requiredCapabilities.every((c) => allowed.includes(c));
  });
  if (match) return match;

  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { autonomyMode: true } });
  const grantedCapabilities = user.autonomyMode === "MANUAL" ? [] : requiredCapabilities;

  const name = `Supervisor agent — ${objectiveTitle.slice(0, AGENT_NAME_MAX)}`;
  const created = await createAgent({
    userId,
    name,
    description: "Created automatically by the Supervisor to carry out this objective's plan.",
    allowedCapabilities: grantedCapabilities,
  });
  await updateAgent(userId, created.id, { status: "READY" });
  return db.agent.findUniqueOrThrow({ where: { id: created.id } });
}

async function loadSupervisorRun(userId: string, id: string): Promise<SupervisorRunWithRelations | null> {
  return db.supervisorRun.findFirst({
    where: { id, userId },
    include: { agentRuns: { orderBy: { createdAt: "desc" }, include: { steps: { orderBy: { order: "asc" } } } } },
  });
}

/**
 * Real spend recorded against this run's source opportunity, if any.
 *
 * Uses the SAME provenance rule and the SAME integer-cent arithmetic as every
 * other economic figure (see src/lib/economic/accounting.ts). It previously
 * summed `amountUsd` across every provenance, so an Outcome's recorded cost
 * could include a SIMULATED dry run and disagree with the budget panel and the
 * P&L about what the very same venture had spent.
 *
 * Null when there is no opportunity or no asset; 0 is a real answer meaning
 * "nothing was spent", and the two are not the same thing.
 */
async function realizedCostForObjective(objectiveId: string): Promise<number | null> {
  const objective = await db.objective.findUnique({ where: { id: objectiveId }, select: { sourceOpportunityId: true } });
  if (!objective?.sourceOpportunityId) return null;
  const asset = await db.economicAsset.findUnique({
    where: { opportunityId: objective.sourceOpportunityId },
    select: { id: true },
  });
  if (!asset) return null;
  const spend = await db.economicExpense.aggregate({
    where: { assetId: asset.id, provenance: { in: [...POLICY_CONSUMING_PROVENANCES] } },
    _sum: { amountCents: true },
  });
  return fromCents(spend._sum.amountCents ?? 0);
}

/**
 * Writes a structured, honest Outcome for a just-terminated SupervisorRun.
 * Deliberately does NOT equate "AgentRun completed" with "objective
 * succeeded" — the summary always says explicitly that completion reflects
 * execution finishing, not an independently verified real-world result.
 */
async function recordOutcome(
  userId: string,
  supRun: SupervisorRun,
  status: OutcomeStatus,
  params: {
    summary: string;
    observedResult?: string | null;
    confidence?: "LOW" | "MEDIUM" | "HIGH" | "CONFIRMED";
    /** Real evidence about WHY this ended as it did — currently the actual
     * failure message. Never a synthesized moral; null when the run gave us
     * nothing to learn (see Outcome.lessons in schema.prisma). */
    lessons?: string | null;
    /** The run this outcome describes, when one exists. Supplied so the
     * objective can be verified against its own success criteria from the
     * run's real recorded evidence. */
    agentRun?: (AgentRun & { steps: AgentStep[] }) | null;
  }
): Promise<void> {
  const costUsd = await realizedCostForObjective(supRun.objectiveId);
  const timeSpentMinutes = Math.max(0, Math.round((Date.now() - supRun.createdAt.getTime()) / 60_000));

  // Whether the OBJECTIVE succeeded — a separate question from whether the
  // planned execution ran. Defaults to UNVERIFIED and only moves off it on
  // real evidence (src/lib/objectives/verification.ts).
  const verification = await runVerification(userId, supRun.objectiveId, params.agentRun ?? null);

  await db.outcome.create({
    data: {
      userId,
      supervisorRunId: supRun.id,
      status,
      verification: verification?.status ?? "UNVERIFIED",
      summary: params.summary,
      observedResult: params.observedResult,
      // The criteria we judged against, and the per-criterion verdicts —
      // stored so a later reader can audit the judgement rather than having
      // to trust the single status enum.
      expectedResult: verification?.assessments.length
        ? verification.assessments.map((a) => a.criterion).join("; ")
        : undefined,
      variance: verification?.assessments.length
        ? verification.assessments
            .map((a) => `${a.criterion}: ${a.met === true ? "met" : a.met === false ? "not met" : "undetermined"} — ${a.reasoning}`)
            .join("\n")
        : undefined,
      evidence: verification?.evidence.length ? JSON.stringify(verification.evidence) : undefined,
      lessons: params.lessons ?? undefined,
      costUsd: costUsd ?? undefined,
      timeSpentMinutes,
      confidence: params.confidence ?? "LOW",
    },
  });
  await recordEvent({
    userId,
    type: "outcome.recorded",
    subjectType: "SupervisorRun",
    subjectId: supRun.id,
    payload: { status, verification: verification?.status ?? "UNVERIFIED", costUsd, timeSpentMinutes },
  });

  if (verification) {
    await recordEvent({
      userId,
      type: "objective.verified",
      subjectType: "Objective",
      subjectId: supRun.objectiveId,
      payload: {
        supervisorRunId: supRun.id,
        verification: verification.status,
        criteria: verification.assessments.length,
        met: verification.assessments.filter((a) => a.met === true).length,
      },
      // A verdict on whether the user's objective was achieved is a
      // consequential claim, not routine telemetry.
      consequential: true,
    });
  }

  await recordOutcomeMemory(userId, supRun, status, costUsd, timeSpentMinutes, verification);
}

/**
 * Verifies the objective behind a run. Returns null only when there is no
 * run to gather evidence from (a decline before anything executed), which
 * the caller records as UNVERIFIED. Verification failures are swallowed for
 * the same reason graph-linking is: the Outcome is the record of what
 * happened and must still be written.
 */
async function runVerification(
  userId: string,
  objectiveId: string,
  agentRun: (AgentRun & { steps: AgentStep[] }) | null
): Promise<VerificationResult | null> {
  if (!agentRun) return null;
  try {
    const objective = await db.objective.findFirst({ where: { id: objectiveId, userId } });
    if (!objective) return null;
    return await verifyObjective(objective, agentRun);
  } catch {
    return null;
  }
}

/**
 * Writes what actually happened as a durable EXPERIENCE memory, for EVERY
 * supervised run — not only the economic ones.
 *
 * This is the write half of the learning loop: buildPlanningContext() reads
 * these back (alongside the Outcome rows themselves) the next time VOX plans,
 * so a run that failed for a real reason is visible to the planner instead of
 * being rediscovered from scratch. Before this generalization only runs
 * tracing back to an Opportunity produced a memory, which meant ordinary
 * objectives left no durable trace at all.
 *
 * Content is strictly the real recorded facts — objective title, terminal
 * status, and the measured cost/time. Confidence is MEDIUM only when a real
 * cost figure backs it up, LOW otherwise; nothing here is an interpretation.
 */
async function recordOutcomeMemory(
  userId: string,
  supRun: SupervisorRun,
  status: OutcomeStatus,
  costUsd: number | null,
  timeSpentMinutes: number,
  verification: VerificationResult | null
): Promise<void> {
  const objective = await db.objective.findUnique({
    where: { id: supRun.objectiveId },
    include: { sourceOpportunity: true },
  });
  if (!objective) return;

  const costText = costUsd != null ? `$${costUsd.toFixed(2)} spent` : "no spend recorded";
  const timeText = timeSpentMinutes >= 60 ? `${(timeSpentMinutes / 60).toFixed(1)} hours` : `${timeSpentMinutes} minutes`;
  const statusText = status.toLowerCase().replace(/_/g, " ");

  // An objective created to validate an Opportunity keeps its economic
  // framing — that wording is what makes it useful when the Economic Engine
  // later reasons about whether to pursue similar opportunities.
  const subject = objective.sourceOpportunity
    ? `Validation attempt for opportunity "${objective.sourceOpportunity.title}"`
    : `Work on objective "${objective.title}"`;

  // The verdict is the part worth remembering. "Execution completed" says
  // almost nothing on its own; "execution completed but the objective could
  // not be verified" is what a future planning pass actually needs to know.
  const verdict = verification
    ? ` Objective verification: ${verification.status.toLowerCase().replace(/_/g, " ")} — ${verification.summary}`
    : "";

  const content = `${subject} ended ${statusText} — ${costText}, ${timeText} elapsed.${verdict}`;

  const memory = await createMemory({
    userId,
    content,
    category: "EXPERIENCE",
    // A verified verdict is stronger evidence than raw cost figures alone,
    // but still a judgement over evidence — never CONFIRMED.
    confidence: verification && verification.status !== "UNVERIFIED" ? "MEDIUM" : costUsd != null ? "MEDIUM" : "LOW",
    provenance: objective.sourceOpportunity ? "supervisor:economic-outcome" : "supervisor:outcome",
  });

  await linkOutcomeIntoGraph(
    userId,
    objective.id,
    objective.title,
    memory.id,
    content,
    // The edge records the objective-level VERDICT where one exists, so
    // traversing from an objective shows whether past attempts actually
    // worked — falling back to the execution status only when there was
    // nothing to verify against.
    verification ? `verified:${verification.status.toLowerCase()}` : `outcome:${statusText.replace(/\s+/g, "_")}`
  );
}

/**
 * Connects the finished work into the Knowledge Graph: the Objective gets a
 * node, the EXPERIENCE memory recording what happened gets a node, and an
 * edge is drawn between them.
 *
 * This is the first autonomous writer the graph has ever had. Until now
 * ensureNodeForEntity() was reachable only from two detail pages and one
 * manual API endpoint, so the graph could only ever contain what a human had
 * clicked on — a decorative structure beside the system rather than a record
 * of what the system actually did.
 *
 * Best-effort by design: a graph-linking failure must never fail or roll
 * back a run whose real work already completed and whose Outcome and Memory
 * are already persisted. The graph is derived connective tissue, not the
 * system of record.
 */
async function linkOutcomeIntoGraph(
  userId: string,
  objectiveId: string,
  objectiveTitle: string,
  memoryId: string,
  memoryContent: string,
  relation: string
): Promise<void> {
  try {
    const [objectiveNode, memoryNode] = await Promise.all([
      ensureNodeForEntity(userId, "OBJECTIVE", objectiveId, objectiveTitle),
      ensureNodeForEntity(userId, "MEMORY", memoryId, memoryContent.slice(0, 120)),
    ]);
    await createConnection({
      userId,
      fromNodeId: objectiveNode.id,
      toNodeId: memoryNode.id,
      // The edge label states what this edge actually is — a recorded result
      // of pursuing the objective — rather than a generic "related_to".
      relation,
    });
  } catch {
    // Intentionally swallowed — see the doc comment above.
  }
}

/**
 * Maps a just-executed AgentRun's outcome onto the SupervisorRun's own
 * state machine. This is the one place autonomous replanning happens, and
 * it is strictly bounded by SupervisorRun.maxIterations — never an
 * unbounded retry loop.
 */
export async function applyAgentRunOutcome(
  userId: string,
  supervisorRunId: string,
  agentRun: AgentRun & { steps: AgentStep[] }
): Promise<SupervisorRunWithRelations> {
  const supRun = await db.supervisorRun.findFirstOrThrow({ where: { id: supervisorRunId, userId } });

  if (agentRun.status === "COMPLETED") {
    const completed = await db.supervisorRun.update({
      where: { id: supervisorRunId },
      data: { status: "COMPLETED", result: agentRun.result, completedAt: new Date() },
    });
    await recordEvent({
      userId,
      type: "supervisor.completed",
      subjectType: "SupervisorRun",
      subjectId: supervisorRunId,
      payload: { objectiveId: supRun.objectiveId, result: agentRun.result },
    });
    await recordOutcome(userId, completed, "COMPLETED", {
      summary:
        "The planned work completed. This reflects execution completion, not an independently verified real-world result — no success criteria were confirmed automatically.",
      observedResult: agentRun.result,
      confidence: "LOW",
      agentRun,
    });
    return loadSupervisorRun(userId, supervisorRunId) as Promise<SupervisorRunWithRelations>;
  }

  if (agentRun.status === "WAITING_FOR_PERMISSION") {
    const blocked = agentRun.steps.find((s) => s.status === "WAITING_FOR_PERMISSION");
    await db.supervisorRun.update({ where: { id: supervisorRunId }, data: { status: "WAITING_FOR_APPROVAL" } });
    await recordEvent({
      userId,
      type: "approval.required",
      subjectType: "SupervisorRun",
      subjectId: supervisorRunId,
      payload: {
        agentRunId: agentRun.id,
        step: blocked?.description,
        tool: blocked?.toolName,
        capability: blocked?.capability,
        requiredLevel: blocked?.requiredLevel,
      },
    });
    return loadSupervisorRun(userId, supervisorRunId) as Promise<SupervisorRunWithRelations>;
  }

  if (agentRun.status === "CANCELLED") {
    const cancelled = await db.supervisorRun.update({
      where: { id: supervisorRunId },
      data: { status: "CANCELLED", error: "The driving agent run was cancelled.", completedAt: new Date() },
    });
    await recordOutcome(userId, cancelled, "ABANDONED", {
      summary: "The driving agent run was cancelled before completion.",
      agentRun,
    });
    return loadSupervisorRun(userId, supervisorRunId) as Promise<SupervisorRunWithRelations>;
  }

  // agentRun.status === "FAILED" — the only status left. Replan-and-retry
  // once per remaining iteration, then give up honestly.
  if (supRun.iterations < supRun.maxIterations) {
    const objective = await getObjective(userId, supRun.objectiveId);
    if (!objective) throw new Error("Objective no longer exists.");

    const nextIteration = supRun.iterations + 1;
    await db.supervisorRun.update({ where: { id: supervisorRunId }, data: { status: "REPLANNING", iterations: nextIteration } });
    await recordEvent({
      userId,
      type: "supervisor.replanning",
      subjectType: "SupervisorRun",
      subjectId: supervisorRunId,
      payload: { iteration: nextIteration, maxIterations: supRun.maxIterations, reason: agentRun.error },
    });

    const retryObjective = `${objective.title}${objective.description ? `: ${objective.description}` : ""}. A previous attempt failed with: "${agentRun.error}". Take a different approach that avoids the same failure.`;
    // Replanning is exactly where prior-outcome context earns its keep — this
    // objective's own recorded failures are loaded first (see
    // loadPriorOutcomes), so the retry can see what has already been tried
    // rather than only the single error string above.
    const retryContext = await buildPlanningContext(userId, retryObjective, { objectiveId: objective.id });
    const newPlan = await planObjective(retryObjective, retryContext);
    const requiredCapabilities = requiredCapabilitiesFor(newPlan);
    const agent = await selectOrCreateAgent(userId, requiredCapabilities, objective.title);

    await db.supervisorRun.update({ where: { id: supervisorRunId }, data: { agentId: agent.id, plan: JSON.stringify(newPlan), status: "RUNNING" } });
    const newAgentRun = await startAgentRun({
      userId,
      objective: objective.title,
      agentId: agent.id,
      supervisorRunId,
      steps: newPlan,
    });
    return applyAgentRunOutcome(userId, supervisorRunId, newAgentRun);
  }

  const failed = await db.supervisorRun.update({
    where: { id: supervisorRunId },
    data: { status: "FAILED", error: agentRun.error, completedAt: new Date() },
  });
  await recordEvent({
    userId,
    type: "supervisor.failed",
    subjectType: "SupervisorRun",
    subjectId: supervisorRunId,
    payload: { objectiveId: supRun.objectiveId, error: agentRun.error },
    consequential: true,
  });
  await recordOutcome(userId, failed, "FAILED", {
    summary: agentRun.error ?? "The run failed.",
    confidence: "MEDIUM",
    // The real failure message, after every permitted replan was exhausted —
    // genuine evidence about this objective, and the thing a future planning
    // pass most needs to see. Not a synthesized takeaway.
    lessons: agentRun.error
      ? `Exhausted ${supRun.maxIterations} replanning attempt(s); the final failure was: ${agentRun.error}`
      : null,
    agentRun,
  });
  return loadSupervisorRun(userId, supervisorRunId) as Promise<SupervisorRunWithRelations>;
}

export interface StartSupervisorRunInput {
  userId: string;
  objectiveId: string;
  maxIterations?: number;
}

/** Understands an objective, plans it, selects/creates an agent by
 * capability, and drives it to completion, a genuine approval boundary, or
 * a (bounded) failure. */
export async function startSupervisorRun(input: StartSupervisorRunInput): Promise<SupervisorRunWithRelations> {
  const objective = await getObjective(input.userId, input.objectiveId);
  if (!objective) throw new Error("Objective not found.");

  const supRun = await db.supervisorRun.create({
    data: {
      userId: input.userId,
      objectiveId: input.objectiveId,
      status: "PLANNING",
      maxIterations: input.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    },
  });
  await recordEvent({
    userId: input.userId,
    type: "supervisor.started",
    subjectType: "SupervisorRun",
    subjectId: supRun.id,
    payload: { objectiveId: objective.id, title: objective.title },
  });
  await recordEvent({ userId: input.userId, type: "objective.progress", subjectType: "Objective", subjectId: objective.id, payload: { supervisorRunId: supRun.id, phase: "started" } });

  const objectiveText = `${objective.title}${objective.description ? `: ${objective.description}` : ""}`;
  const planningContext = await buildPlanningContext(input.userId, objectiveText, { objectiveId: objective.id });
  const plan = await planObjective(objectiveText, planningContext);
  await recordEvent({
    userId: input.userId,
    type: "supervisor.planning",
    subjectType: "SupervisorRun",
    subjectId: supRun.id,
    payload: { steps: plan.map((s) => ({ description: s.description, toolName: s.toolName ?? null })) },
  });

  const requiredCapabilities = requiredCapabilitiesFor(plan);
  const agent = await selectOrCreateAgent(input.userId, requiredCapabilities, objective.title);
  await recordEvent({ userId: input.userId, type: "agent.assigned", subjectType: "SupervisorRun", subjectId: supRun.id, payload: { agentId: agent.id, agentName: agent.name } });

  // MANUAL autonomy: research/reason/plan is fine, but consequential
  // execution requires an explicit human go-ahead — stop here with the
  // plan+agent already selected (inspectable) rather than starting the
  // AgentRun. beginSupervisorExecution() is the human's "Start" action.
  const autonomyMode = await getAutonomyMode(input.userId);
  if (autonomyMode === "MANUAL") {
    await db.supervisorRun.update({ where: { id: supRun.id }, data: { agentId: agent.id, plan: JSON.stringify(plan), status: "BLOCKED" } });
    await recordEvent({
      userId: input.userId,
      type: "supervisor.blocked",
      subjectType: "SupervisorRun",
      subjectId: supRun.id,
      payload: { reason: "MANUAL autonomy mode — awaiting explicit start." },
    });
    return loadSupervisorRun(input.userId, supRun.id) as Promise<SupervisorRunWithRelations>;
  }

  await db.supervisorRun.update({ where: { id: supRun.id }, data: { agentId: agent.id, plan: JSON.stringify(plan), status: "RUNNING" } });

  const agentRun = await startAgentRun({
    userId: input.userId,
    objective: objective.title,
    agentId: agent.id,
    supervisorRunId: supRun.id,
    steps: plan,
  });

  return applyAgentRunOutcome(input.userId, supRun.id, agentRun);
}

/** MANUAL autonomy's "Start execution" action — the human's explicit
 * go-ahead for a plan the Supervisor has already produced and stopped at
 * BLOCKED. Never re-plans; runs exactly the plan that was shown. */
export async function beginSupervisorExecution(userId: string, id: string): Promise<SupervisorRunWithRelations | null> {
  const supRun = await loadSupervisorRun(userId, id);
  if (!supRun) return null;
  if (supRun.status !== "BLOCKED") return supRun;
  if (!supRun.agentId || !supRun.plan) throw new Error("This run has no stored plan/agent to execute.");

  const objective = await getObjective(userId, supRun.objectiveId);
  if (!objective) throw new Error("Objective no longer exists.");

  const plan = JSON.parse(supRun.plan) as PlanStep[];
  await db.supervisorRun.update({ where: { id }, data: { status: "RUNNING" } });
  await recordEvent({ userId, type: "supervisor.started", subjectType: "SupervisorRun", subjectId: id, payload: { objectiveId: supRun.objectiveId, resumedFromManualBlock: true } });

  const agentRun = await startAgentRun({
    userId,
    objective: objective.title,
    agentId: supRun.agentId,
    supervisorRunId: id,
    steps: plan,
  });
  return applyAgentRunOutcome(userId, id, agentRun);
}

function latestAgentRunOf(supRun: SupervisorRunWithRelations): AgentRun & { steps: AgentStep[] } {
  const run = supRun.agentRuns[0];
  if (!run) throw new Error("SupervisorRun has no driving agent run.");
  return run;
}

/** The approval boundary's "Approve" action — resumes the exact same real
 * permission check every other agent run goes through. Never bypasses it. */
export async function resumeSupervisorRun(userId: string, id: string): Promise<SupervisorRunWithRelations | null> {
  const supRun = await loadSupervisorRun(userId, id);
  if (!supRun) return null;
  if (supRun.status !== "WAITING_FOR_APPROVAL") return supRun;

  const agentRun = latestAgentRunOf(supRun);
  await recordEvent({ userId, type: "approval.approved", subjectType: "SupervisorRun", subjectId: id, payload: { agentRunId: agentRun.id }, consequential: true });
  await db.supervisorRun.update({ where: { id }, data: { status: "RUNNING" } });

  await resumeAgentRun(userId, agentRun.id);
  const resumed = await getAgentRun(userId, agentRun.id);
  if (!resumed) throw new Error("Underlying agent run disappeared.");
  return applyAgentRunOutcome(userId, id, resumed);
}

/** The approval boundary's "Decline" action — cancels the blocked agent run and stops the objective's autonomous work rather than silently retrying or bypassing the check. */
export async function declineSupervisorRun(userId: string, id: string): Promise<SupervisorRunWithRelations | null> {
  const supRun = await loadSupervisorRun(userId, id);
  if (!supRun) return null;
  if (supRun.status !== "WAITING_FOR_APPROVAL") return supRun;

  const agentRun = latestAgentRunOf(supRun);
  await cancelAgentRun(userId, agentRun.id);
  await recordEvent({ userId, type: "approval.declined", subjectType: "SupervisorRun", subjectId: id, payload: { agentRunId: agentRun.id }, consequential: true });
  const declined = await db.supervisorRun.update({ where: { id }, data: { status: "CANCELLED", error: "Declined by user.", completedAt: new Date() } });
  await recordOutcome(userId, declined, "ABANDONED", { summary: "The user declined the required approval; the action was never performed." });
  return loadSupervisorRun(userId, id);
}

export async function cancelSupervisorRun(userId: string, id: string): Promise<SupervisorRunWithRelations | null> {
  const supRun = await loadSupervisorRun(userId, id);
  if (!supRun) return null;
  const terminalSupervisor: SupervisorRunStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];
  if (terminalSupervisor.includes(supRun.status)) return supRun;

  const terminalAgentRun: AgentRunStatus[] = ["COMPLETED", "FAILED", "CANCELLED"];
  const agentRun = supRun.agentRuns[0];
  if (agentRun && !terminalAgentRun.includes(agentRun.status)) {
    await cancelAgentRun(userId, agentRun.id);
  }
  const cancelled = await db.supervisorRun.update({ where: { id }, data: { status: "CANCELLED", error: "Cancelled by user.", completedAt: new Date() } });
  await recordEvent({ userId, type: "supervisor.failed", subjectType: "SupervisorRun", subjectId: id, payload: { reason: "cancelled" } });
  await recordOutcome(userId, cancelled, "ABANDONED", { summary: "Cancelled by the user before completion." });
  return loadSupervisorRun(userId, id);
}

export async function getSupervisorRun(userId: string, id: string) {
  return loadSupervisorRun(userId, id);
}

export async function listSupervisorRuns(userId: string, limit = 20) {
  return db.supervisorRun.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { agentRuns: { orderBy: { createdAt: "desc" }, include: { steps: { orderBy: { order: "asc" } } } } },
  });
}

// ---------------------------------------------------------------------------
// Autonomy mode — a global, per-user setting the Supervisor reads before
// deciding what capabilities a newly-created agent may have (see
// selectOrCreateAgent above). It can only ever narrow what the Supervisor
// is willing to grant — never widen it beyond checkCapability()/the user's
// own Permission grants, which remain the real, unbypassable authority.
// ---------------------------------------------------------------------------

export async function getAutonomyMode(userId: string): Promise<AutonomyMode> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { autonomyMode: true } });
  return user.autonomyMode;
}

export async function setAutonomyMode(userId: string, mode: AutonomyMode): Promise<AutonomyMode> {
  const existing = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { autonomyMode: true } });
  const user = await db.user.update({ where: { id: userId }, data: { autonomyMode: mode }, select: { autonomyMode: true } });
  if (existing.autonomyMode !== mode) {
    await recordEvent({ userId, type: "settings.autonomy_mode_changed", payload: { from: existing.autonomyMode, to: mode } });
  }
  return user.autonomyMode;
}

export async function setMaxAutonomousSpend(userId: string, amountUsd: number): Promise<number> {
  const existing = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { maxAutonomousSpendUsd: true } });
  const user = await db.user.update({ where: { id: userId }, data: { maxAutonomousSpendUsd: amountUsd }, select: { maxAutonomousSpendUsd: true } });
  if (existing.maxAutonomousSpendUsd !== amountUsd) {
    await recordEvent({ userId, type: "settings.autonomy_budget_changed", payload: { from: existing.maxAutonomousSpendUsd, to: amountUsd } });
  }
  return user.maxAutonomousSpendUsd;
}
