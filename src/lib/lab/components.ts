import { db } from "@/lib/db";
import type { LabConfidence } from "@/generated/prisma/enums";

export interface ComponentNode {
  id: string;
  parentId: string | null;
  name: string;
  description: string | null;
  materialId: string | null;
  materialName: string | null;
  massKg: number | null;
  notes: string | null;
  confidence: LabConfidence;
  order: number;
  children: ComponentNode[];
}

/** Loads every LabComponent for a suit or gadget and assembles the tree
 * client-side (SQLite has no recursive-CTE helper wired up here, and the
 * component counts per suit/gadget are small enough this is cheap). */
export async function getComponentTree(owner: { suitId?: string; gadgetId?: string }): Promise<ComponentNode[]> {
  const flat = await db.labComponent.findMany({
    where: owner.suitId ? { suitId: owner.suitId } : { gadgetId: owner.gadgetId },
    include: { material: { select: { name: true } } },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });

  const nodes = new Map<string, ComponentNode>();
  for (const c of flat) {
    nodes.set(c.id, {
      id: c.id,
      parentId: c.parentId,
      name: c.name,
      description: c.description,
      materialId: c.materialId,
      materialName: c.material?.name ?? null,
      massKg: c.massKg,
      notes: c.notes,
      confidence: c.confidence,
      order: c.order,
      children: [],
    });
  }

  const roots: ComponentNode[] = [];
  for (const node of nodes.values()) {
    if (node.parentId && nodes.has(node.parentId)) {
      nodes.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export interface CreateComponentInput {
  suitId?: string;
  gadgetId?: string;
  parentId?: string;
  name: string;
  description?: string;
  materialId?: string;
  massKg?: number;
  notes?: string;
  confidence?: LabConfidence;
  order?: number;
}

export async function createComponent(input: CreateComponentInput) {
  return db.labComponent.create({
    data: {
      suitId: input.suitId,
      gadgetId: input.gadgetId,
      parentId: input.parentId,
      name: input.name,
      description: input.description,
      materialId: input.materialId,
      massKg: input.massKg,
      notes: input.notes,
      confidence: input.confidence ?? "ESTIMATED",
      order: input.order ?? 0,
    },
  });
}

export async function deleteComponent(id: string) {
  return db.labComponent.delete({ where: { id } });
}
