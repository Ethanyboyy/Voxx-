import { db } from "@/lib/db";
import { getResearchProvider } from "@/lib/research/index";
import { enforceCapability } from "@/lib/permissions/service";
import { recordEvent } from "@/lib/observability/events";
import { recordResearchExperience, recordResearchFailure } from "@/lib/research/learning";

export const RESEARCH_CAPABILITY = "research.web";

export async function runResearch(userId: string, query: string, opportunityId?: string) {
  await enforceCapability(userId, RESEARCH_CAPABILITY, "ANALYZE");

  // A caller-supplied opportunityId is only trusted once ownership is
  // confirmed — otherwise the research still runs, just unscoped, rather
  // than silently attaching to someone else's data.
  let scopedOpportunityId: string | undefined;
  if (opportunityId) {
    const opportunity = await db.opportunity.findFirst({ where: { id: opportunityId, userId } });
    scopedOpportunityId = opportunity ? opportunityId : undefined;
  }

  const provider = getResearchProvider();

  let results;
  try {
    results = await provider.search(query);
  } catch (error) {
    // A failed lookup is a real thing that happened and is worth remembering —
    // otherwise VOX re-attempts the same dead end with no record of the last
    // one. Recorded first, then re-thrown so the caller still sees the error.
    await recordResearchFailure(userId, query, provider.id, error);
    throw error;
  }

  const rows = await db.$transaction(
    results.map((result) =>
      db.researchItem.create({
        data: {
          userId,
          query,
          provider: provider.id,
          title: result.title,
          sourceUrl: result.url,
          summary: result.summary,
          relevance: result.relevance,
          confidence: result.confidence,
          retrievedAt: result.retrievedAt,
          opportunityId: scopedOpportunityId,
        },
      })
    )
  );

  await recordEvent({
    userId,
    type: "research.performed",
    subjectType: scopedOpportunityId ? "Opportunity" : "ResearchQuery",
    subjectId: scopedOpportunityId,
    payload: { query, provider: provider.id, resultCount: rows.length, opportunityId: scopedOpportunityId },
  });

  // The ResearchItem rows are the record of what was retrieved; this makes
  // what was retrieved part of what VOX knows — a durable memory carrying the
  // sources, and graph nodes joining each source to it. Best-effort: research
  // that succeeded must not be reported as failed because the derived
  // knowledge layer had a problem.
  await recordResearchExperience({
    userId,
    query,
    providerId: provider.id,
    items: rows,
    opportunityId: scopedOpportunityId,
  });

  return rows;
}

export async function listResearchItems(userId: string, limit = 50, opportunityId?: string) {
  return db.researchItem.findMany({
    where: { userId, opportunityId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
