import { db } from "@/lib/db";
import { getResearchProvider } from "@/lib/research/index";
import { enforceCapability } from "@/lib/permissions/service";
import { recordEvent } from "@/lib/observability/events";
import { assertExecutionAuthorized } from "@/lib/policy/gate";
import { recordResearchExperience, recordResearchFailure } from "@/lib/research/learning";
import { scopeObjectiveId } from "@/lib/cognition/experience";

export const RESEARCH_CAPABILITY = "research.web";

export interface RunResearchOptions {
  opportunityId?: string;
  /** The Objective this lookup is being run in pursuit of. Recording it is
   *  what makes the finding retrievable later as THIS objective's evidence
   *  rather than as merely-recent history. */
  objectiveId?: string;
}

export async function runResearch(
  userId: string,
  query: string,
  optionsOrOpportunityId?: string | RunResearchOptions
) {
  // [P4-E] RECOMMEND, matching the tool. A service check weaker than the
  // tool that calls it is a hole shaped like the difference.
  await enforceCapability(userId, RESEARCH_CAPABILITY, "RECOMMEND");

  // ---- [P4-D] THE SINK GUARD ----
  //
  // `research.run` is WRITE + PARTIALLY_REVERSIBLE with untrusted output — a
  // HOLD. It fetches the open web, writes N ResearchItem rows, and calls
  // recordResearchExperience(), which creates a durable Memory plus knowledge
  // graph nodes and edges. That written state then feeds back into planning, so
  // this is the operation that brings untrusted external content into what VOX
  // believes.
  //
  // P4-C3 enforced it at the executor. This function was still reachable
  // directly — `POST /api/research` called it and never touched the executor —
  // so the same operation was blocked through one door and free through another.
  // The P4-C3 report named that gap; this closes it.
  //
  // THE GUARD IS AT THE SINK, NOT THE ROUTE, on purpose. Gating the route
  // protects the route. Gating here protects every caller: the tool, the route,
  // the Brain inspector, and whatever is added next by someone who has never
  // read this file. The route below now goes through the executor, so this
  // throwing is the invariant holding rather than a path anyone should hit.
  //
  // Fail-closed: it throws. There is no boolean to ignore and no branch that
  // continues without an enforcement decision in scope.
  assertExecutionAuthorized("research.run");

  // Kept accepting a bare opportunityId so existing callers (the tool
  // registry, the Brain inspector) are unchanged by the objective addition.
  const options: RunResearchOptions =
    typeof optionsOrOpportunityId === "string"
      ? { opportunityId: optionsOrOpportunityId }
      : optionsOrOpportunityId ?? {};

  // A caller-supplied opportunityId is only trusted once ownership is
  // confirmed — otherwise the research still runs, just unscoped, rather
  // than silently attaching to someone else's data.
  let scopedOpportunityId: string | undefined;
  if (options.opportunityId) {
    const opportunity = await db.opportunity.findFirst({ where: { id: options.opportunityId, userId } });
    scopedOpportunityId = opportunity ? options.opportunityId : undefined;
  }
  // Same rule for the objective: an id that isn't this user's yields
  // unscoped research, never evidence attached to someone else's goal.
  const scopedObjectiveId = await scopeObjectiveId(userId, options.objectiveId);

  const provider = getResearchProvider();

  let results;
  try {
    results = await provider.search(query);
  } catch (error) {
    // A failed lookup is a real thing that happened and is worth remembering —
    // otherwise VOX re-attempts the same dead end with no record of the last
    // one. Recorded first, then re-thrown so the caller still sees the error.
    await recordResearchFailure(userId, query, provider.id, error, scopedObjectiveId);
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
          objectiveId: scopedObjectiveId,
        },
      })
    )
  );

  await recordEvent({
    userId,
    type: "research.performed",
    subjectType: scopedOpportunityId ? "Opportunity" : "ResearchQuery",
    subjectId: scopedOpportunityId,
    payload: {
      query,
      provider: provider.id,
      resultCount: rows.length,
      opportunityId: scopedOpportunityId,
      objectiveId: scopedObjectiveId,
    },
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
    objectiveId: scopedObjectiveId,
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
