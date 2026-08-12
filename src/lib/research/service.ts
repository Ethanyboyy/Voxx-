import { db } from "@/lib/db";
import { getResearchProvider } from "@/lib/research/index";
import { enforceCapability } from "@/lib/permissions/service";
import { recordEvent } from "@/lib/observability/events";

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
  const results = await provider.search(query);

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

  return rows;
}

export async function listResearchItems(userId: string, limit = 50, opportunityId?: string) {
  return db.researchItem.findMany({
    where: { userId, opportunityId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
