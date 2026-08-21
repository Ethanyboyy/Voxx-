import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";

export type ResearchLinkSubjectType =
  | "LabRequirement"
  | "LabEngineeringQuestion"
  | "LabDecision"
  | "LabComponent"
  | "LabExperiment"
  | "LabSuit";

async function subjectExistsForUser(subjectType: ResearchLinkSubjectType, subjectId: string, userId: string): Promise<boolean> {
  switch (subjectType) {
    case "LabRequirement":
      return (await db.labRequirement.findFirst({ where: { id: subjectId, userId } })) !== null;
    case "LabEngineeringQuestion":
      return (await db.labEngineeringQuestion.findFirst({ where: { id: subjectId, userId } })) !== null;
    case "LabDecision":
      return (await db.labDecision.findFirst({ where: { id: subjectId, userId } })) !== null;
    case "LabExperiment":
      return (await db.labExperiment.findFirst({ where: { id: subjectId, userId } })) !== null;
    case "LabSuit":
      return (await db.labSuit.findFirst({ where: { id: subjectId, userId } })) !== null;
    case "LabComponent":
      // LabComponent has no direct userId column — ownership is via its
      // parent suit/gadget.
      return (
        (await db.labComponent.findFirst({
          where: { id: subjectId, OR: [{ suit: { userId } }, { gadget: { userId } }] },
        })) !== null
      );
  }
}

export interface CreateResearchLinkInput {
  userId: string;
  researchItemId: string;
  subjectType: ResearchLinkSubjectType;
  subjectId: string;
  note?: string;
}

/** Links a real, already-existing core ResearchItem to a Lab engineering
 * object — never creates or duplicates research data itself. Returns null
 * if the research item or the subject isn't real/owned by this user. */
export async function createResearchLink(input: CreateResearchLinkInput) {
  const researchItem = await db.researchItem.findFirst({ where: { id: input.researchItemId, userId: input.userId } });
  if (!researchItem) return null;

  if (!(await subjectExistsForUser(input.subjectType, input.subjectId, input.userId))) return null;

  const link = await db.labResearchLink.upsert({
    where: { researchItemId_subjectType_subjectId: { researchItemId: input.researchItemId, subjectType: input.subjectType, subjectId: input.subjectId } },
    create: {
      userId: input.userId,
      researchItemId: input.researchItemId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      note: input.note,
    },
    update: { note: input.note },
  });

  await recordEvent({
    userId: input.userId,
    type: "lab.research_link.created",
    payload: { researchItemId: input.researchItemId, subjectType: input.subjectType, subjectId: input.subjectId },
    subjectType: input.subjectType,
    subjectId: input.subjectId,
  });

  return link;
}

export async function listResearchLinks(userId: string, subjectType: ResearchLinkSubjectType, subjectId: string) {
  return db.labResearchLink.findMany({
    where: { userId, subjectType, subjectId },
    include: { researchItem: true },
    orderBy: { createdAt: "desc" },
  });
}

export async function deleteResearchLink(userId: string, id: string) {
  const existing = await db.labResearchLink.findFirst({ where: { id, userId } });
  if (!existing) return false;
  await db.labResearchLink.delete({ where: { id } });
  return true;
}
