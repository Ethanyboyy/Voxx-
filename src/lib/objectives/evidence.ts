import { db } from "@/lib/db";
import { listMemoriesByIds } from "@/lib/memory/service";
import { getNodeForEntity, findRelated } from "@/lib/knowledge/service";
import { EVIDENCE_RELATION, isEvidenceRelation, EXPERIENCE_PROVENANCE } from "@/lib/cognition/experience";
import { logger } from "@/lib/observability/logger";

/**
 * "What do I know because I am pursuing THIS objective?"
 *
 * The user-facing read of the evidence linkage that research, experiments and
 * simulations write at completion time. buildPlanningContext() asks the same
 * question of the same graph edges when VOX plans; this asks it on behalf of
 * a person looking at the objective, so the two can never drift into
 * disagreeing about what an objective's evidence is.
 *
 * Everything returned is a real persisted record. Nothing is scored,
 * summarised or inferred — in particular the grade of each item is carried
 * through untouched, because a retrieved research claim, a recorded
 * experiment and a simulated model output are not interchangeable and the UI
 * must be able to say which is which.
 */

export type EvidenceKind = "research" | "experiment" | "simulation";

export interface EvidenceItem {
  memoryId: string;
  kind: EvidenceKind;
  /** The memory's own stored confidence — never raised by being linked here. */
  confidence: string;
  content: string;
  recordedAt: string;
  /** True for a model output. The UI must mark these; they are not measurements. */
  simulated: boolean;
}

export interface ObjectiveEvidence {
  items: EvidenceItem[];
  counts: Record<EvidenceKind, number>;
  /** Source records created in pursuit of this objective, whether or not the
   *  best-effort graph write for each succeeded. Counted from the FK columns,
   *  so this is the honest total even when `items` is shorter. */
  sourceCounts: { research: number; experiments: number; simulations: number };
}

const RELATION_KIND: Record<string, EvidenceKind> = {
  [EVIDENCE_RELATION.RESEARCH]: "research",
  [EVIDENCE_RELATION.EXPERIMENT]: "experiment",
  [EVIDENCE_RELATION.SIMULATION]: "simulation",
};

const EMPTY: ObjectiveEvidence = {
  items: [],
  counts: { research: 0, experiment: 0, simulation: 0 },
  sourceCounts: { research: 0, experiments: 0, simulations: 0 },
};

/**
 * Gathers an objective's evidence dossier. Ownership is enforced by scoping
 * every query to userId — reaching a node by traversal is not on its own
 * proof that the caller may read it.
 */
export async function getObjectiveEvidence(userId: string, objectiveId: string): Promise<ObjectiveEvidence> {
  const objective = await db.objective.findFirst({ where: { id: objectiveId, userId }, select: { id: true } });
  if (!objective) return EMPTY;

  const [items, sourceCounts] = await Promise.all([
    loadLinkedMemories(userId, objectiveId),
    countSourceRecords(userId, objectiveId),
  ]);

  const counts = { research: 0, experiment: 0, simulation: 0 } as Record<EvidenceKind, number>;
  for (const item of items) counts[item.kind] += 1;

  return { items, counts, sourceCounts };
}

async function loadLinkedMemories(userId: string, objectiveId: string): Promise<EvidenceItem[]> {
  try {
    const node = await getNodeForEntity(userId, "OBJECTIVE", objectiveId);
    if (!node) return [];

    // Depth 1: the objective's own evidence edges. Deeper traversal would
    // pull in whatever those findings happen to touch, which is not the same
    // claim as "gathered for this objective".
    const related = await findRelated(userId, node.id, 1);
    const kindByMemoryId = new Map<string, EvidenceKind>();
    for (const r of related) {
      if (!isEvidenceRelation(r.relation) || r.node.memoryId == null) continue;
      const kind = RELATION_KIND[r.relation];
      if (kind) kindByMemoryId.set(r.node.memoryId, kind);
    }
    if (kindByMemoryId.size === 0) return [];

    const memories = await listMemoriesByIds(userId, [...kindByMemoryId.keys()]);
    return memories.map((m) => {
      const kind = kindByMemoryId.get(m.id) ?? "research";
      return {
        memoryId: m.id,
        kind,
        confidence: m.confidence,
        content: m.content,
        recordedAt: m.createdAt.toISOString(),
        // Derived from provenance rather than from the edge alone, so a
        // mislabelled edge can never present a model output as measured.
        simulated: m.provenance === EXPERIENCE_PROVENANCE.LAB_SIMULATION_RUN,
      };
    });
  } catch (error) {
    // Derived view — a graph problem must not break the objective page.
    logger.error("objective_evidence.graph_read_failed", {
      objectiveId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Counts the work actually performed for this objective, straight from the
 * source tables. Kept separate from the linked-memory list on purpose: the
 * graph write is best-effort, so a count taken from it could quietly
 * under-report. When these disagree, the source counts are the truth and the
 * UI can say so rather than implying nothing happened.
 */
async function countSourceRecords(userId: string, objectiveId: string) {
  const [research, experiments, simulations] = await Promise.all([
    db.researchItem.count({ where: { userId, objectiveId } }),
    db.labExperiment.count({ where: { userId, objectiveId } }),
    db.labSimulation.count({ where: { userId, objectiveId } }),
  ]);
  return { research, experiments, simulations };
}
