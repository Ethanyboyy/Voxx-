/**
 * P3 — THE PENDING-APPROVAL READ MODEL.
 *
 * WHAT THIS ANSWERS. "What is currently waiting on me?" Until now that question
 * had five answers in five places, and no way to ask it once: an AgentRun
 * parked at WAITING_FOR_PERMISSION, a SupervisorRun at WAITING_FOR_APPROVAL, a
 * Proposal still PROPOSED, a Connection at AWAITING_APPROVAL, and an Experiment
 * whose executionStatus is AWAITING_HUMAN. Each is a genuine request for a human
 * decision. None of them knew about the others.
 *
 * WHAT THIS IS NOT. A projection, not a state machine — and emphatically not an
 * execution path. It READS the five existing representations and normalises them
 * into one shape. It does not replace them, does not migrate them to a common
 * enum, does not write, and cannot approve anything. There is deliberately no
 * `approvePendingApproval()` here: approving still means calling the same
 * function it always meant — `grantPermission()` + `resumeAgentRun()`,
 * `beginSupervisorExecution()`, `approveProposal()`, `grantAccess()`, or the
 * economic engine's own path — and those are untouched.
 *
 * The direction of dependency matters and only points one way:
 *
 *   existing workflow -> existing approval state -> THIS PROJECTION -> a reader
 *
 * Never the reverse. Nothing downstream of this module executes anything.
 *
 * ENFORCEMENT IS STILL OFF. The Policy Gate remains shadow-only (P2/P2.1): HOLD
 * and DENY both execute. A `policyDecision` shown here is what the gate WOULD
 * say, exactly as it is everywhere else in this phase. P4 owns enforcement.
 *
 * NOTHING IS INVENTED. Where an underlying record cannot supply a field, the
 * field is absent rather than defaulted. In particular a classification is
 * attached only when the action id is genuinely in the registry — the
 * conservative UNKNOWN_ACTION fallback is a policy device, and surfacing it here
 * would tell a reader "VOX classified this" when VOX did not.
 */

import { db } from "@/lib/db";
import { classifyAction, type ActionClassification } from "@/lib/policy/classification";
import { evaluatePolicy, type PolicyDecision } from "@/lib/policy/gate";
import type { CapabilityLevel } from "@/generated/prisma/enums";

/** Which subsystem raised the request. One member per existing waiting state. */
export type PendingApprovalSource =
  /** AgentRun.status = WAITING_FOR_PERMISSION — a tool step needs a capability grant. */
  | "AGENT_RUN"
  /** SupervisorRun.status = WAITING_FOR_APPROVAL — a whole plan needs a go-ahead. */
  | "SUPERVISOR_RUN"
  /** Proposal.status = PROPOSED — a suggested action needs approving or denying. */
  | "PROPOSAL"
  /** Connection.status = AWAITING_APPROVAL — an integration needs access granted. */
  | "CONNECTION"
  /** Experiment.executionStatus = AWAITING_HUMAN — the economic engine stopped at its boundary. */
  | "ECONOMIC_EXPERIMENT";

export const PENDING_APPROVAL_SOURCES: readonly PendingApprovalSource[] = Object.freeze([
  "AGENT_RUN",
  "SUPERVISOR_RUN",
  "PROPOSAL",
  "CONNECTION",
  "ECONOMIC_EXPERIMENT",
] as const);

/**
 * One thing waiting on a human.
 *
 * Every optional field is optional because some source genuinely cannot supply
 * it — not because it was inconvenient to fetch. See each builder below for
 * which source supplies what.
 *
 * Note what is NOT here: `financial` and `reversibility` are not copied out as
 * top-level fields. They live inside `classification`, which is the single
 * object the gate itself reads. Two copies of the same fact are two facts that
 * can disagree, and this module exists to remove that class of problem rather
 * than add one. A reader wanting the financial flag reads
 * `approval.classification?.financial`.
 */
export interface PendingApproval {
  /**
   * Stable and unique across sources: `"<SOURCE>:<entityId>"`.
   *
   * Namespaced because the underlying ids are UUIDs from five different tables
   * with no shared allocator; a bare id would collide only rarely, which is the
   * worst frequency for a collision to have.
   */
  id: string;
  source: PendingApprovalSource;
  /** The underlying row's own id — what a caller uses to act through the existing path. */
  entityId: string;
  /**
   * The underlying status verbatim, NOT normalised to a shared vocabulary.
   *
   * "WAITING_FOR_PERMISSION" and "AWAITING_HUMAN" stay as they are, because
   * flattening them would quietly assert the five states mean the same thing.
   * Deciding whether they do is P3's explicit non-goal.
   */
  status: string;
  /** What VOX wants to do, when the source names a single action. */
  actionType?: string;
  /** One line drawn from the record's own text. Never generated. */
  summary: string;
  /** When the request came into being, from the record's own timestamps. */
  requestedAt: Date;
  /** Capability the human would be granting, where the source knows it. */
  requiredCapability?: string;
  requiredLevel?: CapabilityLevel;
  /** The entity this concerns, in the same descriptive form Event rows use. */
  targetType?: string;
  targetId?: string;
  /** Why it is waiting, when the record recorded a reason. */
  reason?: string;
  /**
   * The static classification for `actionType` — present ONLY when the action id
   * is really in the registry.
   */
  classification?: ActionClassification;
  /**
   * What the Policy Gate would decide for that classification.
   *
   * Computed with the pure `evaluatePolicy()`: no event is written, no model is
   * called, nothing is enforced. Reading a previously recorded
   * `policy.shadow_evaluated` event was considered and does not work here — the
   * gate fires at execution time, so an item still WAITING has no recorded
   * evaluation yet, and the two sources that can be classified would both come
   * back empty.
   */
  policyDecision?: PolicyDecision;
  /**
   * Whether the projection found enough underlying detail for a human to act.
   *
   * Almost always true. It is false for the case worth seeing: an AgentRun whose
   * status says WAITING_FOR_PERMISSION but which has no step actually in that
   * state, so there is no capability to grant. That is a data inconsistency, and
   * showing it as un-actionable is better than hiding it or implying a button
   * that would do nothing.
   */
  actionable: boolean;
}

/** Attaches classification + decision, or neither. Never a fabricated pair. */
function policyFor(
  registry: "tool" | "proposal",
  actionId: string | null | undefined
): Pick<PendingApproval, "classification" | "policyDecision"> {
  if (!actionId) return {};
  const { classification, known } = classifyAction(registry, actionId);
  // `known: false` means the conservative default was substituted. That default
  // is how the GATE fails safe; it is not a statement about this action, so it
  // is not reported as one.
  if (!known) return {};
  return { classification, policyDecision: evaluatePolicy({ action: classification }).decision };
}

/** Trims a record's own text to one line without inventing any of it. */
function oneLine(text: string, max = 160): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}

/**
 * Everything currently awaiting a human decision, from every source.
 *
 * Pure read. No writes, no tool execution, no permission grants, no model calls,
 * no policy enforcement — and it never mutates the rows it reads.
 *
 * Deterministic: newest first, with the composite id as the tiebreak. The
 * tiebreak is load-bearing rather than tidy — several of these tables set
 * `createdAt` from the same clock, so equal timestamps are common and sorting on
 * time alone would return the same data in different orders between calls.
 */
export async function listPendingApprovals(userId: string): Promise<PendingApproval[]> {
  const [agentRuns, supervisorRuns, proposals, connections, experiments] = await Promise.all([
    db.agentRun.findMany({
      where: { userId, status: "WAITING_FOR_PERMISSION" },
      include: { steps: { orderBy: { order: "asc" } } },
    }),
    db.supervisorRun.findMany({
      where: { userId, status: "WAITING_FOR_APPROVAL" },
      include: { objective: { select: { id: true, title: true } } },
    }),
    db.proposal.findMany({ where: { userId, status: "PROPOSED" } }),
    db.connection.findMany({ where: { userId, status: "AWAITING_APPROVAL" } }),
    db.experiment.findMany({ where: { userId, executionStatus: "AWAITING_HUMAN" } }),
  ]);

  const approvals: PendingApproval[] = [
    ...agentRuns.map(fromAgentRun),
    ...supervisorRuns.map(fromSupervisorRun),
    ...proposals.map(fromProposal),
    ...connections.map(fromConnection),
    ...experiments.map(fromExperiment),
  ];

  return approvals.sort(
    (a, b) => b.requestedAt.getTime() - a.requestedAt.getTime() || a.id.localeCompare(b.id)
  );
}

/** Just the ones from one subsystem, same projection. */
export async function listPendingApprovalsBySource(
  userId: string,
  source: PendingApprovalSource
): Promise<PendingApproval[]> {
  return (await listPendingApprovals(userId)).filter((approval) => approval.source === source);
}

/** How many things are waiting, by source. Every source is present, zeros included. */
export async function countPendingApprovals(
  userId: string
): Promise<Record<PendingApprovalSource, number> & { total: number }> {
  const approvals = await listPendingApprovals(userId);
  const counts = Object.fromEntries(PENDING_APPROVAL_SOURCES.map((s) => [s, 0])) as Record<
    PendingApprovalSource,
    number
  >;
  for (const approval of approvals) counts[approval.source] += 1;
  return { ...counts, total: approvals.length };
}

// --- One builder per source. Each maps only what its table actually holds. ---

type AgentRunRow = Awaited<ReturnType<typeof db.agentRun.findMany<{ include: { steps: true } }>>>[number];

/**
 * The waiting step is where the detail lives: the executor writes `capability`
 * and `requiredLevel` onto the step it parked on, so the projection can say
 * exactly what the human would be granting rather than naming the run.
 */
function fromAgentRun(run: AgentRunRow): PendingApproval {
  const step = run.steps.find((s) => s.status === "WAITING_FOR_PERMISSION");
  return {
    id: `AGENT_RUN:${run.id}`,
    source: "AGENT_RUN",
    entityId: run.id,
    status: run.status,
    ...(step?.toolName ? { actionType: step.toolName } : {}),
    summary: oneLine(step?.description ?? run.objective),
    // The run's own updatedAt: when it was parked, which is what a reader means
    // by "waiting since". createdAt would be when the run started, not when it
    // stopped.
    requestedAt: run.updatedAt,
    ...(step?.capability ? { requiredCapability: step.capability } : {}),
    ...(step ? { requiredLevel: step.requiredLevel } : {}),
    targetType: "AgentRun",
    targetId: run.id,
    ...policyFor("tool", step?.toolName),
    // No parked step means nothing to grant — see the field's own note.
    actionable: step !== undefined,
  };
}

type SupervisorRunRow = Awaited<
  ReturnType<typeof db.supervisorRun.findMany<{ include: { objective: { select: { id: true; title: true } } } }>>
>[number];

/**
 * A whole plan, not one action, so no `actionType` and no classification: there
 * is no single registry entry that describes "this plan". Inventing one by
 * classifying the first step would misreport what the human is approving.
 */
function fromSupervisorRun(run: SupervisorRunRow): PendingApproval {
  return {
    id: `SUPERVISOR_RUN:${run.id}`,
    source: "SUPERVISOR_RUN",
    entityId: run.id,
    status: run.status,
    summary: oneLine(run.objective.title),
    requestedAt: run.updatedAt,
    targetType: "Objective",
    targetId: run.objectiveId,
    actionable: true,
  };
}

type ProposalRow = Awaited<ReturnType<typeof db.proposal.findMany>>[number];

/**
 * The richest source: the proposal already carries its own action id, the
 * capability, the required level, and a written suggestion.
 */
function fromProposal(proposal: ProposalRow): PendingApproval {
  return {
    id: `PROPOSAL:${proposal.id}`,
    source: "PROPOSAL",
    entityId: proposal.id,
    status: proposal.status,
    actionType: proposal.actionType,
    summary: oneLine(proposal.suggestedAction),
    requestedAt: proposal.createdAt,
    requiredCapability: proposal.capability,
    requiredLevel: proposal.requiredLevel,
    targetType: "Proposal",
    targetId: proposal.id,
    ...(proposal.observation ? { reason: oneLine(proposal.observation) } : {}),
    // The proposal registry, not the tool registry — separate key spaces, and
    // H-4 (two execution authorities) is not resolved by this phase.
    ...policyFor("proposal", proposal.actionType),
    actionable: true,
  };
}

type ConnectionRow = Awaited<ReturnType<typeof db.connection.findMany>>[number];

/**
 * `readCapability` is what a human would be granting first; `writeCapability`
 * is a second, separate decision (RECOMMEND vs ACT — see grantAccess), so only
 * the read one is named here rather than implying both are on the table.
 */
function fromConnection(connection: ConnectionRow): PendingApproval {
  return {
    id: `CONNECTION:${connection.id}`,
    source: "CONNECTION",
    entityId: connection.id,
    status: connection.status,
    actionType: connection.service,
    summary: oneLine(connection.displayName),
    requestedAt: connection.updatedAt,
    requiredCapability: connection.readCapability,
    targetType: "Connection",
    targetId: connection.id,
    ...(connection.statusReason ? { reason: oneLine(connection.statusReason) } : {}),
    // No registry entry describes "connect a service"; the connection catalog is
    // its own vocabulary. Absent rather than guessed.
    actionable: true,
  };
}

type ExperimentRow = Awaited<ReturnType<typeof db.experiment.findMany>>[number];

/**
 * The economic boundary, surfaced read-side.
 *
 * The scheduler parks an experiment here for exactly two reasons — a SCALE it
 * has no capability to perform, or a contract that stopped being executable —
 * and it writes the reason itself. That recorded reason is passed through
 * verbatim; the projection never restates or interprets an economic decision.
 *
 * Nothing here can move an experiment out of AWAITING_HUMAN. The economic
 * engine remains the only authority over that transition.
 */
function fromExperiment(experiment: ExperimentRow): PendingApproval {
  return {
    id: `ECONOMIC_EXPERIMENT:${experiment.id}`,
    source: "ECONOMIC_EXPERIMENT",
    entityId: experiment.id,
    status: experiment.executionStatus,
    summary: oneLine(experiment.hypothesis),
    // When the decision that parked it was made, falling back to the row's own
    // update time for a record parked before decision timestamps were kept.
    requestedAt: experiment.lastDecisionAt ?? experiment.updatedAt,
    targetType: "Experiment",
    targetId: experiment.id,
    ...(experiment.lastDecisionReason ? { reason: oneLine(experiment.lastDecisionReason) } : {}),
    actionable: true,
  };
}
