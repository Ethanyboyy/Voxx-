/**
 * [P6-E] THE DECISION THAT FOLLOWS A MEASUREMENT.
 *
 * P6-D closed the loop up to a measured, reconciled, ledger-backed result and
 * stopped there. Nothing consumed it. Three facts about the repository before
 * this module existed:
 *
 *   `deriveEvidenceStage()` terminates at `RECONCILED`, and `nextAction.ts`
 *     handled `AWAITING_OBSERVATION` and `MEASUREMENT_RECORDED` and not that —
 *     so a reconciled experiment fell through to "fund something new".
 *   `EconomicActionKind` DECLARED `DECIDE_EXPERIMENT` and `PosturePanel`
 *     labelled it, and nothing in the codebase could produce it. A promise in
 *     the recommendation vocabulary with no implementation behind it.
 *   `decide()` was reachable only from `runEconomicTick()`. A person looking at
 *     a finished experiment could not ask the one question the whole apparatus
 *     exists to answer: scale it, hold it, or kill it?
 *
 * So VOX could measure and could not learn. This module is the join, and it is
 * READ-ONLY.
 *
 * ---------------------------------------------------------------------------
 * WHY READ-ONLY, AND WHY THAT IS NOT A SHORTCUT
 * ---------------------------------------------------------------------------
 *
 * `applyDecision()` in `scheduler.ts` already writes decision state — it
 * records the lesson before marking a KILL terminal (so a crash between the two
 * loses neither), auto-applies a KILL because stopping needs no capability VOX
 * lacks, and parks a SCALE at `AWAITING_HUMAN` because I7 says SCALE never
 * becomes automatic execution. That writer is correct and the tick is its one
 * caller.
 *
 * A second writer would make "when did VOX last decide, and on what" ambiguous,
 * and the ambiguity would land on `Experiment.lastDecisionAt` — the column an
 * operator reads to know whether a kill has been applied. `decide()` is PURE,
 * so the decision is derivable on demand from the ledger and the contract;
 * there is nothing to persist that is not already recoverable. Deriving it is
 * strictly safer than storing it twice.
 *
 * ---------------------------------------------------------------------------
 * THE NEW INVARIANT: AN UNACCEPTED LEDGER IS NOT ACCEPTED EVIDENCE
 * ---------------------------------------------------------------------------
 *
 * `decide()` is arithmetic over the ledger. It will return SCALE on a ledger
 * nobody has looked at, and it is right to — the tick is bounded by its own
 * gates and has no human to ask. But a RECOMMENDATION TO A PERSON has to say
 * whether a person has accepted the measurement the arithmetic rests on, because
 * "scale this, it is up $400" and "scale this, it is up $400 according to a
 * figure nobody has verified" are different sentences and only one of them is
 * actionable.
 *
 * So every decision here carries a `DecisionEvidence` class, and the posture
 * only recommends DECIDE on `ACCEPTED`. P5-D drew this line once already —
 * a measurement is not evidence until a human accepts it (I10) — and this is
 * the same line, one layer further down the chain.
 */

import { db } from "@/lib/db";
import { decide, type DecisionResult, type MeasuredPerformance } from "@/lib/economic/decide";
import { toDecisionContract } from "@/lib/economic/experiments";
import { measureExperiment } from "@/lib/economic/scheduler";
import { isEconomicHalted } from "@/lib/economic/halt";
import { ECONOMIC_FIGURES, FIGURE_SPECS } from "@/lib/economic/figures";
import type { EconomicFigure } from "@/generated/prisma/enums";
import type { DecisionContract } from "@/lib/economic/decide";

/**
 * How well founded the ledger behind a decision is.
 *
 * THE WHOLE POINT OF THIS TYPE is that `decide()` cannot tell the difference and
 * must not have to. It takes numbers; this says what the numbers are worth.
 */
export type DecisionEvidence =
  /**
   * A human recorded a verdict on the measurement (`outcomeRecordedAt` set).
   * The only class the posture will recommend acting on.
   */
  | "ACCEPTED"
  /**
   * A measurement exists and nobody has accepted it. The arithmetic is sound
   * and the input is unverified, so the honest next step is to reconcile.
   */
  | "PROVISIONAL"
  /**
   * No measurement at all. The ledger may still be non-empty — a person can log
   * revenue directly — so `decide()` still returns a verdict, and that verdict
   * rests on no observation of this experiment whatsoever.
   */
  | "NO_MEASUREMENT";

export type DecisionRefusal =
  | "NOT_FOUND"
  /**
   * The contract is incomplete or incoherent, so it cannot be evaluated
   * deterministically. `toDecisionContract()` is the one judge of that, and it
   * returning null is a refusal rather than a default — see `decide.ts`.
   */
  | "CONTRACT_NOT_EXECUTABLE"
  /** The experiment has no economic asset, so there is no ledger to measure. */
  | "NO_LEDGER"
  /** Already terminal. A killed or completed contract is history. */
  | "ALREADY_TERMINAL";

export interface ExperimentDecisionView {
  experimentId: string;
  hypothesis: string;
  opportunityId: string | null;
  contract: DecisionContract;
  /** From the SAME ledger query the autonomous tick uses. */
  actual: MeasuredPerformance;
  result: DecisionResult;
  evidence: DecisionEvidence;
  /** The verdict a human recorded, when one exists. */
  humanVerdict: string | null;
  reconciledAt: Date | null;
  /** The decision state the SCHEDULER last wrote, for comparison. Never written here. */
  lastDecision: string | null;
  lastDecisionAt: Date | null;
  /**
   * What acting on this decision would mean, and which existing path does it.
   * Never a new path — SCALE still stops at a human (I7).
   */
  actionPath: string;
  /** Stated plainly, so a provisional decision cannot read as a finding. */
  caveats: string[];
}

export type ExperimentDecisionResult =
  | { available: true; view: ExperimentDecisionView }
  | { available: false; reason: DecisionRefusal; detail: string };

/**
 * Asks `decide()` about one experiment, on demand, and says what the answer is
 * worth.
 *
 * Composes `toDecisionContract()` + `measureExperiment()` + `decide()` — all
 * three existing — and adds only the evidence classification.
 */
export async function experimentDecisionState(
  userId: string,
  experimentId: string
): Promise<ExperimentDecisionResult> {
  const experiment = await db.experiment.findFirst({
    where: { id: experimentId, userId },
    include: { measurement: { select: { id: true } } },
  });
  if (!experiment) return { available: false, reason: "NOT_FOUND", detail: "No such experiment." };

  if (experiment.executionStatus === "KILLED" || experiment.executionStatus === "COMPLETED") {
    return {
      available: false,
      reason: "ALREADY_TERMINAL",
      detail: `This experiment is ${experiment.executionStatus}. Its contract is closed and re-deciding it would rewrite the record of why it ended.`,
    };
  }

  if (!experiment.economicAssetId) {
    return {
      available: false,
      reason: "NO_LEDGER",
      detail: "The experiment has no economic asset, so there is no ledger to measure and nothing to decide over.",
    };
  }

  const contract = toDecisionContract(experiment);
  if (!contract) {
    return {
      available: false,
      reason: "CONTRACT_NOT_EXECUTABLE",
      detail:
        "The contract is incomplete or incoherent, so it cannot be evaluated deterministically. A decision taken over a blank constraint would be a decision taken over a default nobody chose.",
    };
  }

  const [actual, halted, user] = await Promise.all([
    measureExperiment(experiment.economicAssetId),
    isEconomicHalted(userId),
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { maxAutonomousSpendUsd: true } }),
  ]);

  const result = decide({
    contract,
    actual,
    now: new Date(),
    halted,
    policyCeilingUsd: user.maxAutonomousSpendUsd,
  });

  // ---- THE EVIDENCE CLASSIFICATION -------------------------------------
  //
  // `outcomeRecordedAt` rather than the outcome enum: P5-D's own distinction
  // between "a human decided this" and "the enum happens to hold a value".
  const evidence: DecisionEvidence =
    experiment.outcomeRecordedAt !== null
      ? "ACCEPTED"
      : experiment.measurement !== null
        ? "PROVISIONAL"
        : "NO_MEASUREMENT";

  return {
    available: true,
    view: {
      experimentId: experiment.id,
      hypothesis: experiment.hypothesis,
      opportunityId: experiment.opportunityId,
      contract,
      actual,
      result,
      evidence,
      humanVerdict: experiment.outcomeRecordedAt !== null ? experiment.outcome : null,
      reconciledAt: experiment.outcomeRecordedAt,
      lastDecision: experiment.lastDecision,
      lastDecisionAt: experiment.lastDecisionAt,
      actionPath: describeActionPath(result.decision),
      caveats: decisionCaveats(evidence, result, actual),
    },
  };
}

/**
 * Which EXISTING path performs the decision. Never a new one.
 *
 * A KILL is applied by the economic tick, which needs no capability VOX lacks.
 * A SCALE is parked at `AWAITING_HUMAN` by that same tick, because I7 holds:
 * SCALE never becomes automatic execution, and this surface does not become the
 * exception to it.
 */
function describeActionPath(decision: DecisionResult["decision"]): string {
  switch (decision) {
    case "KILL":
      return "runEconomicTick() applies a KILL itself — stopping needs no capability VOX lacks, and a contract past its loss cap must not wait on a human to stop bleeding.";
    case "SCALE":
      return "runEconomicTick() parks a SCALE at AWAITING_HUMAN. Committing more capital remains requestCapital() -> a human's ApprovalGrant -> approveCapitalAllocation().";
    case "HOLD":
      return "Nothing to do. A HOLD is a decision, not an absence of one.";
  }
}

function decisionCaveats(
  evidence: DecisionEvidence,
  result: DecisionResult,
  actual: MeasuredPerformance
): string[] {
  const caveats: string[] = [];

  if (evidence === "PROVISIONAL") {
    caveats.push(
      "PROVISIONAL: a measurement exists and nobody has accepted it. The arithmetic below is sound and its input is unverified — record a verdict before acting on it."
    );
  }
  if (evidence === "NO_MEASUREMENT") {
    caveats.push(
      "NO MEASUREMENT: nothing has observed this experiment. The ledger figures below come from entries logged directly, not from an observation of this experiment, so the decision rests on no evidence about it at all."
    );
  }
  if (actual.revenueUsd === 0 && actual.expenseUsd === 0) {
    caveats.push(
      "The ledger for this experiment is empty. An empty ledger is a real zero — it is not a missing measurement — and a contract whose kill threshold is at or above zero will read it as a reason to stop."
    );
  }
  // The honest limit on every one of these figures, carried from P6-D.
  caveats.push(
    "Ledger figures are USER_RECORDED unless an external system of record confirmed them. Nothing in this repository has confirmed anything against one."
  );
  if (result.decision === "SCALE") {
    caveats.push(
      "A SCALE is a recommendation to commit more capital. It is not evidence that the opportunity is profitable, and one experiment clearing its own threshold is not a track record."
    );
  }
  return caveats;
}

// ---------------------------------------------------------------------------
// The learning link across opportunities
// ---------------------------------------------------------------------------

/**
 * [P6-E] WHERE ONE EXPERIMENT'S RESULT COULD INFORM ANOTHER OPPORTUNITY.
 *
 * `getMeasuredProbability()` already lifts an opportunity's OWN probability to
 * MEASURED once a verdict is recorded, so learning within one opportunity works
 * and has since P6-A. What has never existed is the link ACROSS them: a
 * reconciled experiment on opportunity A was invisible to opportunity B, so the
 * second experiment anybody ran was no better informed than the first.
 *
 * `COMPARABLE` is the basis for exactly that — "derived from the measured
 * outcome of a comparable opportunity VOX ran" — and P6-B already requires it
 * to name the opportunity it came from. The missing piece was never the write;
 * it was knowing which comparison is available to make.
 *
 * SO THIS RETURNS CANDIDATES AND NOTHING ELSE. It performs no upgrade. Whether
 * two opportunities are genuinely comparable is a judgement about the world —
 * a print-on-demand test and a consulting retainer share a figure name and
 * nothing else — and I19 is explicit that only explicit corroborating evidence
 * upgrades a figure. Auto-applying these would be the exact laundering that
 * invariant forbids: an unrelated measurement promoting an invented number
 * because the two rows happened to sit in the same table.
 */
export interface ComparableCandidate {
  /** The opportunity whose figure is weakly evidenced. */
  opportunityId: string;
  opportunityTitle: string;
  figure: EconomicFigure;
  figureLabel: string;
  /** The basis it holds now — always below the capital minimum. */
  currentBasis: string;
  /** The opportunity that has a MEASURED figure of the same kind. */
  sourceOpportunityId: string;
  sourceOpportunityTitle: string;
  sourceValue: number | null;
  /** The measurement backing the source figure. */
  sourceMeasurementId: string | null;
  /** The reconciled experiment behind it, which is what makes it citable. */
  sourceExperimentId: string;
  sourceVerdict: string;
  /** What a person would do to act on it — the existing P6-B path. */
  upgradePath: string;
}

/**
 * Candidate comparisons, newest source first.
 *
 * A candidate requires BOTH halves to be real: a target figure that is actually
 * too weak to fund, and a source figure that is actually MEASURED and backed by
 * an experiment a human reconciled. A MEASURED figure on an unreconciled
 * experiment is not offered, for the same reason the posture will not recommend
 * a PROVISIONAL decision.
 */
export async function comparableCandidates(userId: string, limit = 20): Promise<ComparableCandidate[]> {
  // The reconciled experiments, by opportunity. `outcomeRecordedAt` is the
  // predicate — a human's verdict, not the enum holding a value.
  const reconciled = await db.experiment.findMany({
    where: { userId, outcomeRecordedAt: { not: null }, opportunityId: { not: null } },
    orderBy: { outcomeRecordedAt: "desc" },
    select: { id: true, opportunityId: true, outcome: true, outcomeRecordedAt: true },
  });
  if (reconciled.length === 0) return [];

  const reconciledByOpportunity = new Map<string, (typeof reconciled)[number]>();
  for (const experiment of reconciled) {
    // The most recent verdict per opportunity; the list is already ordered.
    if (experiment.opportunityId && !reconciledByOpportunity.has(experiment.opportunityId)) {
      reconciledByOpportunity.set(experiment.opportunityId, experiment);
    }
  }

  // EVERY figure, not just the ev-material ones.
  //
  // A real defect caught by its own test: scanning only `EV_MATERIAL_FIGURES`
  // excluded `EXPECTED_REVENUE_CENTS`, which is `materialToExpectedValue: false`
  // (revenue matters only as an input to the derived profit) — and is the ONLY
  // figure the P6-D loop ever promotes to MEASURED. So the one comparison the
  // measurement loop can actually produce was the one comparison this function
  // could never offer.
  //
  // Widening it is also right on its own terms: a better-evidenced revenue
  // improves the profit derived from it, and `weakestBasis()` makes that
  // improvement flow through honestly.
  const estimates = await db.opportunityEstimate.findMany({
    where: { userId, figure: { in: [...ECONOMIC_FIGURES] } },
    include: { opportunity: { select: { id: true, title: true } } },
  });

  const sources = estimates.filter(
    (e) => e.basis === "MEASURED" && reconciledByOpportunity.has(e.opportunityId)
  );
  // MODEL_SUGGESTED only. For an ev-material figure that is the basis that
  // blocks capital outright; for the others it is still the weakest thing a
  // figure can hold, and a figure already STATED or above has a source somebody
  // stands behind and needs no comparable offered to it.
  const targets = estimates.filter((e) => e.basis === "MODEL_SUGGESTED");
  if (sources.length === 0 || targets.length === 0) return [];

  const candidates: ComparableCandidate[] = [];
  for (const target of targets) {
    for (const source of sources) {
      if (source.opportunityId === target.opportunityId) continue;
      if (source.figure !== target.figure) continue;
      const experiment = reconciledByOpportunity.get(source.opportunityId)!;
      candidates.push({
        opportunityId: target.opportunityId,
        opportunityTitle: target.opportunity.title,
        figure: target.figure,
        figureLabel: FIGURE_SPECS[target.figure].label,
        currentBasis: target.basis,
        sourceOpportunityId: source.opportunityId,
        sourceOpportunityTitle: source.opportunity.title,
        sourceValue:
          source.valueCents ?? source.valueRatio ?? source.valueDays ?? null,
        sourceMeasurementId: source.measurementId,
        sourceExperimentId: experiment.id,
        sourceVerdict: experiment.outcome,
        upgradePath: `upgradeEstimate() with basis COMPARABLE and comparableId ${source.opportunityId} — but only if the two are genuinely comparable, which is a judgement about the world and not about the figures.`,
      });
      if (candidates.length >= limit) return candidates;
    }
  }
  return candidates;
}
