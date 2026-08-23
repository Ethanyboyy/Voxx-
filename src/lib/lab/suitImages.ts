// Suit concept-art references — VOX never generates these images itself
// (no image-generation provider is configured; see the LabSuitImage doc
// comment in schema.prisma). This service only stores/serves URLs a human
// supplies after producing/approving real artwork, exactly like
// LabSuit.modelUrl already does for .glb files. Same "direct user CRUD on
// their own data" posture as the rest of the Lab — no capability gating.
import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import type { LabSuitImageKind } from "@/generated/prisma/enums";

export interface AddSuitImageInput {
  userId: string;
  suitId: string;
  kind: LabSuitImageKind;
  url: string;
  label?: string;
}

async function ownedSuit(userId: string, suitId: string) {
  return db.labSuit.findFirst({ where: { id: suitId, userId } });
}

export async function listSuitImages(userId: string, suitId: string) {
  const suit = await ownedSuit(userId, suitId);
  if (!suit) return null;
  return db.labSuitImage.findMany({ where: { suitId }, orderBy: { createdAt: "asc" } });
}

export async function addSuitImage(input: AddSuitImageInput) {
  const suit = await ownedSuit(input.userId, input.suitId);
  if (!suit) return null;

  const image = await db.labSuitImage.create({
    data: { suitId: input.suitId, kind: input.kind, url: input.url, label: input.label },
  });

  await recordEvent({
    userId: input.userId,
    type: "lab.suit.image_added",
    subjectType: "LabSuit",
    subjectId: input.suitId,
    payload: { imageId: image.id, kind: image.kind },
  });

  return image;
}

export async function deleteSuitImage(userId: string, suitId: string, imageId: string): Promise<boolean> {
  const suit = await ownedSuit(userId, suitId);
  if (!suit) return false;
  const existing = await db.labSuitImage.findFirst({ where: { id: imageId, suitId } });
  if (!existing) return false;

  await db.labSuitImage.delete({ where: { id: imageId } });
  await recordEvent({
    userId,
    type: "lab.suit.image_removed",
    subjectType: "LabSuit",
    subjectId: suitId,
    payload: { imageId },
  });
  return true;
}
