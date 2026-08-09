import { db } from "@/lib/db";
import { enforceCapability } from "@/lib/permissions/service";
import { recordEvent } from "@/lib/observability/events";
import { createMemoryRelation } from "@/lib/memory/relations";
import { createTask } from "@/lib/projects/service";
import { createConnection } from "@/lib/knowledge/service";
import type { CapabilityLevel, Confidence } from "@/generated/prisma/enums";

export interface CreateProposalInput {
  userId: string;
  observation: string;
  connection?: string;
  implication?: string;
  suggestedAction: string;
  actionType: string;
  actionPayload: Record<string, unknown>;
  capability: string;
  requiredLevel?: CapabilityLevel;
  confidence?: Confidence;
  evidence?: {
    memoryIds?: string[];
    researchItemIds?: string[];
    observationIds?: string[];
    eventIds?: string[];
  };
}

/**
 * "Observed X. Connected it with Y. Possible implication: Z. Suggested
 * action: A. Permission required." Always starts PROPOSED — nothing here
 * executes anything. See approveProposal() for the only path to execution,
 * which is gated by the real permission system.
 */
export async function createProposal(input: CreateProposalInput) {
  const proposal = await db.proposal.create({
    data: {
      userId: input.userId,
      observation: input.observation,
      connection: input.connection,
      implication: input.implication,
      suggestedAction: input.suggestedAction,
      actionType: input.actionType,
      actionPayload: JSON.stringify(input.actionPayload),
      capability: input.capability,
      requiredLevel: input.requiredLevel ?? "RECOMMEND",
      confidence: input.confidence ?? "LOW",
      evidence: input.evidence ? JSON.stringify(input.evidence) : null,
    },
  });
  await recordEvent({
    userId: input.userId,
    type: "proposal.created",
    subjectType: "Proposal",
    subjectId: proposal.id,
    payload: { actionType: input.actionType, capability: input.capability },
  });
  return proposal;
}

export async function listProposals(userId: string, status?: string) {
  return db.proposal.findMany({
    where: { userId, status: status as never },
    orderBy: { createdAt: "desc" },
  });
}

export async function getProposal(userId: string, id: string) {
  return db.proposal.findFirst({ where: { id, userId } });
}

/**
 * Closed, internal-only action registry. Every entry is a safe operation
 * that already existed as a normal VOX service function — nothing here
 * reaches outside VOX. Adding a future integration with a real external
 * side effect means adding one handler that itself calls
 * enforceCapability() at ACT; the proposal machinery doesn't change.
 */
type ActionHandler = (userId: string, payload: Record<string, unknown>) => Promise<string>;

const ACTION_HANDLERS: Record<string, ActionHandler> = {
  "memory.create_relation": async (userId, payload) => {
    const relation = await createMemoryRelation({
      userId,
      fromMemoryId: String(payload.fromMemoryId),
      toMemoryId: String(payload.toMemoryId),
      type: (payload.type as never) ?? "RELATES_TO",
      note: payload.note ? String(payload.note) : undefined,
      confidence: (payload.confidence as never) ?? "LOW",
    });
    if (!relation) throw new Error("One or both memories were not found.");
    return `Recorded a ${relation.type} relation between the two memories.`;
  },
  "task.create": async (userId, payload) => {
    const task = await createTask({
      userId,
      title: String(payload.title),
      description: payload.description ? String(payload.description) : undefined,
      projectId: payload.projectId ? String(payload.projectId) : undefined,
    });
    return `Created task "${task.title}".`;
  },
  "knowledge.create_connection": async (userId, payload) => {
    const connection = await createConnection({
      userId,
      fromNodeId: String(payload.fromNodeId),
      toNodeId: String(payload.toNodeId),
      relation: String(payload.relation),
    });
    if (!connection) throw new Error("One or both knowledge nodes were not found.");
    return `Linked two knowledge graph nodes ("${payload.relation}").`;
  },
};

export async function approveProposal(userId: string, id: string) {
  const proposal = await db.proposal.findFirst({ where: { id, userId } });
  if (!proposal) return null;
  if (proposal.status !== "PROPOSED") return proposal;

  // The actual gate. Throws PermissionDeniedError if not granted — the
  // caller (API route) maps that to 403. Nothing below this line runs
  // unless this succeeds.
  await enforceCapability(userId, proposal.capability, proposal.requiredLevel);

  await recordEvent({
    userId,
    type: "proposal.approved",
    subjectType: "Proposal",
    subjectId: proposal.id,
    consequential: true,
  });

  const handler = ACTION_HANDLERS[proposal.actionType];
  if (!handler) {
    return db.proposal.update({
      where: { id },
      data: { status: "FAILED", result: `No handler registered for action "${proposal.actionType}".`, resolvedAt: new Date() },
    });
  }

  try {
    const payload = JSON.parse(proposal.actionPayload) as Record<string, unknown>;
    const result = await handler(userId, payload);
    const executed = await db.proposal.update({
      where: { id },
      data: { status: "EXECUTED", result, resolvedAt: new Date() },
    });
    await recordEvent({
      userId,
      type: "proposal.executed",
      subjectType: "Proposal",
      subjectId: proposal.id,
      payload: { result },
      consequential: true,
    });
    return executed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await db.proposal.update({
      where: { id },
      data: { status: "FAILED", result: message, resolvedAt: new Date() },
    });
    await recordEvent({
      userId,
      type: "proposal.execution_failed",
      subjectType: "Proposal",
      subjectId: proposal.id,
      payload: { error: message },
      consequential: true,
    });
    return failed;
  }
}

export async function denyProposal(userId: string, id: string, reason?: string) {
  const proposal = await db.proposal.findFirst({ where: { id, userId } });
  if (!proposal) return null;
  if (proposal.status !== "PROPOSED") return proposal;

  const denied = await db.proposal.update({
    where: { id },
    data: { status: "DENIED", result: reason ?? null, resolvedAt: new Date() },
  });
  await recordEvent({
    userId,
    type: "proposal.denied",
    subjectType: "Proposal",
    subjectId: proposal.id,
    payload: { reason },
    consequential: true,
  });
  return denied;
}
