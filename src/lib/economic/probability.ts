/**
 * MEASURED PROBABILITY — arithmetic over verdicts a human recorded.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------------------------------------------------------
 *
 * `src/lib/economic/decide.ts` has always been able to consume a probability,
 * and `ExperimentOutcome` has always had WIN and LOSS in it. But before this
 * module, NOTHING IN VOX COULD WRITE EITHER ONE. The only outcome any code path
 * ever set was `KILLED_BY_CONSTRAINT`, in `scheduler.ts`. So a "success rate"
 * computed from experiment outcomes was, unavoidably, a division over an empty
 * set — and the honest rendering of that is not 0%, and it is certainly not
 * 50%. It is "no basis".
 *
 * Two functions here, and the split between them is the whole point:
 *
 *   `reconcileExperimentOutcome()`  A HUMAN records a verdict.
 *   `getMeasuredProbability()`      VOX counts verdicts humans recorded.
 *
 * VOX never writes a verdict. It can measure, and measuring is a different act
 * from judging — see `src/lib/economic/evidence.ts`, where a measurement is
 * produced and is explicitly NOT evidence until it passes through here.
 *
 * ---------------------------------------------------------------------------
 * NO MODEL TOUCHES ANY OF THIS
 * ---------------------------------------------------------------------------
 *
 * There is no prompt in this file, no LLM call, no inference, and no smoothing
 * prior. A probability is wins over decided experiments, computed from rows. If
 * an LLM were allowed to "estimate" it, the estimate would be a number with no
 * referent that the decision layer would then treat as measurement — which is
 * precisely the failure this module exists to make impossible.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import type { ExperimentOutcome, OutcomeEvidenceBasis } from "@/generated/prisma/client";

/**
 * The verdicts a person may record.
 *
 * PENDING is absent deliberately — "I have not decided" is the absence of a
 * verdict, not one of the choices, and allowing it here would let a recorded
 * reconciliation mean nothing. `KILLED_BY_CONSTRAINT` is also absent: that is
 * the scheduler's to write when a hard constraint fires, and a human choosing
 * it by hand would be backdating a constraint that never fired.
 */
export const HUMAN_VERDICTS = ["WIN", "LOSS", "INCONCLUSIVE"] as const;
export type HumanVerdict = (typeof HUMAN_VERDICTS)[number];

export function isHumanVerdict(value: unknown): value is HumanVerdict {
  return typeof value === "string" && (HUMAN_VERDICTS as readonly string[]).includes(value);
}

/**
 * Which outcomes count toward a measured probability.
 *
 * INCONCLUSIVE is decided but it is not a trial: it went neither way, and
 * counting it as a loss would manufacture pessimism exactly as counting it as a
 * win would manufacture optimism. It is excluded from BOTH numerator and
 * denominator, which is the only treatment that adds no opinion.
 *
 * KILLED_BY_CONSTRAINT is likewise excluded. A constraint firing says the
 * experiment was stopped, not that the hypothesis was wrong.
 */
const COUNTED_OUTCOMES: readonly ExperimentOutcome[] = ["WIN", "LOSS"] as const;

export type ReconcileRefusal =
  /** No such experiment for this user. */
  | "NOT_FOUND"
  /** A verdict is already recorded. Changing one is a separate, audited act. */
  | "ALREADY_RECONCILED"
  /** Not one of WIN / LOSS / INCONCLUSIVE. */
  | "INVALID_VERDICT"
  /**
   * THE IMPORTANT ONE.
   *
   * VOX dispatched an execution for this experiment and no measurement came
   * out of it. Reconciling anyway would let an execution whose result was never
   * observed — the provider was down, the run died mid-step, the window was
   * still open — be written up as a success or a failure on the strength of
   * somebody's recollection, while carrying the full audit trail of a real
   * execution behind it. Refusing is the only honest response: observe it, or
   * record the measurement by hand and say that is what you did.
   */
  | "MEASUREMENT_MISSING";

export type ReconcileResult =
  | { reconciled: true; outcome: HumanVerdict; basis: OutcomeEvidenceBasis; measurementId: string | null }
  | { reconciled: false; reason: ReconcileRefusal };

export interface ReconcileInput {
  userId: string;
  experimentId: string;
  verdict: HumanVerdict;
  /** The person's own words. Stored verbatim, never parsed, never counted. */
  note?: string;
}

/**
 * Records a HUMAN's verdict on an experiment, binding it to the evidence that
 * existed at that moment.
 *
 * THE ONE PATH from a measurement to something the probability counts. Nothing
 * else in VOX may write WIN or LOSS.
 *
 * What gets bound, and why each piece:
 *
 *   `outcomeMeasurementId`      which measurement was in front of the person
 *   `outcomeMeasurementDigest`  what that measurement said AT THAT MOMENT, so a
 *                               later edit to the row no longer matches the
 *                               verdict resting on it
 *   `outcomeEvidenceBasis`      what KIND of thing it was, recorded explicitly
 *                               rather than re-derived later from a row that
 *                               may since have been deleted
 */
export async function reconcileExperimentOutcome(input: ReconcileInput): Promise<ReconcileResult> {
  const { userId, experimentId, verdict } = input;

  if (!isHumanVerdict(verdict)) return { reconciled: false, reason: "INVALID_VERDICT" };

  const experiment = await db.experiment.findFirst({
    where: { id: experimentId, userId },
    include: { measurement: true },
  });
  if (!experiment) return { reconciled: false, reason: "NOT_FOUND" };
  if (experiment.outcomeRecordedAt !== null) return { reconciled: false, reason: "ALREADY_RECONCILED" };

  // ---- THE REFUSAL THAT MATTERS -------------------------------------------
  //
  // An experiment VOX executed but never observed cannot become a success or a
  // failure. Note the condition is on the EXECUTION, not on the measurement: an
  // experiment that was never dispatched at all is a perfectly ordinary thing
  // for a person to judge from their own knowledge of the world, and it
  // reconciles as HUMAN_EXTERNAL below. What is forbidden is the in-between —
  // VOX ran something, nobody knows what came back, and a verdict is recorded
  // as though somebody did.
  if (experiment.executionRunId !== null && experiment.measurement === null) {
    return { reconciled: false, reason: "MEASUREMENT_MISSING" };
  }

  // Exhaustive over MeasurementSource. A switch rather than a chain of
  // conditionals so that adding a source to the enum fails the type check here
  // instead of silently falling into whichever branch happens to be last.
  const basis: OutcomeEvidenceBasis = ((): OutcomeEvidenceBasis => {
    switch (experiment.measurement?.source) {
      case "EXTERNAL_OBSERVED":
        return "EXTERNAL_MEASUREMENT";
      case "MACHINE_OBSERVED":
        return "MACHINE_MEASUREMENT";
      case "HUMAN_ENTERED":
      case undefined:
        // A person's own figure, or no measurement at all. Either way the
        // verdict rests on the person, and the basis says so.
        return "HUMAN_EXTERNAL";
    }
  })();

  const updated = await db.experiment.updateMany({
    // `outcomeRecordedAt: null` in the WHERE is the concurrency guard: two
    // simultaneous reconciliations both read null above, and exactly one of
    // them matches a row here. The loser writes nothing.
    where: { id: experimentId, userId, outcomeRecordedAt: null },
    data: {
      outcome: verdict,
      outcomeRecordedAt: new Date(),
      outcomeNote: input.note ?? null,
      outcomeEvidenceBasis: basis,
      outcomeMeasurementId: experiment.measurement?.id ?? null,
      outcomeMeasurementDigest: experiment.measurement?.digest ?? null,
    },
  });
  if (updated.count === 0) return { reconciled: false, reason: "ALREADY_RECONCILED" };

  await recordEvent({
    userId,
    type: "economic.experiment.outcome.reconciled",
    subjectType: "Experiment",
    subjectId: experimentId,
    // Consequential: this is the moment a measurement becomes evidence, and it
    // is the only moment. An auditor asking "who decided this was a win" has to
    // find a person's name and a timestamp here.
    consequential: true,
    payload: {
      verdict,
      basis,
      measurementId: experiment.measurement?.id ?? null,
      measurementDigest: experiment.measurement?.digest ?? null,
      hadExecution: experiment.executionRunId !== null,
    },
  });

  return { reconciled: true, outcome: verdict, basis, measurementId: experiment.measurement?.id ?? null };
}

/**
 * What a measured probability rests on.
 *
 * `basis` is not decoration. A caller that renders a bare percentage without it
 * turns "1 win out of 1 decided experiment" into "100% success rate", which is
 * the single most misleading thing this module could produce.
 */
export interface ProbabilityEvidence {
  /** Reconciled WINs. */
  wins: number;
  /** Reconciled LOSSes. */
  losses: number;
  /** wins + losses. The denominator, and it is a real one. */
  decided: number;
  /** Decided but counted toward neither, i.e. INCONCLUSIVE. Reported, not used. */
  inconclusive: number;
  /**
   * wins / decided, or NULL when `decided` is zero.
   *
   * NULL, never 0, never 0.5. A system with no trials has no success rate, and
   * every number that could be shown in its place is a claim about the world
   * that nothing supports. Callers must render the null as an absence.
   */
  probability: number | null;
  /** How many of the counted verdicts rest on each kind of evidence. */
  byBasis: Record<OutcomeEvidenceBasis, number>;
}

export interface ProbabilityQuery {
  userId: string;
  /** Narrow to one opportunity's experiments. Omitted means all of them. */
  opportunityId?: string;
  /**
   * Count only verdicts backed by a measurement VOX itself produced.
   *
   * Off by default, because a person's own honest report of what happened is
   * legitimate evidence and excluding it would understate what is known. On,
   * it answers a narrower and sometimes more interesting question: what does
   * VOX know from things VOX actually observed?
   */
  machineObservedOnly?: boolean;
}

/**
 * Counts reconciled verdicts. No estimation, no prior, no model.
 */
export async function getMeasuredProbability(query: ProbabilityQuery): Promise<ProbabilityEvidence> {
  const experiments = await db.experiment.findMany({
    where: {
      userId: query.userId,
      ...(query.opportunityId ? { opportunityId: query.opportunityId } : {}),
      // A verdict, not merely an outcome value. `outcomeRecordedAt` is what
      // separates "a human decided this" from "the enum happens to hold a
      // value", and it is the only predicate that can tell them apart.
      outcomeRecordedAt: { not: null },
      ...(query.machineObservedOnly
        ? { outcomeEvidenceBasis: { in: ["MACHINE_MEASUREMENT", "EXTERNAL_MEASUREMENT"] } }
        : {}),
    },
    select: { outcome: true, outcomeEvidenceBasis: true },
  });

  const byBasis: Record<OutcomeEvidenceBasis, number> = {
    MACHINE_MEASUREMENT: 0,
    EXTERNAL_MEASUREMENT: 0,
    HUMAN_EXTERNAL: 0,
  };

  let wins = 0;
  let losses = 0;
  let inconclusive = 0;
  for (const e of experiments) {
    if (e.outcome === "INCONCLUSIVE") inconclusive += 1;
    if (!COUNTED_OUTCOMES.includes(e.outcome)) continue;
    if (e.outcome === "WIN") wins += 1;
    else losses += 1;
    if (e.outcomeEvidenceBasis) byBasis[e.outcomeEvidenceBasis] += 1;
  }

  const decided = wins + losses;
  return {
    wins,
    losses,
    decided,
    inconclusive,
    probability: decided === 0 ? null : wins / decided,
    byBasis,
  };
}
