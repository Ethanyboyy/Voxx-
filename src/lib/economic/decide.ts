// SCALE / HOLD / KILL, decided by arithmetic.
//
// This module is pure. It performs no I/O, reads no database, calls no
// provider, and — most importantly — contains no model call. Given the same
// contract, the same measured ledger and the same clock it returns the same
// answer, every time, and that answer can be reproduced by hand from the
// numbers in `reasons`.
//
// WHY IT IS PURE. An LLM is a good source of hypotheses and a bad source of
// guarantees. "Don't lose more than $200 on this" is a guarantee, and a system
// that enforces it by asking a model to remember a sentence from a prompt is a
// system that will eventually spend $2,000. So the constraint is a float, the
// check is a comparison, and the comparison lives here where nothing can talk
// it out of firing. Nothing in VOX may override the result of this function:
// there is no override parameter, no confidence weighting and no advisory
// mode, because every one of those is a door.
//
// RULE ORDER IS THE SAFETY PROPERTY. The hard constraints are evaluated first
// and short-circuit. A contract that has blown its maximum loss is killed
// before anything else is even considered, including a scale threshold it may
// simultaneously satisfy — a strategy can be both up on the week and past its
// authorized downside, and in that case it dies.

export type EconomicDecision = "SCALE" | "HOLD" | "KILL";

/** Machine-readable codes so the UI and the audit trail never parse prose. */
export type DecisionReasonCode =
  | "MAX_LOSS_EXCEEDED"
  | "KILL_THRESHOLD_BREACHED"
  | "DEADLINE_PASSED_UNPROVEN"
  | "DEADLINE_PASSED_PROVEN"
  | "GLOBAL_HALT"
  | "SCALE_THRESHOLD_MET"
  | "CAPITAL_EXCEEDS_POLICY"
  | "WITHIN_BOUNDS";

export interface DecisionReason {
  code: DecisionReasonCode;
  /** Human-readable, with the actual numbers in it. Never the source of truth. */
  detail: string;
  /**
   * True for the single reason that determined the outcome. Exactly one
   * reason in a result is binding.
   */
  binding: boolean;
}

/**
 * The contract terms the decision layer needs, with every gating term
 * non-null.
 *
 * The non-nullability is the point. A contract row in the database has
 * nullable fields because a contract is written incrementally; this type is
 * what a COMPLETE contract looks like, so a half-written one cannot reach
 * `decide()` at all. `toDecisionContract()` in experiments.ts is the only
 * bridge, and it returns null rather than filling a blank with a default —
 * there is no safe default for "how much may this lose".
 */
export interface DecisionContract {
  experimentId: string;
  /** HARD. Net loss at or beyond which the experiment dies. Always > 0. */
  maxLossUsd: number;
  /** HARD. Capital the contract is authorized to deploy. */
  requiredCapitalUsd: number;
  /** Net at or above which the contract has proven itself. */
  scaleAtNetUsd: number;
  /** Net at or below which the contract has disproven itself. Usually negative. */
  killAtNetUsd: number;
  /** HARD. The date by which the contract must have proven itself. */
  deadlineAt: Date;
}

/** What actually happened, measured from the ledger — never estimated. */
export interface MeasuredPerformance {
  /** Net profit on this experiment's own asset. Negative means losing money. */
  netUsd: number;
  revenueUsd: number;
  expenseUsd: number;
}

export interface DecisionInput {
  contract: DecisionContract;
  actual: MeasuredPerformance;
  now: Date;
  /** The global economic halt. True means no new economic execution may begin. */
  halted: boolean;
  /**
   * The user's autonomous spend ceiling. A contract needing more capital than
   * policy allows can still be HELD or KILLED, but never SCALED autonomously.
   */
  policyCeilingUsd: number;
}

export interface DecisionResult {
  decision: EconomicDecision;
  /** Every rule that was evaluated, in order, with its numbers. */
  reasons: DecisionReason[];
  /** The code of the single binding reason. Always present. */
  bindingConstraint: DecisionReasonCode;
}

function usd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function resolve(decision: EconomicDecision, reasons: DecisionReason[], binding: DecisionReasonCode): DecisionResult {
  return {
    decision,
    reasons: reasons.map((r) => ({ ...r, binding: r.code === binding })),
    bindingConstraint: binding,
  };
}

/**
 * The one decision function. Deterministic, total, and not overridable.
 *
 * Evaluation order, hard constraints first:
 *
 *   1. MAXIMUM LOSS. Realized net loss >= maxLossUsd -> KILL. Checked before
 *      everything, including the halt: a halt stops NEW activity, it is not a
 *      reason to leave a contract bleeding past its authorized downside.
 *   2. KILL THRESHOLD. Net <= killAtNetUsd -> KILL. Independent of (1) so a
 *      contract can name a stop that is tighter than its absolute loss cap.
 *   3. GLOBAL HALT -> HOLD. Never SCALE while halted. KILL stays reachable
 *      above this line because killing only ever reduces exposure.
 *   4. DEADLINE. Past deadlineAt, the contract must have met its scale
 *      threshold. Met -> SCALE. Not met -> KILL: a contract that named a date
 *      and missed it has failed its own test, and "a bit longer" is how a
 *      losing experiment becomes permanent.
 *   5. CAPITAL vs POLICY. Scaling would need more capital than the user's own
 *      ceiling permits -> HOLD, not SCALE. VOX does not grow past what it was
 *      authorized to spend.
 *   6. SCALE THRESHOLD. Net >= scaleAtNetUsd -> SCALE.
 *   7. Otherwise HOLD.
 */
export function decide(input: DecisionInput): DecisionResult {
  const { contract, actual, now, halted, policyCeilingUsd } = input;
  const reasons: DecisionReason[] = [];

  // A loss is a negative net. Profit is never a loss of a negative amount.
  const lossUsd = actual.netUsd < 0 ? -actual.netUsd : 0;

  // ---- 1. MAXIMUM LOSS — the hard constraint, checked first, no exceptions.
  const maxLossExceeded = lossUsd >= contract.maxLossUsd;
  reasons.push({
    code: "MAX_LOSS_EXCEEDED",
    detail: `Net loss ${usd(lossUsd)} against a maximum authorized loss of ${usd(contract.maxLossUsd)}.`,
    binding: false,
  });
  if (maxLossExceeded) return resolve("KILL", reasons, "MAX_LOSS_EXCEEDED");

  // ---- 2. The contract's own kill threshold.
  const killBreached = actual.netUsd <= contract.killAtNetUsd;
  reasons.push({
    code: "KILL_THRESHOLD_BREACHED",
    detail: `Net ${usd(actual.netUsd)} against a kill threshold of ${usd(contract.killAtNetUsd)}.`,
    binding: false,
  });
  if (killBreached) return resolve("KILL", reasons, "KILL_THRESHOLD_BREACHED");

  // ---- 3. Global halt. Stops growth, never blocks a kill (handled above).
  reasons.push({
    code: "GLOBAL_HALT",
    detail: halted
      ? "The global economic halt is engaged; no new economic execution may begin."
      : "The global economic halt is not engaged.",
    binding: false,
  });
  if (halted) return resolve("HOLD", reasons, "GLOBAL_HALT");

  // ---- 4. Deadline. Prove it by the date you named, or stop.
  const scaleMet = actual.netUsd >= contract.scaleAtNetUsd;
  if (now >= contract.deadlineAt) {
    if (scaleMet) {
      reasons.push({
        code: "DEADLINE_PASSED_PROVEN",
        detail: `Deadline ${contract.deadlineAt.toISOString()} passed with net ${usd(actual.netUsd)} at or above the scale threshold ${usd(contract.scaleAtNetUsd)}.`,
        binding: false,
      });
      return resolve("SCALE", reasons, "DEADLINE_PASSED_PROVEN");
    }
    reasons.push({
      code: "DEADLINE_PASSED_UNPROVEN",
      detail: `Deadline ${contract.deadlineAt.toISOString()} passed with net ${usd(actual.netUsd)} below the scale threshold ${usd(contract.scaleAtNetUsd)}.`,
      binding: false,
    });
    return resolve("KILL", reasons, "DEADLINE_PASSED_UNPROVEN");
  }

  // ---- 5/6. Scaling: only inside the authorized capital ceiling.
  reasons.push({
    code: "SCALE_THRESHOLD_MET",
    detail: `Net ${usd(actual.netUsd)} against a scale threshold of ${usd(contract.scaleAtNetUsd)}.`,
    binding: false,
  });
  if (scaleMet) {
    if (contract.requiredCapitalUsd > policyCeilingUsd) {
      reasons.push({
        code: "CAPITAL_EXCEEDS_POLICY",
        detail: `Scaling needs ${usd(contract.requiredCapitalUsd)}, above the autonomous spend ceiling of ${usd(policyCeilingUsd)}.`,
        binding: false,
      });
      return resolve("HOLD", reasons, "CAPITAL_EXCEEDS_POLICY");
    }
    return resolve("SCALE", reasons, "SCALE_THRESHOLD_MET");
  }

  // ---- 7. Running, inside every bound, not yet proven.
  reasons.push({
    code: "WITHIN_BOUNDS",
    detail: `Net ${usd(actual.netUsd)} is inside every constraint and below the scale threshold; the experiment continues.`,
    binding: false,
  });
  return resolve("HOLD", reasons, "WITHIN_BOUNDS");
}
