/**
 * [P6-C] WHAT WOULD MAKE A DISCOVERED OPPORTUNITY FUNDABLE.
 *
 * Read-only, and that is the whole design. It grants nothing, upgrades nothing
 * and writes nothing: it reads `capitalBasisGate()`'s verdict and turns each
 * blocking figure into a sentence naming the figure and the evidence that would
 * clear it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS AS A SEPARATE SURFACE
 * ---------------------------------------------------------------------------
 *
 * Discovery produces opportunities whose every figure is `MODEL_SUGGESTED`, so
 * every one of them is blocked. That is correct and it is also, on its own,
 * useless: a list of twelve candidates all marked "not fundable" is a list
 * nobody can act on, and a refusal nobody can act on is a refusal that gets
 * overridden. The actionable form is per figure —
 *
 *     "Corroborate the expected profit and the worst-case loss."
 *
 * not
 *
 *     "Improve opportunity confidence."
 *
 * The second sentence is not a smaller version of the first; it is a different
 * kind of statement, and the kind that invites raising a number until it looks
 * better. `capitalBasisGate()` already names the figures; this module says what
 * each one needs.
 *
 * ---------------------------------------------------------------------------
 * AND WHAT IT DELIBERATELY DOES NOT OFFER
 * ---------------------------------------------------------------------------
 *
 * There is no `corroborate()` function here. Upgrading a figure goes through
 * `upgradeEstimate()` — the P6-B contract, which refuses anything that is not a
 * rank increase and demands the evidence that rank requires. A convenience
 * wrapper in the discovery layer would be a second door onto the same lock, and
 * the second door is where the bolt gets left off.
 */

import {
  CAPITAL_MINIMUM_BASIS,
  describeBasis,
  type EstimateBasis,
} from "@/lib/economic/estimate";
import { FIGURE_SPECS, requiredEvidenceFor, type CapitalBlockReason } from "@/lib/economic/figures";
import { listOpportunityModels } from "@/lib/economic/opportunityModel";
import { DISCOVERY_SOURCE } from "@/lib/discovery/service";
import type { EconomicFigure } from "@/generated/prisma/enums";
import type { Opportunity } from "@/generated/prisma/client";

export interface FigureCorroboration {
  figure: EconomicFigure;
  label: string;
  /** The basis the figure holds now. `NONE` when nothing establishes it. */
  basis: EstimateBasis;
  reason: CapitalBlockReason;
  /**
   * The weakest basis that would clear the capital gate for this figure.
   *
   * Always `CAPITAL_MINIMUM_BASIS` — read from the constant rather than named,
   * so moving the line moves this text with it.
   */
  minimumBasis: EstimateBasis;
  /** What the cheapest clearing basis requires as evidence. */
  requiredEvidence: ReturnType<typeof requiredEvidenceFor>;
  /** One sentence a person can act on. */
  whatWouldClearIt: string;
}

export interface OpportunityCorroboration {
  opportunityId: string;
  title: string;
  source: string | null;
  /** True when the opportunity came from an automated discovery pass. */
  discovered: boolean;
  status: Opportunity["status"];
  /** True when every ev-material figure already clears the capital minimum. */
  capitalEligible: boolean;
  blocking: FigureCorroboration[];
  /** Figures still read from the opportunity's own columns rather than an estimate. */
  compatibilityFigures: EconomicFigure[];
}

/**
 * The cheapest honest route from where a figure is to capital eligibility.
 *
 * `STATED` is the lowest clearing basis and it needs no evidence reference,
 * which sounds like a loophole and is not: it needs a PERSON to state the
 * figure from their own knowledge, which is a deliberate act with its own
 * audit trail. What it is not is something a model can do for itself, and that
 * is the only property that matters here.
 */
function whatWouldClearIt(figure: EconomicFigure, basis: EstimateBasis, reason: CapitalBlockReason): string {
  const label = FIGURE_SPECS[figure].label;
  if (reason === "ABSENT") {
    return `Nobody has established the ${label}. It is unknown, not zero — establish it, by stating it yourself or by measuring it.`;
  }
  return (
    `The ${label} rests on ${describeBasis(basis)}. ` +
    `It clears the capital minimum once somebody states it from their own knowledge, or it is derived from a comparable opportunity VOX has actually run, or VOX measures it directly. ` +
    `Proposing the same number again does not count, and neither does a second model agreeing.`
  );
}

/**
 * Every opportunity that cannot yet commit capital, and why — figure by figure.
 *
 * Reuses `listOpportunityModels()`, so the bases here are the SAME ones the
 * portfolio and the posture read. A second resolution path would be a second
 * answer to "is this fundable", and the two would diverge on the first edit.
 */
export async function corroborationPlan(
  userId: string,
  options: { discoveredOnly?: boolean; limit?: number } = {}
): Promise<OpportunityCorroboration[]> {
  const models = await listOpportunityModels(userId, { limit: options.limit ?? 100 });

  return models
    .filter((model) => (options.discoveredOnly ? model.source === DISCOVERY_SOURCE : true))
    .map((model) => ({
      opportunityId: model.opportunityId,
      title: model.title,
      source: model.source,
      discovered: model.source === DISCOVERY_SOURCE,
      status: model.status,
      capitalEligible: model.capital.eligible,
      blocking: model.capital.blocking.map((block) => ({
        figure: block.figure,
        label: FIGURE_SPECS[block.figure].label,
        basis: block.basis,
        reason: block.reason,
        minimumBasis: CAPITAL_MINIMUM_BASIS,
        requiredEvidence: requiredEvidenceFor(
          // The cheapest clearing basis, not the strongest — the question is
          // what would be ENOUGH, and answering with MEASURED would overstate
          // the cost of making this figure usable.
          CAPITAL_MINIMUM_BASIS === "NONE" ? "STATED" : CAPITAL_MINIMUM_BASIS
        ),
        whatWouldClearIt: whatWouldClearIt(block.figure, block.basis, block.reason),
      })),
      compatibilityFigures: [...model.compatibilityFigures],
    }));
}
