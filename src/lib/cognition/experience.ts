import { db } from "@/lib/db";
import { createMemory } from "@/lib/memory/service";
import { ensureNodeForEntity, createConnection, type LinkableEntityType } from "@/lib/knowledge/service";
import { recordEvent } from "@/lib/observability/events";
import { logger } from "@/lib/observability/logger";
import type { Confidence, MemoryCategory } from "@/generated/prisma/enums";

/**
 * The one pathway by which anything VOX does becomes something VOX knows.
 *
 * Before this module the write-back logic lived inside the supervisor, which
 * meant only supervised runs ever produced durable knowledge. Research
 * produced ResearchItem rows and the Lab produced experiment results and
 * simulation telemetry, and both then went nowhere: no memory, no graph
 * node, nothing a later planning pass could read. They were real features
 * that happened to be isolated from the organism.
 *
 * Routing all three through one function is deliberate. It is what stops
 * Research and the Lab from becoming parallel silos with their own private
 * notions of "recording a result", and it means a single change to how VOX
 * remembers applies everywhere at once.
 *
 * What this does NOT do is just as important:
 *  - It never interprets. The caller supplies content assembled from real
 *    recorded values; nothing here summarises, scores, or concludes.
 *  - It never upgrades confidence. The caller's stated confidence is stored
 *    verbatim, and callers are expected to derive it from what the source
 *    actually claimed (CLAUDE.md rule 3).
 *  - It never fails the caller's real work. The ResearchItem rows and the
 *    LabSimulationRun telemetry are the system of record and are already
 *    persisted by the time this runs; memory and graph are derived. A
 *    failure here is logged and swallowed.
 */

/**
 * Provenance strings are the contract between the write side (here) and the
 * read side (agents/context.ts). They are exhaustive on purpose: adding a
 * new learning source means adding it here, which makes it visible to
 * planning by construction rather than by remembering to wire it up.
 */
export const EXPERIENCE_PROVENANCE = {
  /** A supervised run finished; see supervisor/service.ts. */
  SUPERVISOR_OUTCOME: "supervisor:outcome",
  /** A supervised run that was validating an economic Opportunity. */
  SUPERVISOR_ECONOMIC_OUTCOME: "supervisor:economic-outcome",
  /** A research query returned (or failed to return) real sources. */
  RESEARCH_FINDINGS: "research:findings",
  /** A result was recorded against a Lab experiment. */
  LAB_EXPERIMENT_RESULT: "lab:experiment-result",
  /** A simulation run produced model telemetry — never a physical result. */
  LAB_SIMULATION_RUN: "lab:simulation-run",
} as const;

export type ExperienceProvenance = (typeof EXPERIENCE_PROVENANCE)[keyof typeof EXPERIENCE_PROVENANCE];

/**
 * Provenances that represent VOX observing something about the world rather
 * than VOX recording how its own attempt went. Planning treats the two
 * differently: an outcome says "this approach worked or didn't", an
 * observation says "here is what was found or measured".
 */
export const OBSERVATION_PROVENANCES: ExperienceProvenance[] = [
  EXPERIENCE_PROVENANCE.RESEARCH_FINDINGS,
  EXPERIENCE_PROVENANCE.LAB_EXPERIMENT_RESULT,
  EXPERIENCE_PROVENANCE.LAB_SIMULATION_RUN,
];

/**
 * Edge labels for evidence produced BECAUSE an objective is being pursued.
 *
 * Namespaced `evidence:` so an objective's edges stay legible at a glance:
 * `verified:*` edges say how an attempt at the objective turned out, while
 * `evidence:*` edges say what was learned along the way. Traversing an
 * objective node and filtering on this prefix is what lets VOX answer
 * "what do I know specifically because I am pursuing this?" — as opposed to
 * "what happens to be recent".
 *
 * The kind is part of the label, not flattened away, because a retrieved
 * research claim, a recorded experiment and a simulated model output are
 * different grades of evidence and must never be readable as one.
 */
export const EVIDENCE_RELATION = {
  RESEARCH: "evidence:research",
  EXPERIMENT: "evidence:experiment",
  SIMULATION: "evidence:simulation",
} as const;

export type EvidenceRelation = (typeof EVIDENCE_RELATION)[keyof typeof EVIDENCE_RELATION];

/** True for any edge drawn by the objective-evidence linkage. */
export function isEvidenceRelation(relation: string): boolean {
  return relation.startsWith("evidence:");
}

/**
 * A real record this experience is about. Each anchor gets (or reuses) a
 * graph node and is joined to the memory node by `relation`, so traversing
 * from an experiment, a research item, or an objective reaches what VOX
 * actually learned from it.
 */
export interface ExperienceAnchor {
  entityType: LinkableEntityType;
  entityId: string;
  label: string;
  /** What the edge means, e.g. "measured", "found", "verified:achieved". */
  relation: string;
  description?: string;
}

export interface RecordExperienceInput {
  userId: string;
  /** Assembled from real recorded values by the caller. */
  content: string;
  category: MemoryCategory;
  /** Must reflect what the source actually supports — never upgraded here. */
  confidence: Confidence;
  provenance: ExperienceProvenance;
  anchors?: ExperienceAnchor[];
  /** Optional provenance link to the ResearchItem this came from. */
  sourceResearchItemId?: string;
  /** The consequential event this experience corresponds to. */
  event?: {
    type: string;
    subjectType: string;
    subjectId: string;
    payload?: Record<string, unknown>;
    consequential?: boolean;
  };
}

export interface RecordedExperience {
  memoryId: string;
  /** Graph node ids actually created or reused, for callers that want to assert on them. */
  linkedNodeIds: string[];
}

export async function recordExperience(input: RecordExperienceInput): Promise<RecordedExperience | null> {
  try {
    const memory = await createMemory({
      userId: input.userId,
      content: input.content,
      category: input.category,
      confidence: input.confidence,
      provenance: input.provenance,
      source: input.sourceResearchItemId
        ? { type: "RESEARCH", researchItemId: input.sourceResearchItemId }
        : undefined,
    });

    const linkedNodeIds = await linkIntoGraph(input.userId, memory.id, input.content, input.anchors ?? []);

    if (input.event) {
      await recordEvent({
        userId: input.userId,
        type: input.event.type,
        subjectType: input.event.subjectType,
        subjectId: input.event.subjectId,
        consequential: input.event.consequential ?? true,
        payload: { ...input.event.payload, memoryId: memory.id },
      });
    }

    return { memoryId: memory.id, linkedNodeIds };
  } catch (error) {
    // Deliberately swallowed: the caller's real work is already persisted and
    // must not be rolled back because the derived knowledge layer failed.
    // Logged rather than silent so the failure is still diagnosable.
    logger.error("experience.record_failed", {
      provenance: input.provenance,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Draws the memory node and one edge per anchor. Individually best-effort:
 * one anchor failing (a deleted record, a unique-constraint race) must not
 * cost the caller the other edges.
 */
async function linkIntoGraph(
  userId: string,
  memoryId: string,
  memoryContent: string,
  anchors: ExperienceAnchor[]
): Promise<string[]> {
  if (anchors.length === 0) return [];

  const linked: string[] = [];
  let memoryNodeId: string;
  try {
    const memoryNode = await ensureNodeForEntity(userId, "MEMORY", memoryId, memoryContent.slice(0, 120));
    memoryNodeId = memoryNode.id;
    linked.push(memoryNode.id);
  } catch (error) {
    logger.error("experience.memory_node_failed", {
      memoryId,
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }

  for (const anchor of anchors) {
    try {
      const node = await ensureNodeForEntity(
        userId,
        anchor.entityType,
        anchor.entityId,
        anchor.label,
        anchor.description
      );
      await createConnection({
        userId,
        fromNodeId: node.id,
        toNodeId: memoryNodeId,
        relation: anchor.relation,
      });
      linked.push(node.id);
    } catch (error) {
      logger.error("experience.anchor_link_failed", {
        entityType: anchor.entityType,
        entityId: anchor.entityId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return linked;
}

/**
 * The anchor that ties a piece of evidence to the objective it was produced
 * for, or null when the work was not done in pursuit of one.
 *
 * Ownership is re-checked here rather than trusted from the caller: an
 * objectiveId that arrived over an API boundary must not be able to attach
 * evidence to somebody else's objective, and an id pointing at a deleted
 * objective must degrade to "unscoped evidence" rather than failing the
 * caller's real work.
 *
 * Returns null on any doubt. Unlinked evidence is still recorded and still
 * reachable by recency — the only thing lost is the objective association,
 * which is exactly the right failure mode.
 */
export async function objectiveEvidenceAnchor(
  userId: string,
  objectiveId: string | null | undefined,
  relation: EvidenceRelation
): Promise<ExperienceAnchor | null> {
  if (!objectiveId) return null;
  try {
    const objective = await db.objective.findFirst({
      where: { id: objectiveId, userId },
      select: { id: true, title: true },
    });
    if (!objective) return null;
    return {
      entityType: "OBJECTIVE",
      entityId: objective.id,
      label: objective.title.slice(0, 120),
      relation,
    };
  } catch {
    return null;
  }
}

/**
 * Confirms an objectiveId belongs to this user, returning it or undefined.
 * Used at write time by the pipelines that persist `objectiveId` on their
 * own rows, so an unowned id is dropped rather than stored.
 */
export async function scopeObjectiveId(
  userId: string,
  objectiveId: string | null | undefined
): Promise<string | undefined> {
  if (!objectiveId) return undefined;
  const objective = await db.objective.findFirst({ where: { id: objectiveId, userId }, select: { id: true } });
  return objective ? objective.id : undefined;
}

/**
 * Maps the Lab's own confidence vocabulary onto the memory system's.
 *
 * Note the ceiling: LabConfidence.VERIFIED means a human recorded the result
 * as verified in the Lab, which is good evidence but is not the same as
 * VOX independently confirming it, so it maps to HIGH and never to CONFIRMED.
 * CONFIRMED stays reserved for facts a human stated directly (CLAUDE.md
 * rule 3 — confidence is never silently upgraded on the way in).
 */
export function labConfidenceToMemoryConfidence(
  labConfidence: "VERIFIED" | "ESTIMATED" | "HYPOTHETICAL" | "UNKNOWN"
): Confidence {
  switch (labConfidence) {
    case "VERIFIED":
      return "HIGH";
    case "ESTIMATED":
      return "MEDIUM";
    case "HYPOTHETICAL":
    case "UNKNOWN":
      return "LOW";
  }
}
