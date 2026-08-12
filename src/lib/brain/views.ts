import { db } from "@/lib/db";

/**
 * A saved Brain configuration — perspective, density, pinned/attention state,
 * camera position — the user can return to by name. Pure UI-state snapshot,
 * never a second source of truth for the underlying graph.
 */

export interface BrainViewDTO {
  id: string;
  userId: string;
  name: string;
  state: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

function toDTO(row: { id: string; userId: string; name: string; state: string; createdAt: Date; updatedAt: Date }): BrainViewDTO {
  let state: Record<string, unknown> = {};
  try {
    state = JSON.parse(row.state);
  } catch {
    state = {};
  }
  return { id: row.id, userId: row.userId, name: row.name, state, createdAt: row.createdAt, updatedAt: row.updatedAt };
}

export async function saveBrainView(userId: string, name: string, state: Record<string, unknown>): Promise<BrainViewDTO> {
  const row = await db.brainView.upsert({
    where: { userId_name: { userId, name } },
    create: { userId, name, state: JSON.stringify(state) },
    update: { state: JSON.stringify(state) },
  });
  return toDTO(row);
}

export async function listBrainViews(userId: string): Promise<BrainViewDTO[]> {
  const rows = await db.brainView.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
  return rows.map(toDTO);
}

export async function deleteBrainView(userId: string, id: string): Promise<boolean> {
  const existing = await db.brainView.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.brainView.delete({ where: { id } });
  return true;
}
