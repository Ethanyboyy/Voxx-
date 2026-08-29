import { db } from "@/lib/db";
import { getSemanticMemories, listMemoriesByProvenance, listMemoriesByIds } from "@/lib/memory/service";
import { findRelated, getNodeForEntity } from "@/lib/knowledge/service";
import { OBSERVATION_PROVENANCES, EXPERIENCE_PROVENANCE, isEvidenceRelation } from "@/lib/cognition/experience";

/**
 * The evidence VOX has about an objective BEFORE it plans how to pursue it.
 *
 * Until this existed, planObjective() received only the objective string and
 * the tool catalog — VOX planned every objective as if it had never done
 * anything before, with no access to its own memory and no knowledge of how
 * previous attempts at the same work actually turned out. Outcome rows were
 * written by the supervisor and then read by nothing except the Brain
 * visualization, so the LEARN step of the autonomous loop had no consumer.
 *
 * Everything here is real persisted state. Nothing is inferred, scored, or
 * synthesized — the planner is handed facts and left to draw its own
 * conclusions.
 */
export interface PlanningContext {
  /** Semantically relevant durable memories, most relevant first. */
  memories: { content: string; category: string; confidence: string }[];
  /** Real recorded results of previous supervised attempts. `sameObjective`
   * marks the ones that were attempts at THIS objective (the retry case),
   * which are far more informative than general history. */
  priorOutcomes: {
    objectiveTitle: string;
    status: string;
    /** Whether the OBJECTIVE was achieved, as opposed to whether execution
     * ran. This is the field that actually tells a replan whether the last
     * approach worked. */
    verification: string;
    summary: string;
    lessons: string | null;
    costUsd: number | null;
    timeSpentMinutes: number | null;
    sameObjective: boolean;
  }[];
  /** What VOX has actually looked up or measured — research findings and Lab
   * results, read back by provenance rather than by embedding score so a
   * planning pass reliably sees recent observations. Distinct from
   * `priorOutcomes`: an outcome says whether an approach worked, an
   * observation says what was found or measured. */
  observations: {
    content: string;
    /** research:findings | lab:experiment-result | lab:simulation-run */
    provenance: string;
    confidence: string;
    /** Human-readable source kind for the prompt, e.g. "research". */
    kind: string;
    /** True when this evidence was produced BECAUSE this objective is being
     * pursued — established by an `evidence:*` edge from the objective's own
     * graph node, not by recency or by topic resemblance. This is the
     * difference between "what do I know because of this goal" and "what
     * happens to be recent". */
    objectiveLinked: boolean;
  }[];
}

const MAX_MEMORIES = 6;
const MAX_OUTCOMES = 5;
const MAX_OBSERVATIONS = 5;
/** Objective-linked evidence is the most relevant thing VOX can offer a
 *  planning pass, so it gets its own budget on top of the recency window. */
const MAX_OBJECTIVE_EVIDENCE = 6;
/** Depth 1 only: the objective's own evidence edges. Going deeper would drag
 *  in whatever those memories happen to touch, which is exactly the
 *  loosely-related material this feature exists to stop surfacing. */
const EVIDENCE_TRAVERSAL_DEPTH = 1;

const OBSERVATION_KIND: Record<string, string> = {
  [EXPERIENCE_PROVENANCE.RESEARCH_FINDINGS]: "research",
  [EXPERIENCE_PROVENANCE.LAB_EXPERIMENT_RESULT]: "lab experiment",
  [EXPERIENCE_PROVENANCE.LAB_SIMULATION_RUN]: "lab simulation",
};

/**
 * Gathers planning evidence for an objective. `objectiveId`, when known,
 * pulls in this objective's own prior attempts — the single most useful
 * signal available when replanning after a failure.
 *
 * Failures here are swallowed deliberately: planning with partial context is
 * strictly better than not planning at all, and this is called on the hot
 * path of every supervised run. A missing embedding provider or an empty
 * memory store must degrade to "plan without that context", never to a
 * failed run.
 */
export async function buildPlanningContext(
  userId: string,
  objectiveText: string,
  options: { objectiveId?: string } = {}
): Promise<PlanningContext> {
  const [memories, priorOutcomes, recentObservations, objectiveEvidence] = await Promise.all([
    loadMemories(userId, objectiveText),
    loadPriorOutcomes(userId, options.objectiveId),
    loadObservations(userId),
    loadObjectiveEvidence(userId, options.objectiveId),
  ]);

  // This objective's own evidence leads, and recent-but-unrelated
  // observations fill in behind it. A finding reachable both ways is listed
  // once, as objective-linked — the stronger and more specific claim.
  const evidenceIds = new Set(objectiveEvidence.map((o) => o.id));
  const observations = [
    ...objectiveEvidence,
    ...recentObservations.filter((o) => !evidenceIds.has(o.id)),
  ].map((o) => stripId(o));

  // Semantic retrieval draws from the same memory store, so a research or Lab
  // observation can legitimately surface in both lists. Showing it twice
  // would make one finding look like two pieces of corroborating evidence,
  // which is precisely the kind of quiet inflation the memory rules exist to
  // prevent — the observations section wins, since it names the source kind.
  const observationContents = new Set(observations.map((o) => o.content));
  return {
    memories: memories.filter((m) => !observationContents.has(m.content)),
    priorOutcomes,
    observations,
  };
}

async function loadMemories(userId: string, objectiveText: string): Promise<PlanningContext["memories"]> {
  try {
    const ranked = await getSemanticMemories(userId, objectiveText, MAX_MEMORIES);
    return ranked.map((m) => ({ content: m.content, category: m.category, confidence: m.confidence }));
  } catch {
    return [];
  }
}

/**
 * Research findings and Lab results, newest first. Fault-tolerant for the
 * same reason as everything else here: this runs on the hot path of every
 * supervised run, and planning with partial context beats not planning.
 */
async function loadObservations(userId: string): Promise<LoadedObservation[]> {
  try {
    const rows = await listMemoriesByProvenance(userId, OBSERVATION_PROVENANCES, MAX_OBSERVATIONS);
    return rows.map((row) => toObservation(row, false));
  } catch {
    return [];
  }
}

/** Carries the memory id so the two evidence lists can be de-duplicated by
 *  identity rather than by comparing rendered text. The id is stripped before
 *  the context is returned — the planner is given facts, not row keys. */
type LoadedObservation = PlanningContext["observations"][number] & { id: string };

/** Drops the internal row key once de-duplication is done. */
function stripId(observation: LoadedObservation): PlanningContext["observations"][number] {
  return {
    content: observation.content,
    provenance: observation.provenance,
    confidence: observation.confidence,
    kind: observation.kind,
    objectiveLinked: observation.objectiveLinked,
  };
}

function toObservation(
  row: { id: string; content: string; provenance: string | null; confidence: string },
  objectiveLinked: boolean
): LoadedObservation {
  return {
    id: row.id,
    content: row.content,
    provenance: row.provenance ?? "",
    confidence: row.confidence,
    kind: OBSERVATION_KIND[row.provenance ?? ""] ?? "observation",
    objectiveLinked,
  };
}

/**
 * The evidence VOX holds specifically because it is pursuing THIS objective.
 *
 * Answered by traversing the objective's own graph node across the
 * `evidence:*` edges that research, experiments and simulations draw at write
 * time — not by recency, and not by topic resemblance. A finding gathered for
 * a different objective is not this objective's evidence however recent or
 * similar it is, which is the entire point: without this, a planning pass
 * could present another goal's research as though it had been gathered for
 * this one.
 *
 * Confidence, provenance and framing come from the stored memory unchanged.
 * Being linked to an objective says where evidence came from; it says nothing
 * about how good the evidence is, and must never be read as corroboration.
 */
async function loadObjectiveEvidence(userId: string, objectiveId?: string): Promise<LoadedObservation[]> {
  if (!objectiveId) return [];
  try {
    const objectiveNode = await getNodeForEntity(userId, "OBJECTIVE", objectiveId);
    if (!objectiveNode) return [];

    const related = await findRelated(userId, objectiveNode.id, EVIDENCE_TRAVERSAL_DEPTH);
    const memoryIds = related
      .filter((r) => isEvidenceRelation(r.relation) && r.node.memoryId != null)
      .map((r) => r.node.memoryId as string);
    if (memoryIds.length === 0) return [];

    const rows = await listMemoriesByIds(userId, memoryIds);
    // Newest first, matching how the recency list reads, then capped.
    return rows
      .slice(0, MAX_OBJECTIVE_EVIDENCE)
      .map((row) => toObservation(row, true));
  } catch {
    return [];
  }
}

/**
 * Prior outcomes, this objective's own attempts first. Ranked by recency
 * rather than semantic similarity on purpose: rankBySimilarity() persists a
 * MemoryEmbedding row keyed by the candidate's id, so feeding it Outcome ids
 * would write embedding rows that claim to describe memories that don't
 * exist.
 */
async function loadPriorOutcomes(userId: string, objectiveId?: string): Promise<PlanningContext["priorOutcomes"]> {
  try {
    const rows = await db.outcome.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 25,
      include: { supervisorRun: { include: { objective: { select: { id: true, title: true } } } } },
    });

    const mapped = rows.map((row) => ({
      objectiveTitle: row.supervisorRun.objective.title,
      status: row.status as string,
      verification: row.verification as string,
      summary: row.summary,
      lessons: row.lessons,
      costUsd: row.costUsd,
      timeSpentMinutes: row.timeSpentMinutes,
      sameObjective: objectiveId != null && row.supervisorRun.objective.id === objectiveId,
    }));

    // This objective's own history first; recency order preserved within each group.
    const own = mapped.filter((o) => o.sameObjective);
    const others = mapped.filter((o) => !o.sameObjective);
    return [...own, ...others].slice(0, MAX_OUTCOMES);
  } catch {
    return [];
  }
}

/**
 * Renders context into a prompt section. Returns "" when there is genuinely
 * nothing to say, so the planner's prompt stays clean on a cold system
 * rather than carrying empty "Relevant memories: none" scaffolding.
 *
 * The framing given to the model matters as much as the facts: memories are
 * labeled with their real stored confidence, and outcomes are described as
 * what happened rather than as instructions, so a low-confidence inference
 * isn't silently promoted into a planning constraint.
 */
/**
 * How to read each grade of evidence. Stated in the prompt rather than left
 * implicit, because the planner cannot otherwise tell a retrieved web claim
 * from a measured experiment from a model output — and being linked to an
 * objective changes none of that.
 */
const EVIDENCE_GRADE_NOTE =
  `  Grades differ and do not merge: a "research" entry is a retrieved claim with a source attached, not a ` +
  `verified fact. A "lab experiment" entry is a real recorded observation carrying the experimenter's own ` +
  `confidence, which VOX has not independently confirmed. A "lab simulation" entry is the output of VOX's own ` +
  `kinematic model under the listed inputs — it is not evidence that anything was physically built or tested. ` +
  `Only memories the user stated directly are established facts. Evidence being linked to this objective says ` +
  `where it came from; it never raises its grade and is never corroboration.`;

export function renderPlanningContext(context: PlanningContext): string {
  const sections: string[] = [];

  if (context.memories.length > 0) {
    const lines = context.memories.map((m) => `- [${m.category}, confidence ${m.confidence}] ${m.content}`);
    sections.push(
      `What VOX already knows that may be relevant (stored memories — treat lower-confidence entries as uncertain, not fact):\n${lines.join("\n")}`
    );
  }

  const linked = context.observations.filter((o) => o.objectiveLinked);
  const general = context.observations.filter((o) => !o.objectiveLinked);

  // The two lists are rendered separately because they answer different
  // questions. "Evidence gathered for this objective" is a claim about
  // provenance; "other recent observations" is a claim about timing only.
  // Collapsing them would let unrelated recent material read as though it had
  // been gathered for this goal.
  if (linked.length > 0) {
    const lines = linked.map((o) => `- [${o.kind}, confidence ${o.confidence}] ${o.content}`);
    sections.push(
      `Evidence gathered specifically in pursuit of THIS objective (each of these was produced by work run ` +
        `for this objective, not merely recorded around the same time):\n${EVIDENCE_GRADE_NOTE}\n${lines.join("\n")}`
    );
  }

  if (general.length > 0) {
    const lines = general.map((o) => `- [${o.kind}, confidence ${o.confidence}] ${o.content}`);
    sections.push(
      `Other recent observations, NOT gathered for this objective (they may or may not be relevant — treat them ` +
        `as background, not as evidence about this objective):\n${
          linked.length > 0 ? "" : `${EVIDENCE_GRADE_NOTE}\n`
        }${lines.join("\n")}`
    );
  }

  if (context.priorOutcomes.length > 0) {
    const lines = context.priorOutcomes.map((o) => {
      const parts = [
        `- ${o.sameObjective ? "THIS objective" : `"${o.objectiveTitle}"`} → execution ${o.status}, objective ${o.verification}: ${o.summary}`,
      ];
      if (o.lessons) parts.push(`  Lesson recorded: ${o.lessons}`);
      const cost: string[] = [];
      if (o.costUsd != null) cost.push(`$${o.costUsd.toFixed(2)}`);
      if (o.timeSpentMinutes != null) cost.push(`${o.timeSpentMinutes} min`);
      if (cost.length > 0) parts.push(`  Cost: ${cost.join(", ")}`);
      return parts.join("\n");
    });
    sections.push(
      `How previous attempts actually turned out (real recorded results — use these to avoid repeating what failed).\n` +
        `Note the two are different: execution COMPLETED only means every tool ran, while the objective verdict says whether the goal was actually achieved. An attempt that completed but came back UNVERIFIED did not demonstrably work.\n${lines.join("\n")}`
    );
  }

  if (sections.length === 0) return "";
  return `\n\n${sections.join("\n\n")}`;
}
