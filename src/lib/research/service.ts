import { db } from "@/lib/db";
import { getResearchProvider } from "@/lib/research/index";
import { enforceCapability } from "@/lib/permissions/service";
import { recordEvent } from "@/lib/observability/events";

export const RESEARCH_CAPABILITY = "research.web";

export async function runResearch(userId: string, query: string) {
  await enforceCapability(userId, RESEARCH_CAPABILITY, "ANALYZE");

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
        },
      })
    )
  );

  await recordEvent({
    userId,
    type: "research.performed",
    subjectType: "ResearchQuery",
    payload: { query, provider: provider.id, resultCount: rows.length },
  });

  return rows;
}

export async function listResearchItems(userId: string, limit = 50) {
  return db.researchItem.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
