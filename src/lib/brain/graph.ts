import { listObjectives, listOpportunities, scoreOpportunity, explainOpportunityScore } from "@/lib/objectives/service";
import { listProjects, listTasks } from "@/lib/projects/service";
import { listProposals } from "@/lib/cognition/proposals";
import { listConnections } from "@/lib/connections/service";
import { listMemories } from "@/lib/memory/service";
import { listResearchItems } from "@/lib/research/service";
import { listAgentRuns } from "@/lib/agents/service";
import { listSupervisorRuns } from "@/lib/supervisor/service";

/**
 * The Brain workspace's data source. Every node here is a real VOX entity —
 * this module never invents a node, an edge, or a status. If nothing exists
 * yet, the corresponding array is simply empty and the workspace shows an
 * honest empty state.
 */

export type BrainNodeType =
  | "OBJECTIVE"
  | "OPPORTUNITY"
  | "PROJECT"
  | "TASK"
  | "RESEARCH"
  | "PROPOSAL"
  | "CONNECTION"
  | "MEMORY"
  | "AGENT_RUN"
  | "SUPERVISOR_RUN";

export interface BrainNode {
  /** `${type}:${entityId}` — unique across the whole graph. */
  id: string;
  entityId: string;
  type: BrainNodeType;
  label: string;
  status: string | null;
  updatedAt: string;
  /** Type-specific fields, kept loose here — the UI narrows by `type`. */
  meta: Record<string, unknown>;
}

export interface BrainEdge {
  id: string;
  from: string;
  to: string;
  /** e.g. "targets", "promoted_to", "assigned_to", "supports" — descriptive only. */
  relation: string;
}

export interface BrainGraph {
  nodes: BrainNode[];
  edges: BrainEdge[];
  /** Real counts behind any truncation below, so the UI can say "+N more" honestly. */
  totals: {
    memories: number;
    research: number;
    tasks: number;
  };
}

const MEMORY_LIMIT = 24;
const RESEARCH_LIMIT = 40;

export async function getBrainGraph(userId: string): Promise<BrainGraph> {
  const [objectives, opportunities, projects, tasks, proposals, connections, memories, research, agentRuns, supervisorRuns] =
    await Promise.all([
      listObjectives(userId),
      listOpportunities(userId),
      listProjects(userId),
      listTasks(userId),
      listProposals(userId, "PROPOSED"),
      listConnections(userId),
      listMemories(userId, { confidence: "CONFIRMED" }),
      listResearchItems(userId, RESEARCH_LIMIT),
      listAgentRuns(userId, 10),
      listSupervisorRuns(userId, 10),
    ]);

  const nodes: BrainNode[] = [];
  const edges: BrainEdge[] = [];
  let edgeSeq = 0;
  const nextEdgeId = () => `e${edgeSeq++}`;

  for (const o of objectives) {
    nodes.push({
      id: `OBJECTIVE:${o.id}`,
      entityId: o.id,
      type: "OBJECTIVE",
      label: o.title,
      status: o.status,
      updatedAt: o.updatedAt.toISOString(),
      meta: {
        description: o.description,
        strategy: o.strategy,
        assumptions: o.assumptions,
        targetValue: o.targetValue,
        targetUnit: o.targetUnit,
        currentValue: o.currentValue,
        targetDate: o.targetDate?.toISOString() ?? null,
      },
    });
  }

  const projectHasOpportunityParent = new Set<string>();

  // Next Best Action ranking, mirroring getNextBestAction()'s own logic
  // exactly (same scoring function, same candidate filter) so the graph
  // never shows a different "top" opportunity than the dashboard does.
  const rankableStatuses = new Set(["ACTIVE", "EVALUATING", "IDEA"]);
  const topOpportunityIdByObjective = new Map<string, string>();
  for (const objective of objectives) {
    const candidates = opportunities.filter((o) => o.objectiveId === objective.id && rankableStatuses.has(o.status));
    if (candidates.length === 0) continue;
    const top = [...candidates].sort((a, b) => scoreOpportunity(b) - scoreOpportunity(a))[0];
    if (top) topOpportunityIdByObjective.set(objective.id, top.id);
  }

  for (const op of opportunities) {
    const nodeId = `OPPORTUNITY:${op.id}`;
    nodes.push({
      id: nodeId,
      entityId: op.id,
      type: "OPPORTUNITY",
      label: op.title,
      status: op.status,
      updatedAt: op.updatedAt.toISOString(),
      meta: {
        description: op.description,
        objectiveId: op.objectiveId,
        estimatedValue: op.estimatedValue,
        effort: op.effort,
        confidence: op.confidence,
        risk: op.risk,
        nextAction: op.nextAction,
        evidence: op.evidence,
        projectId: op.projectId,
        rankScore: scoreOpportunity(op),
        isNextBestAction: topOpportunityIdByObjective.get(op.objectiveId) === op.id,
        scoreBreakdown: explainOpportunityScore(op),
      },
    });
    edges.push({ id: nextEdgeId(), from: `OBJECTIVE:${op.objectiveId}`, to: nodeId, relation: "targets" });
    if (op.projectId) {
      edges.push({ id: nextEdgeId(), from: nodeId, to: `PROJECT:${op.projectId}`, relation: "promoted_to" });
      projectHasOpportunityParent.add(op.projectId);
    }
  }

  for (const p of projects) {
    nodes.push({
      id: `PROJECT:${p.id}`,
      entityId: p.id,
      type: "PROJECT",
      label: p.name,
      status: p.status,
      updatedAt: p.updatedAt.toISOString(),
      meta: { description: p.description, standalone: !projectHasOpportunityParent.has(p.id) },
    });
  }

  const activeTasks = tasks.filter((t) => t.status !== "CANCELLED");
  for (const t of activeTasks) {
    const nodeId = `TASK:${t.id}`;
    nodes.push({
      id: nodeId,
      entityId: t.id,
      type: "TASK",
      label: t.title,
      status: t.status,
      updatedAt: t.updatedAt.toISOString(),
      meta: {
        description: t.description,
        priority: t.priority,
        difficulty: t.difficulty,
        estimatedMinutes: t.estimatedMinutes,
        dueDate: t.dueDate?.toISOString() ?? null,
        completedAt: t.completedAt?.toISOString() ?? null,
        projectId: t.projectId,
      },
    });
    if (t.projectId) {
      edges.push({ id: nextEdgeId(), from: `PROJECT:${t.projectId}`, to: nodeId, relation: "contains" });
    }
  }

  for (const r of research) {
    const nodeId = `RESEARCH:${r.id}`;
    nodes.push({
      id: nodeId,
      entityId: r.id,
      type: "RESEARCH",
      label: r.title ?? r.query,
      status: null,
      updatedAt: r.createdAt.toISOString(),
      meta: {
        query: r.query,
        sourceUrl: r.sourceUrl,
        summary: r.summary,
        relevance: r.relevance,
        confidence: r.confidence,
        provider: r.provider,
        opportunityId: r.opportunityId,
      },
    });
    if (r.opportunityId) {
      edges.push({ id: nextEdgeId(), from: `OPPORTUNITY:${r.opportunityId}`, to: nodeId, relation: "evidenced_by" });
    }
  }

  for (const p of proposals) {
    nodes.push({
      id: `PROPOSAL:${p.id}`,
      entityId: p.id,
      type: "PROPOSAL",
      label: p.suggestedAction,
      status: p.status,
      updatedAt: p.createdAt.toISOString(),
      meta: {
        observation: p.observation,
        implication: p.implication,
        capability: p.capability,
        requiredLevel: p.requiredLevel,
        confidence: p.confidence,
      },
    });
  }

  const liveConnections = connections.filter((c) => c.status !== "NOT_CONNECTED");
  for (const c of liveConnections) {
    if (!c.connection) continue;
    nodes.push({
      id: `CONNECTION:${c.connection.id}`,
      entityId: c.connection.id,
      type: "CONNECTION",
      label: c.catalog.displayName,
      status: c.status,
      updatedAt: c.connection.updatedAt.toISOString(),
      meta: { category: c.catalog.category, isConfigured: c.isConfigured },
    });
  }

  const memorySlice = memories.slice(0, MEMORY_LIMIT);
  for (const m of memorySlice) {
    nodes.push({
      id: `MEMORY:${m.id}`,
      entityId: m.id,
      type: "MEMORY",
      label: m.content,
      status: null,
      updatedAt: m.updatedAt.toISOString(),
      meta: { category: m.category, confidence: m.confidence },
    });
  }

  for (const run of agentRuns) {
    const nodeId = `AGENT_RUN:${run.id}`;
    nodes.push({
      id: nodeId,
      entityId: run.id,
      type: "AGENT_RUN",
      label: run.objective,
      status: run.status,
      updatedAt: run.updatedAt.toISOString(),
      meta: {
        currentStep: run.currentStep,
        stepCount: run.steps.length,
        result: run.result,
        error: run.error,
        projectId: run.projectId,
      },
    });
    if (run.projectId) {
      edges.push({ id: nextEdgeId(), from: `PROJECT:${run.projectId}`, to: nodeId, relation: "executed_by" });
    }
  }

  for (const sup of supervisorRuns) {
    const nodeId = `SUPERVISOR_RUN:${sup.id}`;
    nodes.push({
      id: nodeId,
      entityId: sup.id,
      type: "SUPERVISOR_RUN",
      label: `Supervising: ${objectives.find((o) => o.id === sup.objectiveId)?.title ?? sup.objectiveId}`,
      status: sup.status,
      updatedAt: sup.updatedAt.toISOString(),
      meta: {
        objectiveId: sup.objectiveId,
        agentId: sup.agentId,
        iterations: sup.iterations,
        maxIterations: sup.maxIterations,
        result: sup.result,
        error: sup.error,
      },
    });
    edges.push({ id: nextEdgeId(), from: `OBJECTIVE:${sup.objectiveId}`, to: nodeId, relation: "supervised_by" });
    for (const run of sup.agentRuns) {
      // Only draw the edge when the AgentRun node actually made it into this
      // slice (agentRuns above is capped at 10, most-recent-first) — never
      // draw an edge to a node that isn't in the graph.
      if (agentRuns.some((r) => r.id === run.id)) {
        edges.push({ id: nextEdgeId(), from: nodeId, to: `AGENT_RUN:${run.id}`, relation: "drives" });
      }
    }
  }

  return {
    nodes,
    edges,
    totals: {
      memories: memories.length,
      research: research.length,
      tasks: activeTasks.length,
    },
  };
}

/**
 * The Brain's own state, derived from real backend signals only — never a
 * decorative animation cycle. Priority order matters: an error or a pending
 * approval should be visible even if something else is also true.
 */
export type BrainState =
  | "idle"
  | "thinking"
  | "researching"
  | "executing"
  | "waiting"
  | "learning"
  | "error";

export async function getBrainState(userId: string): Promise<{ state: BrainState; detail: string | null }> {
  const [agentRuns, pendingProposals, supervisorRuns, objectives] = await Promise.all([
    listAgentRuns(userId, 5),
    listProposals(userId, "PROPOSED"),
    listSupervisorRuns(userId, 5),
    listObjectives(userId),
  ]);

  const objectiveTitle = (objectiveId: string) => objectives.find((o) => o.id === objectiveId)?.title ?? "an objective";

  const failedSupervisor = supervisorRuns.find((s) => s.status === "FAILED");
  if (failedSupervisor) return { state: "error", detail: failedSupervisor.error ?? "A supervisor run failed." };

  const failed = agentRuns.find((r) => r.status === "FAILED");
  if (failed) return { state: "error", detail: failed.error ?? "An agent run failed." };

  const waitingApproval = supervisorRuns.find((s) => s.status === "WAITING_FOR_APPROVAL");
  if (waitingApproval) return { state: "waiting", detail: `Approval needed to continue ${objectiveTitle(waitingApproval.objectiveId)}` };

  const supervising = supervisorRuns.find((s) => s.status === "RUNNING" || s.status === "PLANNING" || s.status === "REPLANNING");
  if (supervising) return { state: "executing", detail: `Working on ${objectiveTitle(supervising.objectiveId)}` };

  const running = agentRuns.find((r) => r.status === "RUNNING");
  if (running) return { state: "executing", detail: running.objective };

  const waitingRun = agentRuns.find((r) => r.status === "WAITING_FOR_PERMISSION" || r.status === "WAITING");
  if (waitingRun) return { state: "waiting", detail: waitingRun.objective };

  if (pendingProposals.length > 0) {
    return { state: "waiting", detail: `${pendingProposals.length} proposal(s) awaiting approval` };
  }

  const planning = agentRuns.find((r) => r.status === "PLANNING");
  if (planning) return { state: "thinking", detail: planning.objective };

  return { state: "idle", detail: null };
}
