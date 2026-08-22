import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import type { AgentStatus } from "@/generated/prisma/enums";
import type { Agent } from "@/generated/prisma/client";

export interface CreateAgentInput {
  userId: string;
  name: string;
  description?: string;
  instructions?: string;
  /** Capability keys this agent's runs may ever use — see the model's doc
   * comment in schema.prisma. Empty by default: an agent starts able to run
   * only no-tool reasoning steps until capabilities are explicitly added. */
  allowedCapabilities?: string[];
}

function toAgentDTO(agent: Agent) {
  return { ...agent, allowedCapabilities: JSON.parse(agent.allowedCapabilities) as string[] };
}

export async function createAgent(input: CreateAgentInput) {
  const agent = await db.agent.create({
    data: {
      userId: input.userId,
      name: input.name,
      description: input.description,
      instructions: input.instructions,
      allowedCapabilities: JSON.stringify(input.allowedCapabilities ?? []),
    },
  });
  await recordEvent({ userId: input.userId, type: "agent.created", subjectType: "Agent", subjectId: agent.id, payload: { name: agent.name } });
  return toAgentDTO(agent);
}

export async function listAgents(userId: string) {
  const agents = await db.agent.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
  return agents.map(toAgentDTO);
}

export async function getAgent(userId: string, id: string) {
  const agent = await db.agent.findFirst({
    where: { id, userId },
    include: { runs: { orderBy: { createdAt: "desc" }, take: 10 } },
  });
  return agent ? toAgentDTO(agent) : null;
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  instructions?: string;
  status?: AgentStatus;
  allowedCapabilities?: string[];
}

export async function updateAgent(userId: string, id: string, updates: UpdateAgentInput) {
  const existing = await db.agent.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const agent = await db.agent.update({
    where: { id },
    data: {
      name: updates.name,
      description: updates.description,
      instructions: updates.instructions,
      status: updates.status,
      allowedCapabilities: updates.allowedCapabilities ? JSON.stringify(updates.allowedCapabilities) : undefined,
    },
  });

  if (updates.status && updates.status !== existing.status) {
    await recordEvent({ userId, type: "agent.status_changed", subjectType: "Agent", subjectId: id, payload: { from: existing.status, to: updates.status } });
  }
  return toAgentDTO(agent);
}

export async function deleteAgent(userId: string, id: string) {
  const existing = await db.agent.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.agent.delete({ where: { id } });
  return true;
}
