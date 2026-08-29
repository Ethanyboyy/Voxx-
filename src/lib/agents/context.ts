import { db } from "@/lib/db";
import { getSemanticMemories } from "@/lib/memory/service";

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
    summary: string;
    lessons: string | null;
    costUsd: number | null;
    timeSpentMinutes: number | null;
    sameObjective: boolean;
  }[];
}

const MAX_MEMORIES = 6;
const MAX_OUTCOMES = 5;

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
  const [memories, priorOutcomes] = await Promise.all([
    loadMemories(userId, objectiveText),
    loadPriorOutcomes(userId, options.objectiveId),
  ]);
  return { memories, priorOutcomes };
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
export function renderPlanningContext(context: PlanningContext): string {
  const sections: string[] = [];

  if (context.memories.length > 0) {
    const lines = context.memories.map((m) => `- [${m.category}, confidence ${m.confidence}] ${m.content}`);
    sections.push(
      `What VOX already knows that may be relevant (stored memories — treat lower-confidence entries as uncertain, not fact):\n${lines.join("\n")}`
    );
  }

  if (context.priorOutcomes.length > 0) {
    const lines = context.priorOutcomes.map((o) => {
      const parts = [`- ${o.sameObjective ? "THIS objective" : `"${o.objectiveTitle}"`} → ${o.status}: ${o.summary}`];
      if (o.lessons) parts.push(`  Lesson recorded: ${o.lessons}`);
      const cost: string[] = [];
      if (o.costUsd != null) cost.push(`$${o.costUsd.toFixed(2)}`);
      if (o.timeSpentMinutes != null) cost.push(`${o.timeSpentMinutes} min`);
      if (cost.length > 0) parts.push(`  Cost: ${cost.join(", ")}`);
      return parts.join("\n");
    });
    sections.push(
      `How previous attempts actually turned out (real recorded results — use these to avoid repeating what failed):\n${lines.join("\n")}`
    );
  }

  if (sections.length === 0) return "";
  return `\n\n${sections.join("\n\n")}`;
}
