/**
 * [P6-B] RECORDING AND UPGRADING ONE FIGURE'S PROVENANCE.
 *
 * The write side of per-figure provenance. It replaces nothing in the
 * authorization architecture: it mints no permission, spends no capital,
 * executes nothing, and touches no ledger. All it does is record what is known
 * about one number and how well it is known.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS REPLACED A ONE-LINE HEURISTIC
 * ---------------------------------------------------------------------------
 *
 * P6-A derived every figure's basis from a single column:
 *
 *     statedBasisFor(opportunity.source)   // "user" -> STATED, else MODEL_SUGGESTED
 *
 * That was wrong in both directions at once. A person who corrected a model's
 * invented revenue figure could not make it count, because the row's discovery
 * source had not changed. And one genuinely measured figure made every other
 * figure on the same row look equally well-founded, because they all read the
 * same column. Provenance was a property of the ROW; it has to be a property of
 * the NUMBER.
 *
 * ---------------------------------------------------------------------------
 * THE TWO OPERATIONS, AND WHY THEY ARE SEPARATE
 * ---------------------------------------------------------------------------
 *
 *   recordEstimate()   state what is known about a figure now. Any basis, any
 *                      direction — including replacing a measured figure with a
 *                      weaker one, which is legitimate when a measurement is
 *                      superseded by a changed world.
 *   upgradeEstimate()  claim that a figure is now BETTER evidenced than it was.
 *                      Refuses anything that is not a rank increase, and
 *                      demands the evidence that rank requires.
 *
 * Keeping them apart is what makes "upgraded" mean something in the audit log.
 * A single `setBasis()` would make every write look like an improvement.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import {
  CAPITAL_MINIMUM_BASIS,
  canInfluenceCapital,
  describeBasis,
  isValidBasisUpgrade,
  type BasisTransitionRefusal,
} from "@/lib/economic/estimate";
import {
  figureSpec,
  figureValueColumns,
  figureValueOf,
  requiredEvidenceFor,
  type FigureValueError,
} from "@/lib/economic/figures";
import type { EconomicFigure, EvidenceBasis } from "@/generated/prisma/enums";
import type { OpportunityEstimate } from "@/generated/prisma/client";

/**
 * References to evidence that supports a basis. Every one is a foreign key, so
 * an id that does not exist cannot be stored.
 */
export interface EvidenceRefs {
  experimentId?: string | null;
  measurementId?: string | null;
  researchItemId?: string | null;
  comparableId?: string | null;
}

export type RecordEstimateRefusal =
  | "OPPORTUNITY_NOT_FOUND"
  | "INVALID_VALUE"
  | BasisTransitionRefusal;

export type RecordEstimateResult =
  | { recorded: true; estimate: OpportunityEstimate; capitalEligible: boolean }
  | { recorded: false; reason: RecordEstimateRefusal; detail: string };

export interface RecordEstimateInput {
  userId: string;
  opportunityId: string;
  figure: EconomicFigure;
  /** Cents for money, a 0-1 fraction for a ratio, whole days for a duration. */
  value: number;
  basis: EvidenceBasis;
  /** Where the basis came from, in words. Required. */
  provenance: string;
  /** When it was established. Defaults to now; a past measurement may set it earlier. */
  establishedAt?: Date;
  evidence?: EvidenceRefs;
}

function valueErrorDetail(figure: EconomicFigure, error: FigureValueError): string {
  const spec = figureSpec(figure);
  switch (error) {
    case "NOT_A_NUMBER":
      return `${spec.label} must be a finite number.`;
    case "NOT_AN_INTEGER":
      return spec.kind === "CENTS"
        ? `${spec.label} must be whole cents — a fractional cent is not a representable amount.`
        : `${spec.label} must be a whole number of days.`;
    case "OUT_OF_RANGE":
      return spec.kind === "RATIO"
        ? `${spec.label} must be between 0 and 1.`
        : spec.kind === "DAYS"
          ? `${spec.label} must be at least one day.`
          : `${spec.label} cannot be negative.`;
  }
}

/**
 * Checks that the evidence a basis requires was supplied AND exists.
 *
 * TWO CHECKS, NOT ONE. "Was an id given" is the easy half; "does the row exist
 * and belong to this user" is the half that stops an invented identifier from
 * conferring a measured basis. The brief is explicit that evidence identifiers
 * must not be fabricated, and the only way to enforce that is to go and look.
 */
async function verifyEvidence(
  userId: string,
  basis: EvidenceBasis,
  evidence: EvidenceRefs | undefined
): Promise<{ ok: true } | { ok: false; reason: BasisTransitionRefusal; detail: string }> {
  const required = requiredEvidenceFor(basis);
  if (required === "NONE") return { ok: true };

  if (required === "MEASUREMENT_OR_EXPERIMENT") {
    const measurementId = evidence?.measurementId ?? null;
    const experimentId = evidence?.experimentId ?? null;
    if (!measurementId && !experimentId) {
      return {
        ok: false,
        reason: "EVIDENCE_REQUIRED",
        detail:
          "A MEASURED basis has to name the measurement or experiment it came from. Without that, the strongest basis in the system would be the easiest one to assert.",
      };
    }
    if (measurementId) {
      const row = await db.experimentMeasurement.findFirst({
        where: { id: measurementId, userId },
        select: { id: true },
      });
      if (!row) {
        return { ok: false, reason: "EVIDENCE_NOT_FOUND", detail: "That measurement does not exist for this user." };
      }
    }
    if (experimentId) {
      const row = await db.experiment.findFirst({ where: { id: experimentId, userId }, select: { id: true } });
      if (!row) {
        return { ok: false, reason: "EVIDENCE_NOT_FOUND", detail: "That experiment does not exist for this user." };
      }
    }
    return { ok: true };
  }

  // COMPARABLE_OPPORTUNITY
  const comparableId = evidence?.comparableId ?? null;
  if (!comparableId) {
    return {
      ok: false,
      reason: "EVIDENCE_REQUIRED",
      detail:
        "A COMPARABLE basis has to name the opportunity it was derived from, so the comparison can be checked rather than taken on trust.",
    };
  }
  const row = await db.opportunity.findFirst({ where: { id: comparableId, userId }, select: { id: true } });
  if (!row) {
    return { ok: false, reason: "EVIDENCE_NOT_FOUND", detail: "That comparable opportunity does not exist for this user." };
  }
  return { ok: true };
}

/**
 * States what is known about one figure, replacing any previous record of it.
 *
 * Writes in EITHER direction. Weakening is legitimate and must stay possible: a
 * measured conversion rate from a shop that has since changed its pricing is no
 * longer measured evidence about today, and forcing provenance to be
 * monotonically non-decreasing would make the system unable to admit that
 * something it once knew is now stale.
 *
 * What it will not do is accept a strong basis without the evidence for it.
 */
export async function recordEstimate(input: RecordEstimateInput): Promise<RecordEstimateResult> {
  const { userId, opportunityId, figure, basis } = input;

  if (input.provenance.trim().length === 0) {
    return {
      recorded: false,
      reason: "INVALID_VALUE",
      detail: "A figure needs a stated source. A number with no provenance is a rumour.",
    };
  }

  const value = figureValueColumns(figure, input.value);
  if (!value.valid) {
    return { recorded: false, reason: "INVALID_VALUE", detail: valueErrorDetail(figure, value.error) };
  }

  const opportunity = await db.opportunity.findFirst({ where: { id: opportunityId, userId }, select: { id: true } });
  if (!opportunity) {
    return { recorded: false, reason: "OPPORTUNITY_NOT_FOUND", detail: "No such opportunity." };
  }

  const verified = await verifyEvidence(userId, basis, input.evidence);
  if (!verified.ok) return { recorded: false, reason: verified.reason, detail: verified.detail };

  const existing = await db.opportunityEstimate.findUnique({
    where: { opportunityId_figure: { opportunityId, figure } },
  });

  const data = {
    userId,
    opportunityId,
    figure,
    ...value.columns,
    basis,
    provenance: input.provenance.trim(),
    establishedAt: input.establishedAt ?? new Date(),
    experimentId: input.evidence?.experimentId ?? null,
    measurementId: input.evidence?.measurementId ?? null,
    researchItemId: input.evidence?.researchItemId ?? null,
    comparableId: input.evidence?.comparableId ?? null,
    // Only ever records the basis this figure actually held before, so the audit
    // trail cannot claim an upgrade that did not happen.
    previousBasis: existing && existing.basis !== basis ? existing.basis : (existing?.previousBasis ?? null),
  };

  const estimate = await db.opportunityEstimate.upsert({
    where: { opportunityId_figure: { opportunityId, figure } },
    create: data,
    update: data,
  });

  await recordEvent({
    userId,
    type: "economic.estimate.recorded",
    subjectType: "Opportunity",
    subjectId: opportunityId,
    // Consequential: this row decides whether a figure may influence capital,
    // and an auditor asking "why was this fundable" has to find it here.
    consequential: true,
    payload: {
      estimateId: estimate.id,
      figure,
      basis,
      previousBasis: existing?.basis ?? null,
      value: input.value,
      provenance: data.provenance,
      evidence: {
        experimentId: data.experimentId,
        measurementId: data.measurementId,
        researchItemId: data.researchItemId,
        comparableId: data.comparableId,
      },
      capitalEligible: canInfluenceCapital(basis),
      note: "An estimate about the future. It is not revenue and nothing sums it into profit.",
    },
  });

  return { recorded: true, estimate, capitalEligible: canInfluenceCapital(basis) };
}

export type UpgradeEstimateResult =
  | { upgraded: true; estimate: OpportunityEstimate; from: EvidenceBasis; to: EvidenceBasis }
  | { upgraded: false; reason: RecordEstimateRefusal | "NOT_RECORDED"; detail: string };

export interface UpgradeEstimateInput {
  userId: string;
  opportunityId: string;
  figure: EconomicFigure;
  basis: EvidenceBasis;
  provenance: string;
  /** The corroborating evidence. Required for MEASURED and COMPARABLE. */
  evidence?: EvidenceRefs;
  /** A corrected value, when the better evidence also changed the number. */
  value?: number;
  establishedAt?: Date;
}

/**
 * Claims that a figure is now better evidenced than it was.
 *
 * REFUSES ANYTHING THAT IS NOT A RANK INCREASE. That refusal is what makes the
 * word "upgrade" carry information: every `economic.estimate.upgraded` event in
 * the log is a point where the evidence genuinely improved, and the things that
 * must never upgrade a figure — a model's confidence, repetition, ranking,
 * arithmetic, portfolio selection, elapsed time, a human approving a
 * recommendation — cannot reach this function, because none of them is an
 * argument to it. The only way through is a reference to evidence that exists.
 */
export async function upgradeEstimate(input: UpgradeEstimateInput): Promise<UpgradeEstimateResult> {
  const { userId, opportunityId, figure } = input;

  // `userId` in the WHERE clause rather than checked after, following the same
  // tenant discipline as `resolveConnectionCredential()`. One user cannot see
  // the shape of another's estimates even by guessing an opportunity id.
  const existing = await db.opportunityEstimate.findFirst({
    where: { opportunityId, figure, userId },
  });
  if (!existing) {
    return {
      upgraded: false,
      reason: "NOT_RECORDED",
      detail: "This figure has no recorded estimate, so there is nothing to upgrade. Record it first.",
    };
  }

  if (!isValidBasisUpgrade(existing.basis, input.basis)) {
    return {
      upgraded: false,
      reason: "NOT_AN_UPGRADE",
      detail: `${describeBasis(input.basis)} is not stronger than ${describeBasis(existing.basis)}. Re-stating a figure at the same or a weaker basis is recordEstimate(), not an upgrade.`,
    };
  }

  const verified = await verifyEvidence(userId, input.basis, input.evidence);
  if (!verified.ok) return { upgraded: false, reason: verified.reason, detail: verified.detail };

  // The value is unchanged unless better evidence also corrected it.
  const currentValue = figureValueOf(figure, existing);
  const nextValue = input.value ?? currentValue;
  if (nextValue === null) {
    return {
      upgraded: false,
      reason: "INVALID_VALUE",
      detail: "The stored estimate holds no readable value for this figure, so it cannot be carried forward.",
    };
  }
  const value = figureValueColumns(figure, nextValue);
  if (!value.valid) {
    return { upgraded: false, reason: "INVALID_VALUE", detail: valueErrorDetail(figure, value.error) };
  }

  const estimate = await db.opportunityEstimate.update({
    where: { id: existing.id },
    data: {
      ...value.columns,
      basis: input.basis,
      previousBasis: existing.basis,
      provenance: input.provenance.trim(),
      establishedAt: input.establishedAt ?? new Date(),
      experimentId: input.evidence?.experimentId ?? null,
      measurementId: input.evidence?.measurementId ?? null,
      researchItemId: input.evidence?.researchItemId ?? null,
      comparableId: input.evidence?.comparableId ?? null,
    },
  });

  await recordEvent({
    userId,
    type: "economic.estimate.upgraded",
    subjectType: "Opportunity",
    subjectId: opportunityId,
    consequential: true,
    payload: {
      estimateId: estimate.id,
      figure,
      from: existing.basis,
      to: input.basis,
      valueChanged: input.value !== undefined && input.value !== currentValue,
      provenance: input.provenance.trim(),
      evidence: {
        experimentId: estimate.experimentId,
        measurementId: estimate.measurementId,
        researchItemId: estimate.researchItemId,
        comparableId: estimate.comparableId,
      },
      // The consequential part: this is where a figure becomes able to move money.
      becameCapitalEligible: !canInfluenceCapital(existing.basis) && canInfluenceCapital(input.basis),
      capitalMinimum: CAPITAL_MINIMUM_BASIS,
    },
  });

  return { upgraded: true, estimate, from: existing.basis, to: input.basis };
}

/** Every recorded figure for one opportunity, keyed by figure. */
export async function listEstimates(
  userId: string,
  opportunityId: string
): Promise<Partial<Record<EconomicFigure, OpportunityEstimate>>> {
  const rows = await db.opportunityEstimate.findMany({ where: { userId, opportunityId } });
  const byFigure: Partial<Record<EconomicFigure, OpportunityEstimate>> = {};
  for (const row of rows) byFigure[row.figure] = row;
  return byFigure;
}

/** The same, for many opportunities in one query — the list surface's path. */
export async function listEstimatesForOpportunities(
  userId: string,
  opportunityIds: readonly string[]
): Promise<Map<string, Partial<Record<EconomicFigure, OpportunityEstimate>>>> {
  const byOpportunity = new Map<string, Partial<Record<EconomicFigure, OpportunityEstimate>>>();
  if (opportunityIds.length === 0) return byOpportunity;

  const rows = await db.opportunityEstimate.findMany({
    where: { userId, opportunityId: { in: [...opportunityIds] } },
  });
  for (const row of rows) {
    const existing = byOpportunity.get(row.opportunityId) ?? {};
    existing[row.figure] = row;
    byOpportunity.set(row.opportunityId, existing);
  }
  return byOpportunity;
}

/** Removes a recorded figure. Used when a figure turns out not to apply at all. */
export async function deleteEstimate(
  userId: string,
  opportunityId: string,
  figure: EconomicFigure
): Promise<boolean> {
  const deleted = await db.opportunityEstimate.deleteMany({ where: { userId, opportunityId, figure } });
  if (deleted.count === 0) return false;
  await recordEvent({
    userId,
    type: "economic.estimate.removed",
    subjectType: "Opportunity",
    subjectId: opportunityId,
    consequential: true,
    payload: { figure, note: "The figure is now unknown. It is not zero." },
  });
  return true;
}
