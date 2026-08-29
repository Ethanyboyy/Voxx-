import { db } from "@/lib/db";
import type { KnowledgeNodeType } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";

export interface CreateNodeInput {
  userId: string;
  label: string;
  type?: KnowledgeNodeType;
  description?: string;
}

export async function createNode(input: CreateNodeInput) {
  return db.knowledgeNode.create({
    data: {
      userId: input.userId,
      label: input.label,
      type: input.type ?? "ENTITY",
      description: input.description,
    },
  });
}

export async function listNodes(userId: string) {
  return db.knowledgeNode.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
}

export async function deleteNode(userId: string, id: string) {
  const existing = await db.knowledgeNode.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.knowledgeNode.delete({ where: { id } });
  return true;
}

export interface CreateConnectionInput {
  userId: string;
  fromNodeId: string;
  toNodeId: string;
  relation: string;
}

export async function createConnection(input: CreateConnectionInput) {
  const [fromNode, toNode] = await Promise.all([
    db.knowledgeNode.findFirst({ where: { id: input.fromNodeId, userId: input.userId } }),
    db.knowledgeNode.findFirst({ where: { id: input.toNodeId, userId: input.userId } }),
  ]);
  if (!fromNode || !toNode) return null;

  return db.knowledgeConnection.create({
    data: {
      userId: input.userId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      relation: input.relation,
    },
  });
}

/** Full graph for the user: nodes plus their connections, suitable for the reasoning engine or a graph view. */
export async function getGraph(userId: string) {
  const [nodes, connections] = await Promise.all([
    db.knowledgeNode.findMany({ where: { userId } }),
    db.knowledgeConnection.findMany({ where: { userId } }),
  ]);
  return { nodes, connections };
}

export async function deleteConnection(userId: string, id: string) {
  const existing = await db.knowledgeConnection.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.knowledgeConnection.delete({ where: { id } });
  return true;
}

// ---------------------------------------------------------------------------
// Linking first-class VOX records into the graph
// ---------------------------------------------------------------------------

export type LinkableEntityType =
  | "MEMORY"
  | "PROJECT"
  | "GOAL"
  | "TASK"
  | "DECISION"
  | "IDEA"
  | "EXPERIMENT"
  | "RESEARCH_ITEM"
  | "OBJECTIVE"
  | "LAB_EXPERIMENT"
  | "LAB_SIMULATION";

const DEFAULT_NODE_TYPE: Record<LinkableEntityType, KnowledgeNodeType> = {
  MEMORY: "ENTITY",
  PROJECT: "PROJECT",
  GOAL: "GOAL",
  TASK: "ENTITY",
  DECISION: "ENTITY",
  IDEA: "ENTITY",
  EXPERIMENT: "ENTITY",
  RESEARCH_ITEM: "TOPIC",
  // An Objective is a thing the user is trying to achieve — the same shape
  // as a Goal in graph terms, so it reuses that node type rather than
  // introducing a near-duplicate one.
  OBJECTIVE: "GOAL",
  // A Lab experiment is an investigation into how something behaves, and a
  // simulation is a model of it — both are topics the graph reasons about,
  // not projects or goals.
  LAB_EXPERIMENT: "TOPIC",
  LAB_SIMULATION: "TOPIC",
};

/**
 * Builds the { <x>Id: entityId } fragment for the given entity type. Written
 * as an explicit switch (not a computed `[field]: id`) so Prisma's generated
 * input types stay fully checked — a dynamic string key can't be verified
 * against KnowledgeNodeWhereUniqueInput / …CreateInput at compile time.
 */
function linkFragment(entityType: LinkableEntityType, entityId: string) {
  switch (entityType) {
    case "MEMORY":
      return { memoryId: entityId };
    case "PROJECT":
      return { projectId: entityId };
    case "GOAL":
      return { goalId: entityId };
    case "TASK":
      return { taskId: entityId };
    case "DECISION":
      return { decisionId: entityId };
    case "IDEA":
      return { ideaId: entityId };
    case "EXPERIMENT":
      return { experimentId: entityId };
    case "RESEARCH_ITEM":
      return { researchItemId: entityId };
    case "OBJECTIVE":
      return { objectiveId: entityId };
    case "LAB_EXPERIMENT":
      return { labExperimentId: entityId };
    case "LAB_SIMULATION":
      return { labSimulationId: entityId };
  }
}

/**
 * Get-or-create a graph node mirroring a first-class VOX record. Idempotent
 * per (userId, entityType, entityId) — safe to call every time something
 * needs to be connected in the graph without worrying about duplicates.
 * Graph nodes are NOT backfilled proactively for every existing record —
 * only created when something actually needs to reference the entity in the
 * graph, so the graph stays a curated view rather than a mirror of the
 * entire database.
 */
export async function ensureNodeForEntity(
  userId: string,
  entityType: LinkableEntityType,
  entityId: string,
  label: string,
  description?: string
) {
  const link = linkFragment(entityType, entityId);
  const existing = await db.knowledgeNode.findFirst({
    where: { userId, ...link } as Prisma.KnowledgeNodeWhereInput,
  });
  if (existing) return existing;

  return db.knowledgeNode.create({
    data: {
      userId,
      label,
      type: DEFAULT_NODE_TYPE[entityType],
      description,
      ...link,
    },
  });
}

export async function getNodeForEntity(userId: string, entityType: LinkableEntityType, entityId: string) {
  const link = linkFragment(entityType, entityId);
  return db.knowledgeNode.findFirst({ where: { userId, ...link } as Prisma.KnowledgeNodeWhereInput });
}

export interface RelatedNode {
  node: Awaited<ReturnType<typeof listNodes>>[number];
  relation: string;
  direction: "outgoing" | "incoming";
  depth: number;
}

/**
 * Bounded breadth-first traversal from a node — for the reasoning layer and
 * the graph explorer UI. In-process over what's expected to be at most a
 * few thousand rows for a personal instance, not a graph database.
 */
export async function findRelated(userId: string, nodeId: string, depth = 1): Promise<RelatedNode[]> {
  const maxDepth = Math.min(Math.max(depth, 1), 3);
  const visited = new Set<string>([nodeId]);
  const results: RelatedNode[] = [];
  let frontier = [nodeId];

  for (let level = 1; level <= maxDepth && frontier.length > 0; level++) {
    const connections = await db.knowledgeConnection.findMany({
      where: {
        userId,
        OR: [{ fromNodeId: { in: frontier } }, { toNodeId: { in: frontier } }],
      },
      include: { fromNode: true, toNode: true },
    });

    const nextFrontier: string[] = [];
    for (const connection of connections) {
      const outgoing = frontier.includes(connection.fromNodeId);
      const neighbor = outgoing ? connection.toNode : connection.fromNode;
      if (visited.has(neighbor.id)) continue;
      visited.add(neighbor.id);
      nextFrontier.push(neighbor.id);
      results.push({
        node: neighbor,
        relation: connection.relation,
        direction: outgoing ? "outgoing" : "incoming",
        depth: level,
      });
    }
    frontier = nextFrontier;
  }

  return results;
}
