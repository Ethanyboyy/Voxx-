import { db } from "@/lib/db";
import type { KnowledgeNodeType } from "@/generated/prisma/enums";

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
