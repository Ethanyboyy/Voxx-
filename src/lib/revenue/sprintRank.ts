/**
 * [SPRINT] RANKING OPPORTUNITIES ON A 72-HOUR HORIZON.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT `scoreOpportunity()`
 * ---------------------------------------------------------------------------
 *
 * `src/lib/objectives/service.ts#scoreOpportunity()` already weighs value,
 * effort, confidence, risk, startup cost, operating cost, margin, complexity,
 * competition, scalability and human involvement — which is every criterion a
 * near-term revenue sprint cares about, and this module reuses the same columns
 * rather than inventing a parallel set.
 *
 * It is wrong for a 72-hour question for exactly one reason:
 *
 *     speedMultiplier = 30 / max(7, estimatedTimeToRevenueDays)
 *
 * The denominator is CLAMPED AT 7. A one-day opportunity and a seven-day
 * opportunity score identically on speed, and inside a three-day sprint that is
 * the single most important difference there is. Everything that can pay this
 * week collapses into one indistinguishable band.
 *
 * `scoreOpportunity()` is deliberately left alone: it is the general-purpose
 * ranker, its weights are load-bearing for the Brain's "Why?" panel, and
 * re-tuning a shared formula to answer one time-boxed question would silently
 * re-rank every opportunity in the system. So this is a SECOND, NARROWER ranker
 * with its horizon in its name, and the two are expected to disagree — on a
 * 72-hour horizon they SHOULD.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT OPTIMIZES
 * ---------------------------------------------------------------------------
 *
 *     expected near-term cash
 *     ────────────────────────────────────────
 *     days to first dollar × capital at risk
 *
 * Expected cash is `estimatedValue × margin × P(paid inside the window)`, and
 * P is read from the row's own `confidence`, not from anywhere else.
 *
 * ---------------------------------------------------------------------------
 * IT GENERATES NO NUMBER THAT WAS NOT ALREADY ON THE ROW
 * ---------------------------------------------------------------------------
 *
 * Same discipline as `scoreOpportunity()`: a null field is "not yet known",
 * never zero and never "bad". The output is a re-ranking plus a breakdown of
 * its own arithmetic, so "why is this first" always decomposes.
 *
 * AND THE SCORE IS NOT EVIDENCE. Every input here is an estimate somebody typed
 * or a model suggested. A rank is not a forecast, a forecast is not a sale, and
 * nothing in this file may be read as saying money will arrive — see
 * `ECONOMIC_INVARIANTS.md#i25`. The figures carry whatever `EvidenceBasis` the
 * P6-B provenance layer recorded for them, which for a fresh sprint list is
 * `MODEL_SUGGESTED` throughout.
 */

import type { Confidence, EffortLevel, RiskLevel } from "@/generated/prisma/enums";

/** The horizon this ranker is built for. Named, because it is the whole premise. */
export const SPRINT_HORIZON_DAYS = 3;

/**
 * The fields this ranker reads. A structural subset of `Opportunity`, so a
 * caller cannot pass something that merely resembles one.
 */
export interface SprintCandidate {
  id: string;
  title: string;
  estimatedValue: number | null;
  estimatedMargin: number | null;
  estimatedStartupCost: number | null;
  estimatedTimeToRevenueDays: number | null;
  confidence: Confidence;
  effort: EffortLevel | null;
  requiredHumanInvolvement: RiskLevel | null;
  scalability: RiskLevel | null;
}

/**
 * Probability that money actually arrives, read off `confidence`.
 *
 * These are coarse on purpose. A sprint list is built from judgement, and
 * dressing judgement up as 0.37 would imply a basis that does not exist.
 */
const PAID_PROBABILITY: Record<Confidence, number> = {
  // The ceiling is deliberately nowhere near 1. `CONFIRMED` on an Opportunity
  // means the OPPORTUNITY is corroborated — that this kind of work sells. It
  // says nothing about whether the specific person who was messaged on Tuesday
  // will pay by Friday, and a probability near 1 here would quietly convert the
  // first into the second.
  CONFIRMED: 0.65,
  HIGH: 0.5,
  MEDIUM: 0.25,
  LOW: 0.1,
};

/** Human hours are the scarce resource in a 72-hour sprint, so effort divides. */
const EFFORT_DAYS: Record<EffortLevel, number> = { LOW: 0.5, MEDIUM: 1.5, HIGH: 4 };

/** How much of the work a person has to do themselves. A drag, never a bonus. */
const HUMAN_DRAG: Record<RiskLevel, number> = { LOW: 1, MEDIUM: 0.8, HIGH: 0.55 };

/** Tie-break only. Scale cannot rescue something that pays nothing this week. */
const SCALE_BONUS: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 0.08, HIGH: 0.18 };

export interface SprintScoreBreakdown {
  score: number;
  /** estimatedValue × margin — the cash a single sale would actually leave. */
  netPerSale: number;
  valueIsAssumedDefault: boolean;
  marginIsAssumedDefault: boolean;
  paidProbability: number;
  /** netPerSale × paidProbability. */
  expectedCash: number;
  /**
   * Days to a first dollar, NOT clamped at 7 — the whole reason this module
   * exists. Floored at 0.5: nothing pays in zero days, and a zero would make
   * the division explode rather than rank.
   */
  daysToFirstDollar: number;
  timeIsAssumedDefault: boolean;
  /** Capital at risk, as a divisor. $0 of capital is a divisor of 1. */
  capitalDivisor: number;
  humanDrag: number;
  scaleBonus: number;
  /** True when the opportunity cannot pay inside the horizon at all. */
  outsideHorizon: boolean;
}

/**
 * Scores one candidate. Pure, and it reads nothing but the row.
 */
export function scoreSprintCandidate(o: SprintCandidate): SprintScoreBreakdown {
  // An unknown value is treated as $1, exactly as `scoreOpportunity()` does, so
  // the other factors still rank a row with no estimate instead of zeroing it.
  const valueIsAssumedDefault = o.estimatedValue == null;
  const value = o.estimatedValue ?? 1;

  // An unknown margin is NOT assumed to be 100%. A service business keeping
  // everything it bills is the optimistic case, and assuming the optimistic
  // case is how a ranking starts flattering itself.
  const marginIsAssumedDefault = o.estimatedMargin == null;
  const margin = marginIsAssumedDefault ? 0.5 : Math.max(0, Math.min(1, o.estimatedMargin!));

  const netPerSale = value * margin;
  const paidProbability = PAID_PROBABILITY[o.confidence];
  const expectedCash = netPerSale * paidProbability;

  // UNCLAMPED, unlike the general scorer. This is the line this module is for.
  const timeIsAssumedDefault = o.estimatedTimeToRevenueDays == null;
  const declaredDays = timeIsAssumedDefault
    ? EFFORT_DAYS[o.effort ?? "MEDIUM"]
    : Math.max(0.5, o.estimatedTimeToRevenueDays!);
  const daysToFirstDollar = Math.max(0.5, declaredDays);

  // Capital is a divisor rather than a subtraction, because the question is
  // cash per dollar risked. $500 of startup cost halves the score; $0 leaves it.
  const capitalDivisor = 1 + (o.estimatedStartupCost ?? 0) / 500;

  const humanDrag = HUMAN_DRAG[o.requiredHumanInvolvement ?? "MEDIUM"];
  const scaleBonus = o.scalability ? SCALE_BONUS[o.scalability] : 0;

  // Outside the horizon it still scores, and it scores badly — reported rather
  // than filtered, so a list never silently drops a row a person entered.
  const outsideHorizon = daysToFirstDollar > SPRINT_HORIZON_DAYS;

  const score =
    ((expectedCash / daysToFirstDollar) / capitalDivisor) * humanDrag * (1 + scaleBonus);

  return {
    score,
    netPerSale,
    valueIsAssumedDefault,
    marginIsAssumedDefault,
    paidProbability,
    expectedCash,
    daysToFirstDollar,
    timeIsAssumedDefault,
    capitalDivisor,
    humanDrag,
    scaleBonus,
    outsideHorizon,
  };
}

export interface RankedSprintCandidate extends SprintCandidate {
  rank: number;
  breakdown: SprintScoreBreakdown;
}

/**
 * Ranks a list, highest expected cash per day per dollar first.
 *
 * Ties break by id so the order is stable across calls — an unstable ranking
 * reads as the system changing its mind.
 */
export function rankSprintCandidates(candidates: SprintCandidate[]): RankedSprintCandidate[] {
  return candidates
    .map((candidate) => ({ candidate, breakdown: scoreSprintCandidate(candidate) }))
    .sort((a, b) =>
      b.breakdown.score === a.breakdown.score
        ? a.candidate.id.localeCompare(b.candidate.id)
        : b.breakdown.score - a.breakdown.score
    )
    .map(({ candidate, breakdown }, index) => ({ ...candidate, rank: index + 1, breakdown }));
}
