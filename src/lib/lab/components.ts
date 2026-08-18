import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import type { LabConfidence, LabRealityStatus, LabRiskLevel, LabSubsystem } from "@/generated/prisma/enums";

export interface ComponentDependencyRef {
  id: string;
  dependsOnId: string;
  dependsOnName: string;
  note: string | null;
}

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
  subsystem: LabSubsystem | null;
  powerDrawW: number | null;
  costUsd: number | null;
  riskLevel: LabRiskLevel;
  realityStatus: LabRealityStatus;
  dependsOn: ComponentDependencyRef[];
  children: ComponentNode[];
}

/** Loads every LabComponent for a suit or gadget and assembles the tree
 * client-side (SQLite has no recursive-CTE helper wired up here, and the
 * component counts per suit/gadget are small enough this is cheap). */
export async function getComponentTree(owner: { suitId?: string; gadgetId?: string }): Promise<ComponentNode[]> {
  const flat = await db.labComponent.findMany({
    where: owner.suitId ? { suitId: owner.suitId } : { gadgetId: owner.gadgetId },
    include: {
      material: { select: { name: true } },
      dependsOn: { include: { dependsOn: { select: { name: true } } } },
    },
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
      subsystem: c.subsystem,
      powerDrawW: c.powerDrawW,
      costUsd: c.costUsd,
      riskLevel: c.riskLevel,
      realityStatus: c.realityStatus,
      dependsOn: c.dependsOn.map((d) => ({
        id: d.id,
        dependsOnId: d.dependsOnId,
        dependsOnName: d.dependsOn.name,
        note: d.note,
      })),
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
  subsystem?: LabSubsystem;
  powerDrawW?: number;
  costUsd?: number;
  riskLevel?: LabRiskLevel;
  realityStatus?: LabRealityStatus;
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
      subsystem: input.subsystem,
      powerDrawW: input.powerDrawW,
      costUsd: input.costUsd,
      riskLevel: input.riskLevel ?? "UNKNOWN",
      realityStatus: input.realityStatus ?? "CONCEPT",
    },
  });
}

export interface UpdateComponentInput {
  name?: string;
  description?: string | null;
  materialId?: string | null;
  massKg?: number | null;
  notes?: string | null;
  confidence?: LabConfidence;
  order?: number;
  subsystem?: LabSubsystem | null;
  powerDrawW?: number | null;
  costUsd?: number | null;
  riskLevel?: LabRiskLevel;
  realityStatus?: LabRealityStatus;
}

export async function updateComponent(id: string, updates: UpdateComponentInput) {
  return db.labComponent.update({ where: { id }, data: updates });
}

export async function deleteComponent(id: string) {
  return db.labComponent.delete({ where: { id } });
}

/** Add a directed dependency ("this component depends on that one"). A
 * component cannot depend on itself; duplicate edges are rejected by the
 * schema's unique constraint rather than silently deduped here. */
export async function addComponentDependency(userId: string, componentId: string, dependsOnId: string, note?: string) {
  if (componentId === dependsOnId) throw new Error("A component cannot depend on itself.");
  const dep = await db.labComponentDependency.create({
    data: { componentId, dependsOnId, note },
  });
  await recordEvent({
    userId,
    type: "lab.component.dependency_added",
    payload: { componentId, dependsOnId },
    subjectType: "LabComponent",
    subjectId: componentId,
  });
  return dep;
}

export async function removeComponentDependency(id: string) {
  return db.labComponentDependency.delete({ where: { id } });
}
