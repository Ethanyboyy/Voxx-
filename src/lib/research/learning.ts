import {
  recordExperience,
  objectiveEvidenceAnchor,
  EXPERIENCE_PROVENANCE,
  EVIDENCE_RELATION,
  type ExperienceAnchor,
} from "@/lib/cognition/experience";
import type { Confidence } from "@/generated/prisma/enums";
import type { ResearchItem } from "@/generated/prisma/client";

/**
 * Turns a completed research query into something VOX actually knows.
 *
 * Research used to end at the ResearchItem rows: real sources with real URLs
 * and real retrieval times, sitting in a table nothing else read. The
 * Knowledge Graph never heard about them, no memory recorded that the
 * lookup had happened, and the next planning pass had no idea the question
 * had already been asked. This closes that.
 *
 * Provenance is the whole point of research, so it is preserved rather than
 * flattened into a summary: every source keeps its title and URL in the
 * memory text AND gets its own graph node, so "where did VOX get this?"
 * is answerable by traversal, not by trusting a paraphrase.
 */

/** Above this, the memory lists a count instead of every title, to stay readable. */
const MAX_LISTED_SOURCES = 5;
/** Graph nodes are created for the most relevant sources only — the graph is a
 *  curated view, not a mirror of every row ever retrieved. */
const MAX_GRAPH_SOURCES = 5;

const CONFIDENCE_RANK: Record<Confidence, number> = {
  CONFIRMED: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

/**
 * The strongest confidence any single source claimed, capped at HIGH.
 *
 * A retrieved document is evidence, never a confirmed fact — CONFIRMED is
 * reserved for things the user stated directly. A provider reporting
 * CONFIRMED on its own output would otherwise silently promote a web page
 * into ground truth, which is exactly what CLAUDE.md rule 3 forbids.
 */
export function aggregateSourceConfidence(items: { confidence: Confidence }[]): Confidence {
  if (items.length === 0) return "LOW";
  let best: Confidence = "LOW";
  for (const item of items) {
    if (CONFIDENCE_RANK[item.confidence] > CONFIDENCE_RANK[best]) best = item.confidence;
  }
  return best === "CONFIRMED" ? "HIGH" : best;
}

/**
 * True when the provider returned nothing usable — either no rows at all, or
 * only rows with zero relevance and no URL, which is what the mock provider
 * emits to say "no research actually happened here".
 *
 * This distinction matters more than it looks: without it, a placeholder
 * explaining that research is unconfigured would be written into memory as
 * though it were a finding, and a later planning pass would read it as
 * evidence. VOX must not manufacture a conclusion out of the absence of one.
 */
export function isSubstantiveResult(item: { sourceUrl: string | null; relevance: number | null }): boolean {
  return item.sourceUrl != null || (item.relevance ?? 0) > 0;
}

/**
 * ResearchItem's title/summary/relevance are all nullable — a provider is
 * allowed to return a source it can say little about. Normalising here keeps
 * the absence visible in the text ("no summary reported") rather than
 * papering over it with an empty string, so a reader can tell a thin source
 * from a rich one.
 */
interface NormalizedSource {
  id: string;
  title: string;
  url: string | null;
  summary: string;
  relevance: number | null;
  confidence: Confidence;
  retrievedAt: Date;
}

function normalize(item: ResearchItem): NormalizedSource {
  return {
    id: item.id,
    title: item.title ?? "(untitled source)",
    url: item.sourceUrl,
    summary: item.summary ?? "(no summary reported)",
    relevance: item.relevance,
    confidence: item.confidence,
    retrievedAt: item.retrievedAt,
  };
}

/** Descending relevance; sources with no reported relevance sort last rather
 *  than being treated as zero-relevance, since "unscored" is not "irrelevant". */
function byRelevance(a: NormalizedSource, b: NormalizedSource): number {
  return (b.relevance ?? -1) - (a.relevance ?? -1);
}

export interface ResearchExperienceInput {
  userId: string;
  query: string;
  providerId: string;
  items: ResearchItem[];
  /** Set when the research was scoped to an opportunity the user owns. */
  opportunityId?: string;
  /** Set when the lookup was run in pursuit of an objective the user owns. */
  objectiveId?: string;
}

/**
 * Records what a research query actually returned. Returns the recorded
 * memory id, or null when nothing was written (best-effort by design — see
 * recordExperience).
 */
export async function recordResearchExperience(input: ResearchExperienceInput): Promise<string | null> {
  const substantive = input.items.filter(isSubstantiveResult).map(normalize);
  const content = substantive.length > 0 ? describeFindings(input, substantive) : describeNoFindings(input);

  const anchors: ExperienceAnchor[] = substantive
    .slice()
    .sort(byRelevance)
    .slice(0, MAX_GRAPH_SOURCES)
    .map((item) => ({
      entityType: "RESEARCH_ITEM" as const,
      entityId: item.id,
      label: item.title.slice(0, 120),
      description: item.url ?? undefined,
      // The edge says how VOX came by this, so a reader can tell a retrieved
      // source apart from a measured result or a verified outcome.
      relation: "sourced",
    }));

  // The objective edge is what makes this finding answerable as "evidence I
  // have because I am pursuing this goal". The source edges above stay:
  // objective -> finding -> source keeps the chain walkable back to the URL,
  // so nothing here becomes a claim without a provenance trail.
  const objectiveAnchor = await objectiveEvidenceAnchor(
    input.userId,
    input.objectiveId,
    EVIDENCE_RELATION.RESEARCH
  );
  if (objectiveAnchor) anchors.push(objectiveAnchor);

  const result = await recordExperience({
    userId: input.userId,
    content,
    // Findings are things VOX observed in the world, not facts it holds. A
    // retrieved claim stays an observation until something corroborates it.
    category: "OBSERVATION",
    confidence: substantive.length > 0 ? aggregateSourceConfidence(substantive) : "LOW",
    provenance: EXPERIENCE_PROVENANCE.RESEARCH_FINDINGS,
    anchors,
    sourceResearchItemId: substantive[0]?.id,
    event: {
      type: "research.recorded",
      subjectType: input.opportunityId ? "Opportunity" : "ResearchQuery",
      subjectId: input.opportunityId ?? input.items[0]?.id ?? input.query.slice(0, 60),
      payload: {
        query: input.query,
        provider: input.providerId,
        sourceCount: substantive.length,
        substantive: substantive.length > 0,
        objectiveId: input.objectiveId,
      },
      // Research reaches outside VOX and costs something to run; it is a
      // RECOMMEND-level capability, so its completion belongs in the audit
      // trail (CLAUDE.md rule 4).
      consequential: true,
    },
  });

  return result?.memoryId ?? null;
}

function describeFindings(input: ResearchExperienceInput, items: NormalizedSource[]): string {
  const listed = items
    .slice()
    .sort(byRelevance)
    .slice(0, MAX_LISTED_SOURCES)
    .map((item) => {
      const where = item.url ? ` (${item.url})` : " (no source URL reported)";
      const relevance = item.relevance != null ? item.relevance.toFixed(2) : "not scored";
      return `- "${item.title}"${where} — ${item.summary.slice(
        0,
        240
      )} [relevance ${relevance}, source confidence ${item.confidence}]`;
    })
    .join("\n");

  const overflow =
    items.length > MAX_LISTED_SOURCES ? `\n(${items.length - MAX_LISTED_SOURCES} further sources not listed here.)` : "";

  return (
    `Researched "${input.query}" via the ${input.providerId} provider on ` +
    `${items[0].retrievedAt.toISOString().slice(0, 10)}: ${items.length} source(s) returned. ` +
    `These are retrieved claims with their sources attached, not verified facts.\n${listed}${overflow}`
  );
}

function describeNoFindings(input: ResearchExperienceInput): string {
  return (
    `Researched "${input.query}" via the ${input.providerId} provider and got no usable sources back. ` +
    `Nothing was learned about this question — treat it as unresearched rather than as evidence of absence.`
  );
}

/**
 * Records that a research attempt failed. Called before the error is
 * re-thrown, so the failure is part of VOX's history rather than something
 * that only ever existed in a stack trace: the next planning pass can see
 * that this question was attempted and could not be answered.
 */
export async function recordResearchFailure(
  userId: string,
  query: string,
  providerId: string,
  error: unknown,
  objectiveId?: string
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  // A dead end reached in pursuit of an objective is evidence about that
  // objective — it is what stops VOX re-running the same failing lookup.
  const objectiveAnchor = await objectiveEvidenceAnchor(userId, objectiveId, EVIDENCE_RELATION.RESEARCH);
  await recordExperience({
    userId,
    content:
      `Research on "${query}" via the ${providerId} provider failed and returned nothing: ${message}. ` +
      `This question remains unresearched.`,
    category: "OBSERVATION",
    confidence: "LOW",
    provenance: EXPERIENCE_PROVENANCE.RESEARCH_FINDINGS,
    anchors: objectiveAnchor ? [objectiveAnchor] : undefined,
    event: {
      type: "research.failed",
      subjectType: "ResearchQuery",
      subjectId: query.slice(0, 60),
      payload: { query, provider: providerId, error: message },
      consequential: true,
    },
  });
}
