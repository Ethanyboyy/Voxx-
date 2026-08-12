import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import {
  createNode,
  createConnection,
  deleteNode,
  ensureNodeForEntity,
  getNodeForEntity,
  findRelated,
  getGraph,
} from "@/lib/knowledge/service";
import { createProject, createTask } from "@/lib/projects/service";
import { createTestUser } from "./helpers";

describe("knowledge graph — baseline nodes and connections", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("creates a free-floating node with no entity link", async () => {
    const node = await createNode({ userId, label: "Ethan", type: "PERSON" });
    expect(node.type).toBe("PERSON");
    expect(node.memoryId).toBeNull();
    expect(node.projectId).toBeNull();
  });

  it("connects two nodes and both directions are queryable", async () => {
    const a = await createNode({ userId, label: "Ethan", type: "PERSON" });
    const b = await createNode({ userId, label: "Online Shop", type: "ORGANIZATION" });
    const connection = await createConnection({ userId, fromNodeId: a.id, toNodeId: b.id, relation: "owns" });
    expect(connection?.relation).toBe("owns");

    const graph = await getGraph(userId);
    expect(graph.connections.some((c) => c.id === connection?.id)).toBe(true);
  });

  it("refuses to connect a node that doesn't belong to the user", async () => {
    const a = await createNode({ userId, label: "Mine", type: "CONCEPT" });
    const otherUser = await createTestUser();
    const foreign = await createNode({ userId: otherUser.id, label: "Not mine", type: "CONCEPT" });

    const connection = await createConnection({ userId, fromNodeId: a.id, toNodeId: foreign.id, relation: "related_to" });
    expect(connection).toBeNull();
  });

  it("deleting a node removes it", async () => {
    const node = await createNode({ userId, label: "Temporary", type: "TOPIC" });
    expect(await deleteNode(userId, node.id)).toBe(true);
    expect(await deleteNode(userId, node.id)).toBe(false);
  });
});

describe("knowledge graph — linking first-class records", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("ensureNodeForEntity is idempotent per (userId, entityType, entityId)", async () => {
    const project = await createProject({ userId, name: "Online Shop" });
    const first = await ensureNodeForEntity(userId, "PROJECT", project.id, project.name);
    const second = await ensureNodeForEntity(userId, "PROJECT", project.id, project.name);
    expect(second.id).toBe(first.id);

    const count = await db.knowledgeNode.count({ where: { userId, projectId: project.id } });
    expect(count).toBe(1);
  });

  it("getNodeForEntity finds the linked node", async () => {
    const project = await createProject({ userId, name: "Another Project" });
    const node = await ensureNodeForEntity(userId, "PROJECT", project.id, project.name);
    const found = await getNodeForEntity(userId, "PROJECT", project.id);
    expect(found?.id).toBe(node.id);
  });

  it("deleting the underlying record cascades and removes the graph node (real FK, not a dangling reference)", async () => {
    const project = await createProject({ userId, name: "Cascade Test" });
    const node = await ensureNodeForEntity(userId, "PROJECT", project.id, project.name);

    await db.project.delete({ where: { id: project.id } });

    const stillThere = await db.knowledgeNode.findUnique({ where: { id: node.id } });
    expect(stillThere).toBeNull();
  });

  it("findRelated does a bounded BFS traversal and reports relation + direction", async () => {
    const project = await createProject({ userId, name: "Traversal Project" });
    const task = await createTask({ userId, projectId: project.id, title: "Traversal Task" });

    const projectNode = await ensureNodeForEntity(userId, "PROJECT", project.id, project.name);
    const taskNode = await ensureNodeForEntity(userId, "TASK", task.id, task.title);
    const personNode = await createNode({ userId, label: "Ethan", type: "PERSON" });

    await createConnection({ userId, fromNodeId: personNode.id, toNodeId: projectNode.id, relation: "owns" });
    await createConnection({ userId, fromNodeId: projectNode.id, toNodeId: taskNode.id, relation: "has_task" });

    const depth1 = await findRelated(userId, projectNode.id, 1);
    expect(depth1.map((r) => r.node.id).sort()).toEqual([personNode.id, taskNode.id].sort());
    expect(depth1.find((r) => r.node.id === personNode.id)?.direction).toBe("incoming");
    expect(depth1.find((r) => r.node.id === taskNode.id)?.direction).toBe("outgoing");

    const depth1FromPerson = await findRelated(userId, personNode.id, 1);
    expect(depth1FromPerson.map((r) => r.node.id)).toEqual([projectNode.id]);

    const depth2FromPerson = await findRelated(userId, personNode.id, 2);
    expect(depth2FromPerson.map((r) => r.node.id).sort()).toEqual([projectNode.id, taskNode.id].sort());
  });

  it("findRelated never revisits a node already seen (no infinite loop on a cycle)", async () => {
    const a = await createNode({ userId, label: "A", type: "CONCEPT" });
    const b = await createNode({ userId, label: "B", type: "CONCEPT" });
    await createConnection({ userId, fromNodeId: a.id, toNodeId: b.id, relation: "relates_to" });
    await createConnection({ userId, fromNodeId: b.id, toNodeId: a.id, relation: "relates_to" });

    const related = await findRelated(userId, a.id, 3);
    expect(related).toHaveLength(1);
    expect(related[0].node.id).toBe(b.id);
  });
});
