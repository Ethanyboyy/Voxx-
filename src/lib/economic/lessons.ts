// Closing the loop: outcome -> memory -> the next opportunity's evaluation.
//
// The economic loop is only a loop if what an experiment cost VOX changes how
// the next one is judged. Without this module the arrow stops at the ledger: a
// contract dies, a row is written, and the next opportunity that looks exactly
// like it is scored as if the first had never happened.
//
// TWO HALVES, DELIBERATELY SEPARATE.
//
// 1. WRITE. `recordExperimentLesson()` turns a concluded experiment into a
//    Memory. It records the MEASURED FACT — "this contract netted -$212.40 and
//    was killed by its loss cap" — as a FACT, because that is what it is. It
//    does not write the generalization ("ventures of this kind lose money"),
//    because one experiment is not evidence for a class. If a generalization
//    is ever worth having, it comes from the existing pattern/hypothesis
//    machinery, which proposes rather than asserts.
//
// 2. READ. `getRelevantLessons()` retrieves past lessons BY RELEVANCE to the
//    opportunity being evaluated, using the embedding ranking VOX already has,
//    and drops anything below a similarity floor. This is the "not blind
//    injection" requirement: an unrelated failure from three months ago should
//    not shade the judgment of an unrelated idea, and pasting the last N
//    lessons into every evaluation is how that happens.
//
// LESSONS ARE ADVISORY. `evaluateOpportunityWithLessons()` attaches them
// beside the score; it never adjusts the score, and it never touches
// `confidence`. Per rule 3 of the project's development rules, an inference
// stays an inference until a human or a corroborating explicit fact promotes
// it — and "the model saw a related failure" is not a corroborating fact. A
// human reading the lesson can lower the confidence themselves; VOX will not
// do it silently on their behalf.
import { db } from "@/lib/db";
import { createMemory, listMemoriesByIds, listMemoriesByProvenance } from "@/lib/memory/service";
import { rankBySimilarity } from "@/lib/memory/embeddings";
import { explainOpportunityScore, listOpportunities, type OpportunityDTO } from "@/lib/objectives/service";
import type { OpportunityScoreBreakdown } from "@/lib/objectives/service";
import type { EconomicDecision } from "@/lib/economic/decide";
import type { MemoryDTO } from "@/lib/memory/service";

/**
 * The provenance tag economic lessons are written and read under.
 *
 * An exact tag rather than a keyword search: it is a fact about where the
 * memory came from, so retrieval can rely on seeing every lesson rather than
 * only the ones a substring match happened to catch.
 */
export const ECONOMIC_LESSON_PROVENANCE = "economic.experiment.outcome";

/**
 * How similar a lesson must be to the opportunity before it is surfaced.
 *
 * Set where it is because the alternative is worse in both directions: too low
 * and every evaluation carries the same background noise (which is blind
 * injection wearing a similarity score), too high and only near-identical
 * restatements survive. A lesson that clears this bar is one a person reading
 * both would agree is about the same kind of thing.
 */
export const LESSON_RELEVANCE_FLOOR = 0.35;

export interface RelevantLesson {
  memoryId: string;
  content: string;
  /** Cosine similarity to the opportunity's own text, 0..1. Always shown. */
  similarity: number;
  recordedAt: Date;
}

export interface ExperimentLessonInput {
  userId: string;
  experimentId: string;
  hypothesis: string;
  decision: EconomicDecision;
  /** The single constraint that produced the decision. */
  bindingConstraint: string;
  /** Measured from the ledger — never estimated, never projected. */
  netUsd: number;
  revenueUsd: number;
  expenseUsd: number;
  maxLossUsd: number;
  /** Free text from the opportunity/experiment, so the lesson is retrievable. */
  subject?: string | null;
}

/**
 * Writes one measured lesson from a concluded experiment.
 *
 * Phrased as the measurement it is, with the numbers in the text so a future
 * reader (human or embedding) sees the evidence and not a verdict. Goes
 * through the existing memory service — encryption, embedding and the
 * `memory.created` Event all come along for free, and there is no second way
 * to write a memory.
 *
 * IDEMPOTENT, and the scheduler depends on it. The tick writes the lesson
 * BEFORE marking the experiment terminal, so that a crash between the two loses
 * neither: the retry re-decides the still-live experiment and arrives here
 * again. Without this guard that retry would write a second, duplicate lesson,
 * and duplicates in the lesson store quietly bias every future relevance
 * ranking toward whichever experiment happened to crash.
 *
 * The key is the MemorySource reference `experiment:<id>`, which is a fact
 * about where the memory came from rather than a hash of its text — so a lesson
 * stays deduplicated even if its wording later changes.
 */
export async function recordExperimentLesson(input: ExperimentLessonInput): Promise<MemoryDTO> {
  const reference = `experiment:${input.experimentId}`;
  const existing = await db.memory.findFirst({
    where: {
      userId: input.userId,
      provenance: ECONOMIC_LESSON_PROVENANCE,
      supersededAt: null,
      source: { reference },
    },
    select: { id: true },
  });
  if (existing) {
    // Read it back through the memory service rather than mapping the raw row:
    // Memory.content is encrypted at rest, so a hand-built DTO would hand the
    // caller ciphertext. There is one decryption path and this uses it.
    const [dto] = await listMemoriesByIds(input.userId, [existing.id]);
    if (dto) return dto;
  }

  const money = (n: number) => `$${n.toFixed(2)}`;
  const subject = input.subject ? ` (${input.subject})` : "";

  const content =
    `Economic experiment${subject} concluded with decision ${input.decision} ` +
    `(binding constraint: ${input.bindingConstraint}). ` +
    `Hypothesis tested: ${input.hypothesis}. ` +
    `Measured result: revenue ${money(input.revenueUsd)}, expenses ${money(input.expenseUsd)}, ` +
    `net ${money(input.netUsd)} against an authorized maximum loss of ${money(input.maxLossUsd)}.`;

  return createMemory({
    userId: input.userId,
    content,
    // A FACT, because every number in it was measured from real ledger rows.
    // The generalization that might follow from it is not written here.
    category: "FACT",
    // The measurement is solid; MEDIUM rather than HIGH because a single
    // experiment's result is a narrow fact about one contract, and nothing
    // should later read this as a settled truth about a market.
    confidence: "MEDIUM",
    provenance: ECONOMIC_LESSON_PROVENANCE,
    source: { type: "SYSTEM", reference },
  });
}

/**
 * Past economic lessons relevant to a piece of text, best first.
 *
 * Ranks only the economic lessons (not all memories) so a highly-similar
 * shopping list can never crowd out a moderately-similar failed venture, then
 * applies the relevance floor. Returns an empty array when nothing is
 * relevant — which is a real answer, and the common one early on.
 */
export async function getRelevantLessons(userId: string, queryText: string, limit = 5): Promise<RelevantLesson[]> {
  if (!queryText.trim()) return [];

  const lessons = await listMemoriesByProvenance(userId, [ECONOMIC_LESSON_PROVENANCE], 200);
  if (lessons.length === 0) return [];

  const ranked = await rankBySimilarity(
    queryText,
    lessons.map((m) => ({ id: m.id, content: m.content }))
  );
  const similarityById = new Map(ranked.map((r) => [r.id, r.similarity]));

  return lessons
    .map((m) => ({
      memoryId: m.id,
      content: m.content,
      similarity: similarityById.get(m.id) ?? 0,
      recordedAt: m.createdAt,
    }))
    .filter((l) => l.similarity >= LESSON_RELEVANCE_FLOOR)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}

export interface OpportunityEvaluation {
  opportunity: OpportunityDTO;
  /** The existing transparent score, unchanged. */
  breakdown: OpportunityScoreBreakdown;
  /**
   * Relevant prior outcomes. ADVISORY. The score above was computed without
   * them and is not adjusted by them — see this module's header for why.
   */
  lessons: RelevantLesson[];
}

/**
 * An opportunity's score, plus what VOX has already learned that bears on it.
 *
 * The query text is built from the opportunity's own words — title,
 * description and category — so relevance is measured against the thing being
 * judged rather than against a summary of it.
 */
export async function evaluateOpportunityWithLessons(
  userId: string,
  opportunityId: string
): Promise<OpportunityEvaluation | null> {
  // Reuses listOpportunities' own DTO mapping (including its live score
  // refresh) rather than adding a second read path that could drift from it.
  const opportunity = (await listOpportunities(userId)).find((o) => o.id === opportunityId);
  if (!opportunity) return null;

  const queryText = [opportunity.title, opportunity.description, opportunity.category]
    .filter((part): part is string => Boolean(part))
    .join(". ");

  return {
    opportunity,
    breakdown: explainOpportunityScore(opportunity),
    lessons: await getRelevantLessons(userId, queryText),
  };
}
