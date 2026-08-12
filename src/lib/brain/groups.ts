import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";

/**
 * Real, persistent organization of the Brain workspace. A group's members
 * are Brain node ids ("TYPE:entityId") — descriptive references, not
 * foreign keys, since membership spans many unrelated entity tables.
 * Deleting a group never touches its members' underlying rows.
 */

export interface BrainGroupDTO {
  id: string;
  userId: string;
  name: string;
  description: string | null;
  memberIds: string[];
  color: string | null;
  collapsed: boolean;
  pinned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function parseMemberIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function toDTO(row: { id: string; userId: string; name: string; description: string | null; memberIds: string; color: string | null; collapsed: boolean; pinned: boolean; createdAt: Date; updatedAt: Date }): BrainGroupDTO {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    memberIds: parseMemberIds(row.memberIds),
    color: row.color,
    collapsed: row.collapsed,
    pinned: row.pinned,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface CreateBrainGroupInput {
  userId: string;
  name: string;
  description?: string;
  memberIds: string[];
  color?: string;
}

export async function createBrainGroup(input: CreateBrainGroupInput): Promise<BrainGroupDTO> {
  const row = await db.brainGroup.create({
    data: {
      userId: input.userId,
      name: input.name,
      description: input.description,
      memberIds: JSON.stringify(input.memberIds),
      color: input.color,
    },
  });
  await recordEvent({
    userId: input.userId,
    type: "brain_group.created",
    subjectType: "BrainGroup",
    subjectId: row.id,
    payload: { name: row.name, memberCount: input.memberIds.length },
  });
  return toDTO(row);
}

export async function listBrainGroups(userId: string): Promise<BrainGroupDTO[]> {
  const rows = await db.brainGroup.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
  return rows.map(toDTO);
}

export interface UpdateBrainGroupInput {
  name?: string;
  description?: string;
  memberIds?: string[];
  color?: string | null;
  collapsed?: boolean;
  pinned?: boolean;
}

export async function updateBrainGroup(
  userId: string,
  id: string,
  updates: UpdateBrainGroupInput
): Promise<BrainGroupDTO | null> {
  const existing = await db.brainGroup.findFirst({ where: { id, userId } });
  if (!existing) return null;
  const row = await db.brainGroup.update({
    where: { id },
    data: {
      ...updates,
      memberIds: updates.memberIds === undefined ? undefined : JSON.stringify(updates.memberIds),
    },
  });
  return toDTO(row);
}

export async function deleteBrainGroup(userId: string, id: string): Promise<boolean> {
  const existing = await db.brainGroup.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.brainGroup.delete({ where: { id } });
  return true;
}
