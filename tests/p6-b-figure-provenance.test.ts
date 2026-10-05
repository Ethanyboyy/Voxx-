/**
 * [P6-B] PER-FIGURE PROVENANCE — adversarial tests.
 *
 * P6-A asked whether a model's invented number could move money. It could not,
 * because every figure on an opportunity shared one basis and one weak figure
 * dragged the whole row down. That answer was right for the wrong reason, and
 * the wrong reason had two costs:
 *
 *   A PERSON COULD NOT FIX ONE FIGURE. Correcting a model's invented revenue
 *     changed nothing, because the basis came from the row's DISCOVERY source.
 *   A REFUSAL COULD NOT BE ACTED ON. "Its weakest monetary input is a model's
 *     proposal" never said which input, so the only way to respond was to
 *     re-derive the model by hand — or to override the refusal.
 *
 * So this phase asks the sharper questions:
 *
 *   Can one figure's basis be inferred from another's?
 *   Can a confident provenance STRING stand in for evidence?
 *   Can an invented evidence id confer a measured basis?
 *   Can repetition, ranking, arithmetic, selection or elapsed time upgrade a figure?
 *   Does an unknown figure still refuse to be a zero?
 *   Does a prediction made under one provenance stay frozen when it changes?
 */

import { describe, it, expect, beforeAll } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { db } from "@/lib/db";
import {
  CAPITAL_MINIMUM_BASIS,
  ESTIMATE_BASES,
  canInfluenceCapital,
  isValidBasisUpgrade,
  meetsMinimumBasis,
  weakerBasis,
  weakestBasis,
  known,
} from "@/lib/economic/estimate";
import {
  ECONOMIC_FIGURES,
  EV_MATERIAL_FIGURES,
  FIGURE_SPECS,
  capitalBasisGate,
  describeCapitalBlock,
  figureValueColumns,
  figureValueOf,
  requiredEvidenceFor,
} from "@/lib/economic/figures";
import {
  deleteEstimate,
  listEstimates,
  listEstimatesForOpportunities,
  recordEstimate,
  upgradeEstimate,
} from "@/lib/economic/provenance";
import {
  legacyColumnBasis,
  projectOpportunity,
  getOpportunityModel,
  type OpportunityModelView,
} from "@/lib/economic/opportunityModel";
import { expectedValueOf } from "@/lib/economic/expectedValue";
import { selectPortfolio } from "@/lib/economic/portfolio";
import { recordPrediction, getCalibration } from "@/lib/economic/calibration";
import { recordExternalMeasurement } from "@/lib/economic/evidence";
import { nextBestEconomicAction } from "@/lib/economic/nextAction";
import { createTestUser } from "./helpers";
import type { EconomicFigure, EvidenceBasis } from "@/generated/prisma/enums";
import type { Opportunity, OpportunityEstimate, User } from "@/generated/prisma/client";

let user: User;

beforeAll(async () => {
  user = await createTestUser();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A bare in-memory Opportunity row — every economic column null unless given. */
function opportunityRow(over: Partial<Opportunity> = {}): Opportunity {
  return {
    id: `opp-${Math.random().toString(36).slice(2)}`,
    userId: user.id,
    objectiveId: "obj",
    title: "An opportunity",
    description: null,
    estimatedValue: null,
    effort: null,
    confidence: "LOW",
    risk: null,
    nextAction: null,
    evidence: null,
    status: "IDEA",
    projectId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    category: null,
    source: null,
    discoveredAt: new Date(),
    estimatedStartupCost: null,
    estimatedOperatingCost: null,
    estimatedMargin: null,
    estimatedTimeToRevenueDays: null,
    complexity: null,
    competition: null,
    scalability: null,
    requiredHumanInvolvement: null,
    requiredCapabilities: null,
    dependencies: null,
    rationale: null,
    scoreSnapshot: null,
    scoreBreakdown: null,
    discoveredByAgentId: null,
    strategyId: null,
    participatingAgentIds: "[]",
    requiredCapitalCents: null,
    expectedRevenueCents: null,
    expectedProfitCents: null,
    probabilityOfSuccess: null,
    maxLossCents: null,
    downside: null,
    timeToPayoutDays: null,
    requiredTools: null,
    policyStatus: null,
    correlationId: null,
    ...over,
  } as Opportunity;
}

/** An in-memory `OpportunityEstimate`, so the table can be tested by enumeration. */
function estimateRow(
  figure: EconomicFigure,
  value: number,
  basis: EvidenceBasis,
  over: Partial<OpportunityEstimate> = {}
): OpportunityEstimate {
  const columns = figureValueColumns(figure, value);
  if (!columns.valid) throw new Error(`fixture value invalid for ${figure}: ${columns.error}`);
  return {
    id: `est-${Math.random().toString(36).slice(2)}`,
    userId: user.id,
    opportunityId: "opp",
    figure,
    ...columns.columns,
    basis,
    provenance: `fixture: ${basis}`,
    establishedAt: new Date("2026-01-01T00:00:00Z"),
    experimentId: null,
    measurementId: null,
    researchItemId: null,
    comparableId: null,
    previousBasis: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as OpportunityEstimate;
}

/** Every figure recorded at one basis — the baseline each test perturbs. */
const BASELINE: Readonly<Record<EconomicFigure, number>> = Object.freeze({
  REQUIRED_CAPITAL_CENTS: 20_000,
  EXPECTED_REVENUE_CENTS: 400_000,
  EXPECTED_PROFIT_CENTS: 100_000,
  MAX_LOSS_CENTS: 20_000,
  PROBABILITY_OF_SUCCESS: 0.5,
  MARGIN_FRACTION: 0.25,
  TIME_TO_PAYOUT_DAYS: 30,
});

function allFiguresAt(
  basis: EvidenceBasis,
  over: Partial<Record<EconomicFigure, EvidenceBasis>> = {}
): Partial<Record<EconomicFigure, OpportunityEstimate>> {
  const out: Partial<Record<EconomicFigure, OpportunityEstimate>> = {};
  for (const figure of ECONOMIC_FIGURES) {
    out[figure] = estimateRow(figure, BASELINE[figure], over[figure] ?? basis);
  }
  return out;
}

function projected(
  estimates: Partial<Record<EconomicFigure, OpportunityEstimate>>,
  row: Partial<Opportunity> = {}
): OpportunityModelView {
  return projectOpportunity(opportunityRow(row), null, estimates);
}

async function seedOpportunity(owner: User, over: Record<string, unknown> = {}) {
  const objective = await db.objective.create({ data: { userId: owner.id, title: "Earn" } });
  return db.opportunity.create({
    data: { userId: owner.id, objectiveId: objective.id, title: "Test opportunity", ...over },
  });
}

/**
 * A real `ExperimentMeasurement`, so a MEASURED basis can name real evidence.
 *
 * Created through P5-D's own `recordExternalMeasurement()` rather than written
 * straight to the table, so the evidence these tests cite is evidence the
 * existing loop would actually have produced.
 */
async function seedMeasurement(owner: User) {
  const asset = await db.economicAsset.create({
    data: { userId: owner.id, name: "Asset", category: "OTHER" },
  });
  const experiment = await db.experiment.create({
    data: { userId: owner.id, economicAssetId: asset.id, hypothesis: "It converts" },
  });
  const result = await recordExternalMeasurement({
    userId: owner.id,
    experimentId: experiment.id,
    observedValue: 4,
    observedTotal: 10,
    unit: "orders",
    provenance: "Counted by hand in the store dashboard",
  });
  if (!result.recorded) throw new Error(`fixture measurement failed: ${result.reason}`);
  return { experiment, measurement: result.measurement };
}

// ---------------------------------------------------------------------------
// 1. The ranking, and where the capital line sits on it
// ---------------------------------------------------------------------------

describe("the basis ranking", () => {
  it("RANKS NONE < MODEL_SUGGESTED < STATED < COMPARABLE < MEASURED", () => {
    // The ordering the brief requires, asserted as a chain rather than as five
    // separate facts, so a single swapped pair fails.
    expect(ESTIMATE_BASES).toEqual(["NONE", "MODEL_SUGGESTED", "STATED", "COMPARABLE", "MEASURED"]);
    for (let i = 0; i < ESTIMATE_BASES.length - 1; i += 1) {
      const weaker = ESTIMATE_BASES[i];
      const stronger = ESTIMATE_BASES[i + 1];
      expect(weakerBasis(weaker, stronger), `${weaker} < ${stronger}`).toBe(weaker);
      expect(isValidBasisUpgrade(weaker, stronger), `${weaker} -> ${stronger}`).toBe(true);
      expect(isValidBasisUpgrade(stronger, weaker), `${stronger} -> ${weaker}`).toBe(false);
    }
  });

  it("DRAWS THE CAPITAL LINE IMMEDIATELY ABOVE A MODEL'S PROPOSAL", () => {
    // The membership of both sets is the invariant — not the name of the rank
    // the constant happens to hold. P6-A asserted exactly these five facts with
    // `CAPITAL_MINIMUM_BASIS === "COMPARABLE"`; the ranks moved underneath and
    // the answers did not.
    expect(canInfluenceCapital("NONE")).toBe(false);
    expect(canInfluenceCapital("MODEL_SUGGESTED")).toBe(false);
    expect(canInfluenceCapital("STATED")).toBe(true);
    expect(canInfluenceCapital("COMPARABLE")).toBe(true);
    expect(canInfluenceCapital("MEASURED")).toBe(true);
    expect(meetsMinimumBasis(CAPITAL_MINIMUM_BASIS, CAPITAL_MINIMUM_BASIS)).toBe(true);
  });

  it("never treats `NONE` as something a figure can be recorded at", () => {
    expect(isValidBasisUpgrade("NONE", "NONE")).toBe(false);
    expect(isValidBasisUpgrade("MODEL_SUGGESTED", "NONE")).toBe(false);
    expect(isValidBasisUpgrade("MEASURED", "NONE")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. The figure registry
// ---------------------------------------------------------------------------

describe("the closed figure registry", () => {
  it("validates a value against its figure's own kind", () => {
    // Money and days must be whole; a ratio must be 0-1. Every rejection here
    // is a plausible wrong number that would otherwise be stored.
    expect(figureValueColumns("REQUIRED_CAPITAL_CENTS", 12.5).valid).toBe(false);
    expect(figureValueColumns("REQUIRED_CAPITAL_CENTS", -1).valid).toBe(false);
    expect(figureValueColumns("PROBABILITY_OF_SUCCESS", 1.4).valid).toBe(false);
    expect(figureValueColumns("PROBABILITY_OF_SUCCESS", -0.1).valid).toBe(false);
    expect(figureValueColumns("TIME_TO_PAYOUT_DAYS", 0).valid).toBe(false);
    expect(figureValueColumns("TIME_TO_PAYOUT_DAYS", 1.5).valid).toBe(false);
    expect(figureValueColumns("MAX_LOSS_CENTS", Number.NaN).valid).toBe(false);
    expect(figureValueColumns("MAX_LOSS_CENTS", Number.POSITIVE_INFINITY).valid).toBe(false);

    expect(figureValueColumns("MAX_LOSS_CENTS", 0).valid).toBe(true);
    expect(figureValueColumns("PROBABILITY_OF_SUCCESS", 0).valid).toBe(true);
    expect(figureValueColumns("PROBABILITY_OF_SUCCESS", 1).valid).toBe(true);
  });

  it("writes exactly one value column per figure", () => {
    for (const figure of ECONOMIC_FIGURES) {
      const result = figureValueColumns(figure, BASELINE[figure]);
      expect(result.valid, figure).toBe(true);
      if (!result.valid) continue;
      const set = Object.values(result.columns).filter((v) => v !== null);
      expect(set.length, figure).toBe(1);
      expect(figureValueOf(figure, result.columns), figure).toBe(BASELINE[figure]);
    }
  });

  it("READS NULL FROM A MALFORMED ROW RATHER THAN THE WRONG COLUMN", () => {
    // A row edited directly in the database. Reading `valueCents` for a RATIO
    // figure would turn a probability of 0.5 into fifty million percent.
    expect(figureValueOf("PROBABILITY_OF_SUCCESS", { valueCents: 50, valueRatio: null, valueDays: null })).toBeNull();
    expect(figureValueOf("REQUIRED_CAPITAL_CENTS", { valueCents: null, valueRatio: 0.5, valueDays: null })).toBeNull();
  });

  it("requires evidence for exactly the two bases that claim it", () => {
    expect(requiredEvidenceFor("MEASURED")).toBe("MEASUREMENT_OR_EXPERIMENT");
    expect(requiredEvidenceFor("COMPARABLE")).toBe("COMPARABLE_OPPORTUNITY");
    // A person's own knowledge and a model's proposal are exactly what they say
    // they are, and neither can commit capital on its own anyway.
    expect(requiredEvidenceFor("STATED")).toBe("NONE");
    expect(requiredEvidenceFor("MODEL_SUGGESTED")).toBe("NONE");
  });
});

// ---------------------------------------------------------------------------
// 3. INVARIANT: one figure's basis is never inferred from another's
// ---------------------------------------------------------------------------

describe("provenance is a property of the number, not of the row", () => {
  it("A MEASURED PROBABILITY DOES NOT MAKE AN INVENTED PROFIT MEASURED", () => {
    // The single most important test in the phase. Under P6-A this state was
    // unrepresentable: both figures read the same column, so "the probability
    // is measured but the profit is a guess" could not be said at all.
    const model = projected(
      allFiguresAt("MODEL_SUGGESTED", { PROBABILITY_OF_SUCCESS: "MEASURED" })
    );
    expect(model.figures.PROBABILITY_OF_SUCCESS.basis).toBe("MEASURED");
    expect(model.figures.EXPECTED_PROFIT_CENTS.basis).toBe("MODEL_SUGGESTED");
    expect(model.figures.MAX_LOSS_CENTS.basis).toBe("MODEL_SUGGESTED");
    expect(model.capital.eligible).toBe(false);
  });

  it("holds for EVERY figure in turn, by enumeration", () => {
    // Not one case — the whole table. Lifting any single figure to MEASURED
    // must leave the other six exactly where they were.
    for (const lifted of ECONOMIC_FIGURES) {
      const model = projected(allFiguresAt("MODEL_SUGGESTED", { [lifted]: "MEASURED" }));
      for (const other of ECONOMIC_FIGURES) {
        expect(model.figures[other].basis, `${lifted} lifted, ${other} read`).toBe(
          other === lifted ? "MEASURED" : "MODEL_SUGGESTED"
        );
      }
    }
  });

  it("answers all six questions for each figure independently", () => {
    const { ...estimates } = allFiguresAt("STATED");
    const model = projected(estimates);
    for (const figure of ECONOMIC_FIGURES) {
      const p = model.figures[figure];
      expect(p.figure, figure).toBe(figure);               // what it is
      expect(p.value, figure).toBe(BASELINE[figure]);      // what it is worth
      expect(p.basis, figure).toBe("STATED");              // how well evidenced
      expect(p.provenance.length, figure).toBeGreaterThan(0); // where it came from
      expect(p.establishedAt, figure).toBeInstanceOf(Date);   // when
      expect(p.evidence, figure).not.toBeNull();              // what supports it
      expect(p.source, figure).toBe("ESTIMATE");
      expect(p.authoritative, figure).toBe(true);
    }
  });

  it("A SINGLE WEAK FIGURE BLOCKS CAPITAL EVEN WHEN SIX ARE MEASURED", () => {
    for (const weakened of EV_MATERIAL_FIGURES) {
      const model = projected(allFiguresAt("MEASURED", { [weakened]: "MODEL_SUGGESTED" }));
      expect(model.capital.eligible, weakened).toBe(false);
      expect(model.capital.blocking.map((b) => b.figure), weakened).toEqual([weakened]);
      expect(model.capital.blocking[0].reason, weakened).toBe("TOO_WEAK");
    }
  });

  it("a figure that is not ev-material cannot block capital", () => {
    // Revenue and margin matter only as inputs to a derived profit, and a
    // recorded profit makes them irrelevant to the expectation. Blocking on
    // them would refuse a measured profit because an unrelated figure was a
    // guess, which is the row-level thinking this phase removed.
    const model = projected(
      allFiguresAt("MEASURED", { EXPECTED_REVENUE_CENTS: "MODEL_SUGGESTED", MARGIN_FRACTION: "MODEL_SUGGESTED" })
    );
    expect(model.capital.eligible).toBe(true);
  });

  it("names the blocking figure rather than reporting one rolled-up basis", () => {
    const model = projected(allFiguresAt("STATED", { MAX_LOSS_CENTS: "MODEL_SUGGESTED" }));
    expect(model.capital.blocking).toHaveLength(1);
    expect(describeCapitalBlock(model.capital.blocking[0])).toMatch(/worst-case loss/i);
    expect(describeCapitalBlock(model.capital.blocking[0])).toMatch(/model/i);
  });
});

// ---------------------------------------------------------------------------
// 4. INVARIANT: an unknown figure is not a zero
// ---------------------------------------------------------------------------

describe("an absent figure stays absent", () => {
  it("AN UNKNOWN CAPITAL REQUIREMENT IS NOT A ZERO ONE", () => {
    const estimates = allFiguresAt("MEASURED");
    delete estimates.REQUIRED_CAPITAL_CENTS;
    const model = projected(estimates);

    expect(model.figures.REQUIRED_CAPITAL_CENTS.basis).toBe("NONE");
    expect(model.figures.REQUIRED_CAPITAL_CENTS.value).toBeNull();
    expect(model.capital.eligible).toBe(false);
    expect(model.capital.blocking[0]).toMatchObject({
      figure: "REQUIRED_CAPITAL_CENTS",
      reason: "ABSENT",
    });

    // And it reaches the portfolio as a refusal, not as a free opportunity.
    const plan = selectPortfolio({
      expectations: [expectedValueOf(model)],
      deployableCents: 1_000_000,
      activeExperiments: 0,
      halted: false,
    });
    expect(plan.selected).toHaveLength(0);
    expect(plan.deferred[0].reason).toBe("BASIS_TOO_WEAK");
    expect(plan.deferred[0].blockingFigures[0].figure).toBe("REQUIRED_CAPITAL_CENTS");
    expect(plan.proposedTotalCents).toBe(0);
  });

  it("A GENUINE ZERO IS STILL A REAL ANSWER", () => {
    // The distinction P5-E drew for observations, holding for estimates: zero
    // recorded capital means "needs no money", and it is fundable.
    const estimates = allFiguresAt("STATED");
    estimates.REQUIRED_CAPITAL_CENTS = estimateRow("REQUIRED_CAPITAL_CENTS", 0, "STATED");
    const model = projected(estimates);
    expect(model.figures.REQUIRED_CAPITAL_CENTS.value).toBe(0);
    expect(model.capital.eligible).toBe(true);

    const plan = selectPortfolio({
      expectations: [expectedValueOf(model)],
      deployableCents: 1_000_000,
      activeExperiments: 0,
      halted: false,
    });
    expect(plan.selected).toHaveLength(1);
    expect(plan.selected[0].proposedCapitalCents).toBe(0);
  });

  it("an absent probability, profit or worst case makes it UNRANKABLE, not cheap", () => {
    for (const figure of ["PROBABILITY_OF_SUCCESS", "EXPECTED_PROFIT_CENTS", "MAX_LOSS_CENTS"] as const) {
      const estimates = allFiguresAt("MEASURED");
      delete estimates[figure];
      // Revenue × margin would derive a profit, so remove them too for the
      // profit case: the point is the refusal, not the derivation.
      if (figure === "EXPECTED_PROFIT_CENTS") {
        delete estimates.EXPECTED_REVENUE_CENTS;
        delete estimates.MARGIN_FRACTION;
      }
      const expectation = expectedValueOf(projected(estimates));
      expect(expectation.rankable, figure).toBe(false);
      // The unrankable arm has NO sortable field, so it cannot be ordered
      // against a researched opportunity.
      expect("expectedNetCents" in expectation, figure).toBe(false);
    }
  });

  it("ONLY THE HORIZON MAY BE ABSENT WITHOUT BLOCKING, AND ONLY BECAUSE ITS DEFAULT UNDERSTATES", () => {
    // The one asymmetry in the gate. An unestablished horizon falls back to the
    // LONGEST horizon considered, which makes the per-day rate smaller — so its
    // absence cannot flatter the expectation.
    const estimates = allFiguresAt("STATED");
    delete estimates.TIME_TO_PAYOUT_DAYS;
    const model = projected(estimates);
    expect(model.figures.TIME_TO_PAYOUT_DAYS.basis).toBe("NONE");
    expect(model.capital.eligible).toBe(true);

    // But a horizon that is PRESENT on a weak basis still blocks: a
    // model-suggested "7 days" where the truth is a year inflates the rate 52×.
    const weak = projected(allFiguresAt("STATED", { TIME_TO_PAYOUT_DAYS: "MODEL_SUGGESTED" }));
    expect(weak.capital.eligible).toBe(false);
    expect(weak.capital.blocking[0].figure).toBe("TIME_TO_PAYOUT_DAYS");

    // And exactly one figure in the registry carries that exemption.
    expect(ECONOMIC_FIGURES.filter((f) => FIGURE_SPECS[f].absenceIsConservative)).toEqual([
      "TIME_TO_PAYOUT_DAYS",
    ]);
  });

  it("the gate treats a figure missing from its input as absent, not as fine", () => {
    // A caller that forgets to pass a reading must not get a pass for it.
    expect(capitalBasisGate([]).eligible).toBe(false);
    expect(capitalBasisGate([]).blocking.map((b) => b.figure)).toEqual(
      EV_MATERIAL_FIGURES.filter((f) => !FIGURE_SPECS[f].absenceIsConservative)
    );
  });
});

// ---------------------------------------------------------------------------
// 5. INVARIANT: the legacy column path is not provenance
// ---------------------------------------------------------------------------

describe("the compatibility path over the old columns", () => {
  it("CAN NEVER CLAIM THE TWO STRONGEST BASES", () => {
    // The ceiling is the real protection. A value in a column has no evidence
    // reference attached, so there is nothing to check, so it cannot be
    // COMPARABLE or MEASURED however it got there.
    const sources = [null, "", "   ", "user", "human", "owner", "manual", "vox.research", "agent:scout", "unknown"];
    for (const source of sources) {
      const basis = legacyColumnBasis(source);
      expect(["STATED", "MODEL_SUGGESTED"], String(source)).toContain(basis);
      expect(isValidBasisUpgrade(basis, "COMPARABLE"), String(source)).toBe(true);
    }
  });

  it("stays conservative for a row VOX discovered itself", () => {
    expect(legacyColumnBasis("vox.research")).toBe("MODEL_SUGGESTED");
    expect(legacyColumnBasis("user")).toBe("STATED");
    // No source at all reads as human: the pre-P4-F rows and everything created
    // through the UI legitimately have none.
    expect(legacyColumnBasis(null)).toBe("STATED");
  });

  it("marks every legacy-read figure as NON-AUTHORITATIVE", () => {
    const model = projectOpportunity(
      opportunityRow({
        source: "user",
        requiredCapitalCents: 20_000,
        expectedProfitCents: 100_000,
        probabilityOfSuccess: 0.5,
        maxLossCents: 20_000,
        timeToPayoutDays: 30,
      }),
      null
    );
    for (const figure of ["REQUIRED_CAPITAL_CENTS", "EXPECTED_PROFIT_CENTS", "MAX_LOSS_CENTS"] as const) {
      expect(model.figures[figure].source, figure).toBe("LEGACY_COLUMN");
      expect(model.figures[figure].authoritative, figure).toBe(false);
      // No `establishedAt`, and that null is informative: the old columns carry
      // no record of when anybody decided the number.
      expect(model.figures[figure].establishedAt, figure).toBeNull();
      expect(model.figures[figure].evidence, figure).toBeNull();
    }
    expect(model.compatibilityFigures.length).toBeGreaterThan(0);
    // Still USABLE — refusing to read the old columns would make every
    // pre-P6-B opportunity unfundable overnight.
    expect(model.capital.eligible).toBe(true);
  });

  it("A RECORDED ESTIMATE OVERRIDES THE COLUMN HEURISTIC IN BOTH DIRECTIONS", () => {
    // Downward: a deliberate MODEL_SUGGESTED recording on a human-sourced row
    // must not be promoted back to STATED by the discovery source. That
    // promotion would be laundering, and the P6-A heuristic had no way to
    // prevent it because the row was the only thing it could read.
    const down = projectOpportunity(
      opportunityRow({ source: "user", maxLossCents: 20_000 }),
      null,
      { MAX_LOSS_CENTS: estimateRow("MAX_LOSS_CENTS", 20_000, "MODEL_SUGGESTED") }
    );
    expect(down.figures.MAX_LOSS_CENTS.basis).toBe("MODEL_SUGGESTED");
    expect(down.figures.MAX_LOSS_CENTS.source).toBe("ESTIMATE");

    // Upward: a person correcting a figure on a row VOX discovered now COUNTS.
    // Under P6-A it could not, because the row's discovery source had not
    // changed — which is the bug that made the whole heuristic untenable.
    const up = projectOpportunity(
      opportunityRow({ source: "vox.research", maxLossCents: 20_000 }),
      null,
      { MAX_LOSS_CENTS: estimateRow("MAX_LOSS_CENTS", 18_000, "STATED") }
    );
    expect(up.figures.MAX_LOSS_CENTS.basis).toBe("STATED");
    expect(up.figures.MAX_LOSS_CENTS.value).toBe(18_000);
    expect(up.figures.MAX_LOSS_CENTS.capitalEligible).toBe(true);
  });

  it("A MALFORMED ESTIMATE ROW READS AS UNKNOWN, NOT AS THE LEGACY COLUMN", () => {
    // Falling back would answer with a different number than the one on record.
    // An unknown figure refuses capital; a substituted one spends it.
    const malformed = estimateRow("MAX_LOSS_CENTS", 20_000, "MEASURED");
    const broken = { ...malformed, valueCents: null } as OpportunityEstimate;
    const model = projectOpportunity(
      opportunityRow({ source: "user", maxLossCents: 99_999 }),
      null,
      { MAX_LOSS_CENTS: broken }
    );
    expect(model.figures.MAX_LOSS_CENTS.value).toBeNull();
    expect(model.figures.MAX_LOSS_CENTS.basis).toBe("NONE");
    expect(model.figures.MAX_LOSS_CENTS.why).toMatch(/wrong column/i);
  });

  it("no longer exports the P6-A heuristic under its old authoritative name", () => {
    // `statedBasisFor()` was THE source of provenance. It is now
    // `legacyColumnBasis()`, consulted last and capped, and the rename is the
    // clearest possible marking of that: nothing can call the old name.
    const source = readFileSync("src/lib/economic/opportunityModel.ts", "utf8");
    expect(source).not.toMatch(/export function statedBasisFor/);
    expect(source).toMatch(/export function legacyColumnBasis/);
    // And the replacement path is named where the old one lived.
    expect(source).toMatch(/recordEstimate\(\)/);
  });
});

// ---------------------------------------------------------------------------
// 6. INVARIANT: only evidence upgrades a figure
// ---------------------------------------------------------------------------

describe("what may and may not upgrade a figure", () => {
  it("REFUSES A MEASURED CLAIM THAT NAMES NO MEASUREMENT", async () => {
    // Without this, the strongest basis in the system would be the easiest one
    // to assert: you would write "measured from the store" in the provenance.
    const opportunity = await seedOpportunity(user);
    const result = await recordEstimate({
      userId: user.id,
      opportunityId: opportunity.id,
      figure: "MAX_LOSS_CENTS",
      value: 20_000,
      basis: "MEASURED",
      provenance: "measured from the store, honestly",
    });
    expect(result.recorded).toBe(false);
    expect(result.recorded === false && result.reason).toBe("EVIDENCE_REQUIRED");
    expect(result.recorded === false && result.detail).toMatch(/easiest one to assert/i);
  });

  it("REFUSES AN INVENTED EVIDENCE IDENTIFIER", async () => {
    const opportunity = await seedOpportunity(user);
    const result = await recordEstimate({
      userId: user.id,
      opportunityId: opportunity.id,
      figure: "MAX_LOSS_CENTS",
      value: 20_000,
      basis: "MEASURED",
      provenance: "measured",
      evidence: { measurementId: "measurement-that-does-not-exist" },
    });
    expect(result.recorded).toBe(false);
    expect(result.recorded === false && result.reason).toBe("EVIDENCE_NOT_FOUND");
  });

  it("REFUSES ANOTHER USER'S EVIDENCE", async () => {
    // The tenant boundary. Evidence that exists is not evidence you may cite.
    const other = await createTestUser();
    const { measurement } = await seedMeasurement(other);
    const opportunity = await seedOpportunity(user);
    const result = await recordEstimate({
      userId: user.id,
      opportunityId: opportunity.id,
      figure: "MAX_LOSS_CENTS",
      value: 20_000,
      basis: "MEASURED",
      provenance: "measured",
      evidence: { measurementId: measurement.id },
    });
    expect(result.recorded).toBe(false);
    expect(result.recorded === false && result.reason).toBe("EVIDENCE_NOT_FOUND");
  });

  it("refuses a COMPARABLE claim that names no comparable", async () => {
    const opportunity = await seedOpportunity(user);
    const result = await recordEstimate({
      userId: user.id,
      opportunityId: opportunity.id,
      figure: "PROBABILITY_OF_SUCCESS",
      value: 0.4,
      basis: "COMPARABLE",
      provenance: "like the other one",
    });
    expect(result.recorded).toBe(false);
    expect(result.recorded === false && result.reason).toBe("EVIDENCE_REQUIRED");
  });

  it("ACCEPTS A MEASURED CLAIM THAT NAMES REAL EVIDENCE", async () => {
    const owner = await createTestUser();
    const { measurement } = await seedMeasurement(owner);
    const opportunity = await seedOpportunity(owner);
    const result = await recordEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "MAX_LOSS_CENTS",
      value: 20_000,
      basis: "MEASURED",
      provenance: "observed in the store over the declared window",
      evidence: { measurementId: measurement.id },
    });
    expect(result.recorded).toBe(true);
    if (!result.recorded) return;
    expect(result.estimate.measurementId).toBe(measurement.id);
    expect(result.capitalEligible).toBe(true);
  });

  it("refuses a figure with no stated source at all", async () => {
    const opportunity = await seedOpportunity(user);
    const result = await recordEstimate({
      userId: user.id,
      opportunityId: opportunity.id,
      figure: "MAX_LOSS_CENTS",
      value: 20_000,
      basis: "STATED",
      provenance: "   ",
    });
    expect(result.recorded).toBe(false);
    expect(result.recorded === false && result.detail).toMatch(/rumour/i);
  });

  it("REFUSES AN UPGRADE THAT IS NOT ONE", async () => {
    const owner = await createTestUser();
    const opportunity = await seedOpportunity(owner);
    await recordEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "MAX_LOSS_CENTS",
      value: 20_000,
      basis: "STATED",
      provenance: "I know this market",
    });

    // Same basis: ordinary re-statement, not an improvement in evidence.
    const same = await upgradeEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "MAX_LOSS_CENTS",
      basis: "STATED",
      provenance: "I still know this market",
    });
    expect(same.upgraded).toBe(false);
    expect(same.upgraded === false && same.reason).toBe("NOT_AN_UPGRADE");

    // Weaker basis: also not an upgrade.
    const weaker = await upgradeEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "MAX_LOSS_CENTS",
      basis: "MODEL_SUGGESTED",
      provenance: "a model thinks so",
    });
    expect(weaker.upgraded).toBe(false);
    expect(weaker.upgraded === false && weaker.reason).toBe("NOT_AN_UPGRADE");
  });

  it("records the previous basis when the evidence genuinely improves", async () => {
    const owner = await createTestUser();
    const { measurement } = await seedMeasurement(owner);
    const opportunity = await seedOpportunity(owner);
    await recordEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "PROBABILITY_OF_SUCCESS",
      value: 0.6,
      basis: "MODEL_SUGGESTED",
      provenance: "a model proposed 60%",
    });
    const up = await upgradeEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "PROBABILITY_OF_SUCCESS",
      basis: "MEASURED",
      provenance: "four reconciled verdicts",
      evidence: { measurementId: measurement.id },
      value: 0.25,
    });
    expect(up.upgraded).toBe(true);
    if (!up.upgraded) return;
    expect(up.from).toBe("MODEL_SUGGESTED");
    expect(up.to).toBe("MEASURED");
    expect(up.estimate.previousBasis).toBe("MODEL_SUGGESTED");
    expect(up.estimate.valueRatio).toBe(0.25);
  });

  it("REPETITION DOES NOT UPGRADE ANYTHING", async () => {
    // The same figure proposed ten times is one unsupported figure proposed ten
    // times. There is no counter, so there is nothing to increment.
    const owner = await createTestUser();
    const opportunity = await seedOpportunity(owner);
    for (let i = 0; i < 10; i += 1) {
      await recordEstimate({
        userId: owner.id,
        opportunityId: opportunity.id,
        figure: "EXPECTED_PROFIT_CENTS",
        value: 500_000,
        basis: "MODEL_SUGGESTED",
        provenance: `a model proposed it again (${i})`,
      });
    }
    const estimates = await listEstimates(owner.id, opportunity.id);
    expect(estimates.EXPECTED_PROFIT_CENTS!.basis).toBe("MODEL_SUGGESTED");
    // And one row, not ten: the unique constraint means a figure has one
    // current provenance, not an accumulating pile of assertions.
    expect(await db.opportunityEstimate.count({ where: { opportunityId: opportunity.id } })).toBe(1);
  });

  it("ARITHMETIC DOES NOT UPGRADE ANYTHING", () => {
    // A derived profit takes its WEAKEST input's basis. Multiplication does not
    // create knowledge, and averaging the two ranks would let a measured
    // revenue launder an invented margin.
    const model = projected(
      {
        EXPECTED_REVENUE_CENTS: estimateRow("EXPECTED_REVENUE_CENTS", 400_000, "MEASURED"),
        MARGIN_FRACTION: estimateRow("MARGIN_FRACTION", 0.25, "MODEL_SUGGESTED"),
      }
    );
    expect(model.figures.EXPECTED_PROFIT_CENTS.value).toBe(100_000);
    expect(model.figures.EXPECTED_PROFIT_CENTS.basis).toBe("MODEL_SUGGESTED");
    expect(model.figures.EXPECTED_PROFIT_CENTS.source).toBe("DERIVED");
    expect(weakestBasis([known(1, "MEASURED", "a"), known(2, "MODEL_SUGGESTED", "b")])).toBe("MODEL_SUGGESTED");
  });

  it("a derivation is only as authoritative as its inputs", () => {
    const fromColumns = projectOpportunity(
      opportunityRow({ source: "user", expectedRevenueCents: 400_000, estimatedMargin: 0.25 }),
      null
    );
    expect(fromColumns.figures.EXPECTED_PROFIT_CENTS.source).toBe("DERIVED");
    expect(fromColumns.figures.EXPECTED_PROFIT_CENTS.authoritative).toBe(false);

    const fromEstimates = projected({
      EXPECTED_REVENUE_CENTS: estimateRow("EXPECTED_REVENUE_CENTS", 400_000, "MEASURED"),
      MARGIN_FRACTION: estimateRow("MARGIN_FRACTION", 0.25, "MEASURED"),
    });
    expect(fromEstimates.figures.EXPECTED_PROFIT_CENTS.authoritative).toBe(true);
    expect(fromEstimates.figures.EXPECTED_PROFIT_CENTS.basis).toBe("MEASURED");
  });

  it("RANKING AND SELECTION DO NOT UPGRADE ANYTHING", async () => {
    // Coming first in a list is a consequence of the number, not evidence for
    // it, and being selected is downstream of the figure entirely.
    const owner = await createTestUser();
    const opportunity = await seedOpportunity(owner, { status: "ACTIVE" });
    for (const [figure, value] of Object.entries(BASELINE)) {
      await recordEstimate({
        userId: owner.id,
        opportunityId: opportunity.id,
        figure: figure as EconomicFigure,
        value,
        basis: "STATED",
        provenance: "stated by the owner",
      });
    }
    await db.user.update({ where: { id: owner.id }, data: { maxAutonomousSpendUsd: 10_000 } });

    const before = await listEstimates(owner.id, opportunity.id);
    const posture = await nextBestEconomicAction(owner.id);
    expect(posture.plan.selected.length).toBeGreaterThan(0);
    const after = await listEstimates(owner.id, opportunity.id);

    for (const figure of ECONOMIC_FIGURES) {
      expect(after[figure]!.basis, figure).toBe(before[figure]!.basis);
      expect(after[figure]!.updatedAt.getTime(), figure).toBe(before[figure]!.updatedAt.getTime());
    }
  });

  it("TIME DOES NOT UPGRADE ANYTHING", () => {
    // An old estimate is an old estimate. Nothing matures into a fact.
    const ancient = estimateRow("MAX_LOSS_CENTS", 20_000, "MODEL_SUGGESTED", {
      establishedAt: new Date("2019-01-01T00:00:00Z"),
    });
    const model = projected({ ...allFiguresAt("STATED"), MAX_LOSS_CENTS: ancient });
    expect(model.figures.MAX_LOSS_CENTS.basis).toBe("MODEL_SUGGESTED");
    expect(model.capital.eligible).toBe(false);
  });

  it("takes no argument by which confidence could upgrade a figure", () => {
    // The structural version of the rule: none of the things that must never
    // upgrade a figure is an input to the module that upgrades figures.
    const source = readFileSync("src/lib/economic/provenance.ts", "utf8");
    for (const forbidden of ["confidence", "certainty", "score", "repetition", "approvalCount"]) {
      expect(source.includes(`${forbidden}:`), forbidden).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. INVARIANT: recording provenance authorizes nothing
// ---------------------------------------------------------------------------

describe("provenance is not authorization", () => {
  it("IMPORTS NO PERMISSION, GRANT OR ALLOCATION SYMBOL", () => {
    // Same scan shape as the P5-G and P6-A guards: a symbol that is never
    // imported cannot be called. Recording what a number rests on must not be
    // able to mint the authority to spend it.
    const imports = importedSymbols(readFileSync("src/lib/economic/provenance.ts", "utf8"));
    for (const forbidden of [
      "grantPermission",
      "createApprovalGrant",
      "consumeApprovalGrant",
      "enforceCapability",
      "approveCapitalAllocation",
      "requestCapital",
      "recordSpend",
      "executeRun",
    ]) {
      expect(imports, forbidden).not.toContain(forbidden);
    }
  });

  it("writes a consequential Event for every recording and upgrade", async () => {
    const owner = await createTestUser();
    const { measurement } = await seedMeasurement(owner);
    const opportunity = await seedOpportunity(owner);
    await recordEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "MAX_LOSS_CENTS",
      value: 20_000,
      basis: "MODEL_SUGGESTED",
      provenance: "a model proposed it",
    });
    await upgradeEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "MAX_LOSS_CENTS",
      basis: "MEASURED",
      provenance: "observed",
      evidence: { measurementId: measurement.id },
    });

    const events = await db.event.findMany({
      where: { userId: owner.id, type: { startsWith: "economic.estimate." } },
      orderBy: { createdAt: "asc" },
    });
    expect(events.map((e) => e.type)).toEqual([
      "economic.estimate.recorded",
      "economic.estimate.upgraded",
    ]);
    expect(events.every((e) => e.consequential)).toBe(true);
    // The event that matters most: the moment a figure became able to move money.
    const upgraded = JSON.parse(events[1].payload ?? "{}");
    expect(upgraded.becameCapitalEligible).toBe(true);
    expect(upgraded.from).toBe("MODEL_SUGGESTED");
  });

  it("deleting a figure makes it UNKNOWN, not zero", async () => {
    const owner = await createTestUser();
    const opportunity = await seedOpportunity(owner);
    await recordEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "REQUIRED_CAPITAL_CENTS",
      value: 20_000,
      basis: "STATED",
      provenance: "stated",
    });
    expect(await deleteEstimate(owner.id, opportunity.id, "REQUIRED_CAPITAL_CENTS")).toBe(true);
    const model = await getOpportunityModel(owner.id, opportunity.id);
    expect(model!.figures.REQUIRED_CAPITAL_CENTS.basis).toBe("NONE");
    expect(model!.figures.REQUIRED_CAPITAL_CENTS.value).toBeNull();
    expect(await deleteEstimate(owner.id, opportunity.id, "REQUIRED_CAPITAL_CENTS")).toBe(false);
  });

  it("is scoped per user end to end", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const opportunity = await seedOpportunity(a);
    await recordEstimate({
      userId: a.id,
      opportunityId: opportunity.id,
      figure: "MAX_LOSS_CENTS",
      value: 20_000,
      basis: "STATED",
      provenance: "stated",
    });

    expect(Object.keys(await listEstimates(b.id, opportunity.id))).toHaveLength(0);
    expect((await listEstimatesForOpportunities(b.id, [opportunity.id])).size).toBe(0);
    expect(await getOpportunityModel(b.id, opportunity.id)).toBeNull();
    // And B cannot upgrade A's figure.
    const cross = await upgradeEstimate({
      userId: b.id,
      opportunityId: opportunity.id,
      figure: "MAX_LOSS_CENTS",
      basis: "COMPARABLE",
      provenance: "mine now",
      evidence: { comparableId: opportunity.id },
    });
    expect(cross.upgraded).toBe(false);
    expect(cross.upgraded === false && cross.reason).toBe("NOT_RECORDED");
    // B cannot record on A's opportunity either.
    const write = await recordEstimate({
      userId: b.id,
      opportunityId: opportunity.id,
      figure: "MAX_LOSS_CENTS",
      value: 1,
      basis: "STATED",
      provenance: "mine now",
    });
    expect(write.recorded).toBe(false);
    expect(write.recorded === false && write.reason).toBe("OPPORTUNITY_NOT_FOUND");
  });
});

// ---------------------------------------------------------------------------
// 8. Integration: expectation, portfolio, calibration, posture
// ---------------------------------------------------------------------------

describe("the economic calculations consume provenance-aware figures", () => {
  it("carries per-figure provenance on the expectation itself", () => {
    const expectation = expectedValueOf(projected(allFiguresAt("STATED", { PROBABILITY_OF_SUCCESS: "MEASURED" })));
    expect(expectation.rankable).toBe(true);
    if (!expectation.rankable) return;

    expect(expectation.provenance.figures.map((f) => f.figure)).toEqual([...EV_MATERIAL_FIGURES]);
    const probability = expectation.provenance.figures.find((f) => f.figure === "PROBABILITY_OF_SUCCESS")!;
    expect(probability.basis).toBe("MEASURED");
    const profit = expectation.provenance.figures.find((f) => f.figure === "EXPECTED_PROFIT_CENTS")!;
    expect(profit.basis).toBe("STATED");
    // The one-word label is the MINIMUM, derived for display, and it names the
    // figure in the summary rather than only the basis.
    expect(expectation.basis).toBe("STATED");
    expect(expectation.summary).toMatch(/weakest input is the/i);
  });

  it("lists the unknown figures in the provenance too", () => {
    // Dropping them would make the record read as though the figures it
    // mentions were the complete set.
    const estimates = allFiguresAt("STATED");
    delete estimates.TIME_TO_PAYOUT_DAYS;
    const expectation = expectedValueOf(projected(estimates));
    expect(expectation.rankable).toBe(true);
    if (!expectation.rankable) return;
    const horizon = expectation.provenance.figures.find((f) => f.figure === "TIME_TO_PAYOUT_DAYS")!;
    expect(horizon.basis).toBe("NONE");
    expect(horizon.value).toBeNull();
  });

  it("prefers VOX's own measured track record over a weaker recorded probability", () => {
    const model = projectOpportunity(
      opportunityRow(),
      { probability: 0.25, decided: 4 },
      { PROBABILITY_OF_SUCCESS: estimateRow("PROBABILITY_OF_SUCCESS", 0.9, "STATED") }
    );
    expect(model.figures.PROBABILITY_OF_SUCCESS.value).toBe(0.25);
    expect(model.figures.PROBABILITY_OF_SUCCESS.basis).toBe("MEASURED");
    expect(model.figures.PROBABILITY_OF_SUCCESS.source).toBe("MEASUREMENT");
  });

  it("but an equally-measured recording wins, because it names its evidence", () => {
    const model = projectOpportunity(
      opportunityRow(),
      { probability: 0.25, decided: 4 },
      {
        PROBABILITY_OF_SUCCESS: estimateRow("PROBABILITY_OF_SUCCESS", 0.4, "MEASURED", {
          measurementId: "m1",
        }),
      }
    );
    expect(model.figures.PROBABILITY_OF_SUCCESS.value).toBe(0.4);
    expect(model.figures.PROBABILITY_OF_SUCCESS.source).toBe("ESTIMATE");
  });

  it("THE POSTURE NAMES THE FIGURE TO CORROBORATE", async () => {
    const owner = await createTestUser();
    const opportunity = await seedOpportunity(owner, { status: "ACTIVE" });
    for (const [figure, value] of Object.entries(BASELINE)) {
      await recordEstimate({
        userId: owner.id,
        opportunityId: opportunity.id,
        figure: figure as EconomicFigure,
        value,
        basis: figure === "MAX_LOSS_CENTS" ? "MODEL_SUGGESTED" : "STATED",
        provenance: "recorded",
      });
    }
    await db.user.update({ where: { id: owner.id }, data: { maxAutonomousSpendUsd: 10_000 } });

    const posture = await nextBestEconomicAction(owner.id);
    expect(posture.recommendation.kind).toBe("CORROBORATE_OPPORTUNITY");
    // The P6-A version said "its weakest monetary input is a model's proposal",
    // which nobody could act on without re-deriving the model by hand.
    expect(posture.recommendation.action).toMatch(/worst-case loss/i);
    expect(posture.recommendation.reason).toMatch(/per figure/i);
    expect(posture.plan.proposedTotalCents).toBe(0);
    expect(posture.plan.deferred[0].blockingFigures.map((b) => b.figure)).toEqual(["MAX_LOSS_CENTS"]);
  });

  it("A HISTORICAL PREDICTION STAYS FROZEN WHEN PROVENANCE LATER CHANGES", async () => {
    // Calibration measures what VOX believed AT THE TIME. If improving a
    // figure's provenance rewrote the prediction's recorded basis, the
    // MODEL_SUGGESTED bucket would quietly empty itself as figures were
    // corroborated, and VOX would appear to have been better calibrated than it
    // was.
    const owner = await createTestUser();
    const { measurement } = await seedMeasurement(owner);
    const opportunity = await seedOpportunity(owner);
    await recordEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "EXPECTED_PROFIT_CENTS",
      value: 500_000,
      basis: "MODEL_SUGGESTED",
      provenance: "a model proposed it",
    });

    const prediction = await recordPrediction({
      userId: owner.id,
      opportunityId: opportunity.id,
      predictedNetCents: 250_000,
      predictedProbability: 0.5,
      predictedBasis: "MODEL_SUGGESTED",
      horizonDays: 30,
    });
    expect(prediction.recorded).toBe(true);
    if (!prediction.recorded) return;
    const digestBefore = prediction.prediction.digest;

    await upgradeEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "EXPECTED_PROFIT_CENTS",
      basis: "MEASURED",
      provenance: "observed in the store",
      evidence: { measurementId: measurement.id },
    });

    const after = await db.profitPrediction.findUniqueOrThrow({ where: { id: prediction.prediction.id } });
    expect(after.predictedBasis).toBe("MODEL_SUGGESTED");
    expect(after.digest).toBe(digestBefore);
    expect(after.predictedNetCents).toBe(250_000);

    // And the figure really did change, so the test is about the freeze.
    const estimates = await listEstimates(owner.id, opportunity.id);
    expect(estimates.EXPECTED_PROFIT_CENTS!.basis).toBe("MEASURED");
  });

  it("reports calibration per basis in the new rank order", async () => {
    const owner = await createTestUser();
    const calibration = await getCalibration(owner.id);
    expect(calibration.byBasis.map((b) => b.basis)).toEqual([
      "MODEL_SUGGESTED",
      "STATED",
      "COMPARABLE",
      "MEASURED",
    ]);
    // NONE is absent: a prediction on no basis is never recorded.
    expect(calibration.byBasis.map((b) => b.basis)).not.toContain("NONE");
  });
});

// ---------------------------------------------------------------------------
// 9. The migration, and the shape of the schema change
// ---------------------------------------------------------------------------

describe("the schema change", () => {
  it("IS PURELY ADDITIVE", () => {
    const sql = readFileSync(
      "prisma/migrations/20261005100000_p6b_per_figure_provenance/migration.sql",
      "utf8"
    );
    expect(sql).toMatch(/CREATE TABLE "OpportunityEstimate"/);
    // No column is dropped, no table is rebuilt, nothing is renamed. The old
    // `Opportunity` columns stay exactly where they are, because the
    // compatibility path still reads them.
    expect(sql).not.toMatch(/DROP TABLE/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
    expect(sql).not.toMatch(/ALTER COLUMN/i);
  });

  it("allows one current provenance per figure per opportunity", async () => {
    const owner = await createTestUser();
    const opportunity = await seedOpportunity(owner);
    await recordEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "MAX_LOSS_CENTS",
      value: 20_000,
      basis: "STATED",
      provenance: "first",
    });
    await recordEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "MAX_LOSS_CENTS",
      value: 30_000,
      basis: "STATED",
      provenance: "second",
    });
    const rows = await db.opportunityEstimate.findMany({
      where: { opportunityId: opportunity.id, figure: "MAX_LOSS_CENTS" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].valueCents).toBe(30_000);
    expect(rows[0].provenance).toBe("second");
  });

  it("stores a weakening as a weakening, not as an upgrade", async () => {
    // Writing in either direction has to stay possible: a measured conversion
    // rate from a shop that has since changed its pricing is no longer measured
    // evidence about today, and provenance that could only strengthen would
    // make the system unable to admit that something it knew is now stale.
    const owner = await createTestUser();
    const { measurement } = await seedMeasurement(owner);
    const opportunity = await seedOpportunity(owner);
    await recordEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "PROBABILITY_OF_SUCCESS",
      value: 0.3,
      basis: "MEASURED",
      provenance: "measured last quarter",
      evidence: { measurementId: measurement.id },
    });
    const weakened = await recordEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "PROBABILITY_OF_SUCCESS",
      value: 0.3,
      basis: "STATED",
      provenance: "the shop changed its pricing, so the measurement no longer describes today",
    });
    expect(weakened.recorded).toBe(true);
    if (!weakened.recorded) return;
    expect(weakened.estimate.basis).toBe("STATED");
    expect(weakened.estimate.previousBasis).toBe("MEASURED");
    // The stale evidence reference is cleared rather than left attached to a
    // claim it no longer supports.
    expect(weakened.estimate.measurementId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 10. Mixed provenance, named combination by named combination
// ---------------------------------------------------------------------------

describe("mixed-basis opportunities are first-class", () => {
  it("MEASURED probability + MODEL_SUGGESTED profit", () => {
    const model = projected(
      allFiguresAt("STATED", { PROBABILITY_OF_SUCCESS: "MEASURED", EXPECTED_PROFIT_CENTS: "MODEL_SUGGESTED" })
    );
    expect(model.figures.PROBABILITY_OF_SUCCESS.basis).toBe("MEASURED");
    expect(model.figures.EXPECTED_PROFIT_CENTS.basis).toBe("MODEL_SUGGESTED");
    // Representable AND informative: it still ranks, it still cannot be funded.
    const expectation = expectedValueOf(model);
    expect(expectation.rankable).toBe(true);
    expect(expectation.rankable && expectation.capitalEligible).toBe(false);
    expect(model.capital.blocking.map((b) => b.figure)).toEqual(["EXPECTED_PROFIT_CENTS"]);
  });

  it("MEASURED profit + MODEL_SUGGESTED probability", () => {
    const model = projected(
      allFiguresAt("STATED", { EXPECTED_PROFIT_CENTS: "MEASURED", PROBABILITY_OF_SUCCESS: "MODEL_SUGGESTED" })
    );
    expect(model.figures.EXPECTED_PROFIT_CENTS.basis).toBe("MEASURED");
    expect(model.figures.PROBABILITY_OF_SUCCESS.basis).toBe("MODEL_SUGGESTED");
    expect(model.capital.blocking.map((b) => b.figure)).toEqual(["PROBABILITY_OF_SUCCESS"]);
  });

  it("STATED capital + COMPARABLE max loss", async () => {
    const owner = await createTestUser();
    const comparable = await seedOpportunity(owner, { title: "The one VOX already ran" });
    const opportunity = await seedOpportunity(owner);
    await recordEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "REQUIRED_CAPITAL_CENTS",
      value: 20_000,
      basis: "STATED",
      provenance: "I know what the ad spend costs",
    });
    await recordEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "MAX_LOSS_CENTS",
      value: 20_000,
      basis: "COMPARABLE",
      provenance: "the same downside the earlier test hit",
      evidence: { comparableId: comparable.id },
    });

    const model = await getOpportunityModel(owner.id, opportunity.id);
    expect(model!.figures.REQUIRED_CAPITAL_CENTS.basis).toBe("STATED");
    expect(model!.figures.MAX_LOSS_CENTS.basis).toBe("COMPARABLE");
    expect(model!.figures.MAX_LOSS_CENTS.evidence!.comparableId).toBe(comparable.id);
    // Two different bases, two different evidence shapes, both authoritative.
    expect(model!.figures.REQUIRED_CAPITAL_CENTS.authoritative).toBe(true);
    expect(model!.figures.MAX_LOSS_CENTS.authoritative).toBe(true);
  });

  it("ALL FOUR BASES AT ONCE, each independently represented", () => {
    // The brief's own example, asserted literally.
    const model = projected(
      allFiguresAt("STATED", {
        PROBABILITY_OF_SUCCESS: "MEASURED",
        EXPECTED_PROFIT_CENTS: "MODEL_SUGGESTED",
        MAX_LOSS_CENTS: "STATED",
        REQUIRED_CAPITAL_CENTS: "COMPARABLE",
      })
    );
    expect({
      probability: model.figures.PROBABILITY_OF_SUCCESS.basis,
      profit: model.figures.EXPECTED_PROFIT_CENTS.basis,
      maxLoss: model.figures.MAX_LOSS_CENTS.basis,
      capital: model.figures.REQUIRED_CAPITAL_CENTS.basis,
    }).toEqual({
      probability: "MEASURED",
      profit: "MODEL_SUGGESTED",
      maxLoss: "STATED",
      capital: "COMPARABLE",
    });
  });

  it("CHANGING ONE FIGURE'S PROVENANCE CHANGES NO OTHER FIGURE'S, over the database", async () => {
    // The enumeration test above proves it for the projection. This proves it
    // for a real write: upgrading the probability leaves every other row's
    // basis, value and `updatedAt` untouched.
    const owner = await createTestUser();
    const { measurement } = await seedMeasurement(owner);
    const opportunity = await seedOpportunity(owner);
    for (const [figure, value] of Object.entries(BASELINE)) {
      await recordEstimate({
        userId: owner.id,
        opportunityId: opportunity.id,
        figure: figure as EconomicFigure,
        value,
        basis: "MODEL_SUGGESTED",
        provenance: "a model proposed the whole set",
      });
    }
    const before = await listEstimates(owner.id, opportunity.id);

    const up = await upgradeEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "PROBABILITY_OF_SUCCESS",
      basis: "MEASURED",
      provenance: "observed",
      evidence: { measurementId: measurement.id },
    });
    expect(up.upgraded).toBe(true);

    const after = await listEstimates(owner.id, opportunity.id);
    expect(after.PROBABILITY_OF_SUCCESS!.basis).toBe("MEASURED");
    for (const figure of ECONOMIC_FIGURES) {
      if (figure === "PROBABILITY_OF_SUCCESS") continue;
      expect(after[figure]!.basis, figure).toBe("MODEL_SUGGESTED");
      expect(after[figure]!.updatedAt.getTime(), figure).toBe(before[figure]!.updatedAt.getTime());
    }

    // And the reverse pairing the brief names: changing the capital's
    // provenance leaves the worst-case loss exactly where it was.
    const capital = await upgradeEstimate({
      userId: owner.id,
      opportunityId: opportunity.id,
      figure: "REQUIRED_CAPITAL_CENTS",
      basis: "COMPARABLE",
      provenance: "derived from the earlier test",
      evidence: { comparableId: opportunity.id },
    });
    expect(capital.upgraded).toBe(true);
    const final = await listEstimates(owner.id, opportunity.id);
    expect(final.REQUIRED_CAPITAL_CENTS!.basis).toBe("COMPARABLE");
    expect(final.MAX_LOSS_CENTS!.basis).toBe("MODEL_SUGGESTED");
    expect(final.MAX_LOSS_CENTS!.updatedAt.getTime()).toBe(before.MAX_LOSS_CENTS!.updatedAt.getTime());
  });

  it("A MODEL_SUGGESTED CAPITAL REQUIREMENT CANNOT AUTHORIZE SPENDING", () => {
    // Distinct from the absent case: the number is there, it is plausible, and
    // nothing corroborates it. The brief names both separately because they
    // fail for different reasons and a gate could easily catch one and not the
    // other.
    const model = projected(allFiguresAt("MEASURED", { REQUIRED_CAPITAL_CENTS: "MODEL_SUGGESTED" }));
    expect(model.figures.REQUIRED_CAPITAL_CENTS.value).toBe(BASELINE.REQUIRED_CAPITAL_CENTS);
    expect(model.figures.REQUIRED_CAPITAL_CENTS.capitalEligible).toBe(false);
    expect(model.capital.eligible).toBe(false);
    expect(model.capital.blocking[0]).toMatchObject({
      figure: "REQUIRED_CAPITAL_CENTS",
      basis: "MODEL_SUGGESTED",
      reason: "TOO_WEAK",
    });

    const plan = selectPortfolio({
      expectations: [expectedValueOf(model)],
      deployableCents: 10_000_000,
      activeExperiments: 0,
      halted: false,
    });
    expect(plan.selected).toHaveLength(0);
    expect(plan.proposedTotalCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 11. The existing gates are untouched
// ---------------------------------------------------------------------------

describe("the existing authorization and evidence machinery is unchanged", () => {
  it("IS DOWNSTREAM OF EVERY GATE, NEVER UPSTREAM", () => {
    // The durable form of "the existing gates are unchanged": the dependency
    // direction. The permission check, the approval grant, the atomic spend
    // ceiling, the evidence loop and the scale/kill decision must not read the
    // provenance layer, because a gate whose answer depended on a figure's
    // basis would be a gate that provenance could talk round — and provenance
    // is recorded by whoever is proposing the spend.
    //
    // The BEHAVIOUR of those modules is asserted by their own suites, which run
    // in the same gate as this file. This test asserts the thing those suites
    // cannot see: that nothing new points INTO them.
    const gates = [
      "src/lib/permissions/service.ts",
      "src/lib/policy/approvals.ts",
      "src/lib/policy/gate.ts",
      "src/lib/economic/spend.ts",
      "src/lib/economic/evidence.ts",
      "src/lib/economic/decide.ts",
      "src/lib/commerce/execute.ts",
      "src/lib/volara/governor.ts",
    ].filter((f) => existsSync(f));
    // Guards the guard: a typo in a path would otherwise make this vacuous.
    expect(gates.length).toBeGreaterThan(5);

    for (const file of gates) {
      const source = readFileSync(file, "utf8");
      for (const layer of ["economic/provenance", "economic/figures", "economic/opportunityModel"]) {
        expect(source, `${file} imports ${layer}`).not.toContain(layer);
      }
    }
  });

  it("the new provenance layer imports no gate mutator", () => {
    // Applied to all three new/rewritten modules, not just the writer: a
    // provenance layer that could reach `grantPermission` would be a second
    // authorization path however carefully it was written.
    for (const file of [
      "src/lib/economic/provenance.ts",
      "src/lib/economic/figures.ts",
      "src/lib/economic/opportunityModel.ts",
    ]) {
      const imports = importedSymbols(readFileSync(file, "utf8"));
      for (const forbidden of [
        "grantPermission",
        "createApprovalGrant",
        "consumeApprovalGrant",
        "approveCapitalAllocation",
        "requestCapital",
        "recordSpend",
        "executeCommercialAction",
      ]) {
        expect(imports, `${file} / ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("NO EXTERNAL ACTION FOLLOWS FROM A FLATTERING MODEL-SUGGESTED EXPECTATION", async () => {
    // The end-to-end version of the central guard. The figures are
    // extraordinary — a 90% chance of $50,000 for $200 — and every one of them
    // is a model's proposal. The answer is still corroborate, nothing is
    // reserved, and no commercial action exists.
    const owner = await createTestUser();
    const opportunity = await seedOpportunity(owner, { status: "ACTIVE" });
    const spectacular: Record<EconomicFigure, number> = {
      REQUIRED_CAPITAL_CENTS: 20_000,
      EXPECTED_REVENUE_CENTS: 6_000_000,
      EXPECTED_PROFIT_CENTS: 5_000_000,
      MAX_LOSS_CENTS: 20_000,
      PROBABILITY_OF_SUCCESS: 0.9,
      MARGIN_FRACTION: 0.8,
      TIME_TO_PAYOUT_DAYS: 7,
    };
    for (const [figure, value] of Object.entries(spectacular)) {
      await recordEstimate({
        userId: owner.id,
        opportunityId: opportunity.id,
        figure: figure as EconomicFigure,
        value,
        basis: "MODEL_SUGGESTED",
        provenance: "a model proposed it, confidently",
      });
    }
    await db.user.update({ where: { id: owner.id }, data: { maxAutonomousSpendUsd: 100_000 } });

    const posture = await nextBestEconomicAction(owner.id);
    expect(posture.recommendation.kind).toBe("CORROBORATE_OPPORTUNITY");
    expect(posture.plan.selected).toHaveLength(0);
    expect(posture.plan.proposedTotalCents).toBe(0);

    // Nothing was reserved, nothing was spent, nothing was sent.
    expect(await db.capitalAllocation.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db.commercialAction.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db.approvalGrant.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db.economicExpense.count({ where: { asset: { userId: owner.id } } })).toBe(0);
  });

  it("preserves the P6-A unknown-value safety at the type level", () => {
    // The P6-A guard, re-asserted here rather than assumed: the unknown arm
    // still has no `value` for a `??` to read, and the figure layer does not
    // introduce a second representation with one.
    const estimates = allFiguresAt("STATED");
    delete estimates.MAX_LOSS_CENTS;
    const model = projected(estimates);
    expect(model.dimensions.maxLossCents.known).toBe(false);
    expect("value" in model.dimensions.maxLossCents).toBe(false);
    // And the resolved figure reports null rather than a stand-in.
    expect(model.figures.MAX_LOSS_CENTS.value).toBeNull();
    const expectation = expectedValueOf(model);
    expect(expectation.rankable).toBe(false);
    expect("expectedNetPerDayCents" in expectation).toBe(false);
  });
});

/** Symbols imported by a module — the scan the authorization guards use. */
function importedSymbols(source: string): string {
  return (source.match(/import[\s\S]*?from\s+["'][^"']+["'];/g) ?? []).join("\n");
}
