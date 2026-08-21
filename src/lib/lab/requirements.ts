import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import type { LabPriority, LabRequirementStatus, LabSubsystem } from "@/generated/prisma/enums";

export interface CreateRequirementInput {
  userId: string;
  suitId?: string;
  code: string;
  title: string;
  description?: string;
  priority?: LabPriority;
  status?: LabRequirementStatus;
  verificationMethod?: string;
  evidence?: string;
  subsystem?: LabSubsystem;
  componentId?: string;
  experimentId?: string;
}

export async function createRequirement(input: CreateRequirementInput) {
  const requirement = await db.labRequirement.create({
    data: {
      userId: input.userId,
      suitId: input.suitId,
      code: input.code,
      title: input.title,
      description: input.description,
      priority: input.priority ?? "MEDIUM",
      status: input.status ?? "HYPOTHESIS",
      verificationMethod: input.verificationMethod,
      evidence: input.evidence,
      subsystem: input.subsystem,
      componentId: input.componentId,
      experimentId: input.experimentId,
    },
  });

  await recordEvent({
    userId: input.userId,
    type: "lab.requirement.created",
    payload: { code: requirement.code, title: requirement.title, suitId: requirement.suitId },
    subjectType: "LabRequirement",
    subjectId: requirement.id,
  });

  return requirement;
}

export async function listRequirements(userId: string, suitId?: string) {
  return db.labRequirement.findMany({
    where: { userId, suitId },
    include: { component: true, experiment: true },
    orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
  });
}

export async function getRequirement(userId: string, id: string) {
  return db.labRequirement.findFirst({
    where: { id, userId },
    include: { component: true, experiment: true, suit: true },
  });
}

export interface UpdateRequirementInput {
  title?: string;
  description?: string;
  priority?: LabPriority;
  status?: LabRequirementStatus;
  verificationMethod?: string;
  evidence?: string;
  subsystem?: LabSubsystem | null;
  componentId?: string | null;
  experimentId?: string | null;
}

/** VERIFIED must never be reachable without real evidence — enforced here,
 * not just documented, so no caller can silently upgrade a requirement's
 * status without recording what actually justifies it. */
export async function updateRequirement(userId: string, id: string, updates: UpdateRequirementInput) {
  const existing = await db.labRequirement.findFirst({ where: { id, userId } });
  if (!existing) return null;

  if (updates.status === "VERIFIED") {
    const evidence = updates.evidence ?? existing.evidence;
    if (!evidence || !evidence.trim()) {
      throw new Error("A requirement cannot be marked VERIFIED without recording the evidence that verifies it.");
    }
  }

  const requirement = await db.labRequirement.update({ where: { id }, data: updates });

  if (updates.status && updates.status !== existing.status) {
    await recordEvent({
      userId,
      type: "lab.requirement.status_changed",
      payload: { code: requirement.code, from: existing.status, to: updates.status },
      subjectType: "LabRequirement",
      subjectId: id,
    });
  }

  return requirement;
}

export async function deleteRequirement(userId: string, id: string) {
  const existing = await db.labRequirement.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.labRequirement.delete({ where: { id } });
  return true;
}

export async function nextRequirementCode(userId: string, prefix = "REQ") {
  const count = await db.labRequirement.count({ where: { userId } });
  return `${prefix}-${String(count + 1).padStart(3, "0")}`;
}
