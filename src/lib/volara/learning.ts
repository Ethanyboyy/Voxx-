/**
 * [P4-F] ECONOMIC MEMORY — the deliberate, narrow path into durable learning.
 *
 * §11 of the brief is explicit: "Do not blindly persist every agent message as
 * long-term memory", and it names the layers that must stay separate. In VOX
 * they already are, and this module is the only bridge between the last two:
 *
 *   RAW EVENT   `Event` rows. Everything that happened. Written constantly.
 *   MESSAGE     `AgentMessage` rows. What agents said. Never memory.
 *   OBSERVATION `AgentStateTransition`, cycle payloads. What the runtime saw.
 *   FACT        Ledger rows. `EconomicRevenue` / `EconomicExpense`. Money.
 *   RESULT      Derived metrics. Computed, never stored.
 *   LESSON      `Strategy.lessons`. Scoped to one strategy, human-readable.
 *   LONG-TERM   `Memory`. Durable, cross-domain, retrievable by the whole system.
 *
 * ONLY A SETTLED STRATEGY BECOMES A MEMORY, and only with ledger evidence
 * behind it. A strategy still running has not taught anything yet; a strategy
 * that spent and earned nothing has no result to learn from. Promoting either
 * would fill VOX's long-term memory with claims that later turn out false, and
 * memory is the one store where that damage compounds.
 *
 * AND IT LANDS AS AN INFERENCE AT LOW CONFIDENCE. CLAUDE.md rule 3: memory
 * confidence is never silently upgraded, and an inference stays an inference
 * until a human or a corroborating explicit fact promotes it. "This strategy
 * made money once" is exactly an inference — one observation, one context — so
 * it is recorded as one. Nothing here writes `HIGH` or `CONFIRMED`.
 */

import { db } from "@/lib/db";
import { createMemory } from "@/lib/memory/service";
import { recordEvent } from "@/lib/observability/events";
import { formatCents } from "@/lib/economic/money";
import { VOLARA_EVENTS } from "@/lib/volara/events";
import { getStrategyMetrics } from "@/lib/volara/metrics";
import { parseIdList } from "@/lib/volara/ledger";

export type PromotionRefusal =
  | "NOT_FOUND"
  | "NOT_SETTLED"
  | "NO_ECONOMIC_EVIDENCE"
  | "ALREADY_PROMOTED";

export type PromotionResult =
  | { promoted: true; memoryId: string; realizedProfitCents: number }
  | { promoted: false; reason: PromotionRefusal };

/** Marks a promotion so a re-run cannot write the same lesson twice. */
const PROMOTION_PROVENANCE = "volara.strategy_outcome";

/**
 * Promotes one settled strategy's outcome into durable memory.
 *
 * Idempotent through the `Event` trail rather than a flag column: a
 * `volara.lesson_recorded` event for this strategy means it has already been
 * promoted, and a second call refuses. That keeps the check on the same
 * append-only record everything else is audited against, instead of adding a
 * boolean that could be cleared.
 *
 * The memory's TEXT is composed from real values — the strategy's name, its
 * realized profit from the ledger, its recorded probability estimate beside
 * what actually happened. Nothing in it is generated prose about how well an
 * agent did.
 */
export async function promoteStrategyOutcome(input: {
  userId: string;
  strategyId: string;
  correlationId: string;
}): Promise<PromotionResult> {
  const strategy = await db.strategy.findFirst({
    where: { id: input.strategyId, userId: input.userId },
  });
  if (!strategy) return { promoted: false, reason: "NOT_FOUND" };

  // Only a strategy that has actually ended. A running one has not taught
  // anything yet, and promoting mid-flight is how a temporary result becomes a
  // permanent belief.
  if (strategy.status !== "KILLED" && strategy.status !== "COMPLETED") {
    return { promoted: false, reason: "NOT_SETTLED" };
  }

  const alreadyPromoted = await db.event.count({
    where: {
      userId: input.userId,
      type: VOLARA_EVENTS.LESSON_RECORDED,
      subjectType: "Strategy",
      subjectId: strategy.id,
    },
  });
  if (alreadyPromoted > 0) return { promoted: false, reason: "ALREADY_PROMOTED" };

  const metrics = await getStrategyMetrics(input.userId, strategy.id);
  // `actualSuccess === null` means the ledger recorded nothing for this
  // strategy. There is no outcome to learn from, and inventing one would be
  // exactly the fabricated result this phase forbids.
  if (!metrics || metrics.actualSuccess === null) {
    return { promoted: false, reason: "NO_ECONOMIC_EVIDENCE" };
  }

  const lessons = parseIdList(strategy.lessons);
  const estimate =
    metrics.probabilityEstimate === null
      ? "no probability was recorded in advance"
      : `the recorded estimate was ${metrics.probabilityEstimate}`;

  const content = [
    `Strategy "${strategy.name}" ended ${strategy.status === "COMPLETED" ? "completed" : "killed"}`,
    `with realized ${metrics.profitCents >= 0 ? "profit" : "loss"} of ${formatCents(Math.abs(metrics.profitCents))}`,
    `on ${formatCents(metrics.capitalDeployedCents)} deployed`,
    `(${estimate}).`,
    strategy.outcomeReason ? `Stated reason: ${strategy.outcomeReason}.` : "",
    lessons.length > 0 ? `Lessons recorded: ${lessons.join(" | ")}` : "",
    `Hypothesis was: ${strategy.hypothesis}`,
  ]
    .filter(Boolean)
    .join(" ");

  const memory = await createMemory({
    userId: input.userId,
    content,
    // An INFERENCE at LOW confidence. One outcome in one context is not a fact
    // about the world, and CLAUDE.md rule 3 forbids pretending otherwise.
    category: "INFERENCE",
    confidence: "LOW",
    provenance: PROMOTION_PROVENANCE,
  });

  await recordEvent({
    userId: input.userId,
    type: VOLARA_EVENTS.LESSON_RECORDED,
    subjectType: "Strategy",
    subjectId: strategy.id,
    consequential: false,
    payload: {
      memoryId: memory.id,
      realizedProfitCents: metrics.profitCents,
      capitalDeployedCents: metrics.capitalDeployedCents,
      actualSuccess: metrics.actualSuccess,
      probabilityEstimate: metrics.probabilityEstimate,
      correlationId: input.correlationId,
    },
  });

  return { promoted: true, memoryId: memory.id, realizedProfitCents: metrics.profitCents };
}

/**
 * Promotes every settled, unpromoted strategy.
 *
 * Errors are contained per strategy: one that cannot be promoted must not stop
 * the others, for the same reason `runSociety()` uses `allSettled`.
 */
export async function promoteSettledStrategies(
  userId: string,
  correlationId: string
): Promise<{ promoted: number; skipped: Array<{ strategyId: string; reason: PromotionRefusal }> }> {
  const settled = await db.strategy.findMany({
    where: { userId, status: { in: ["KILLED", "COMPLETED"] } },
    select: { id: true },
    take: 100,
  });

  let promoted = 0;
  const skipped: Array<{ strategyId: string; reason: PromotionRefusal }> = [];
  for (const strategy of settled) {
    const result = await promoteStrategyOutcome({ userId, strategyId: strategy.id, correlationId });
    if (result.promoted) promoted++;
    else skipped.push({ strategyId: strategy.id, reason: result.reason });
  }
  return { promoted, skipped };
}
