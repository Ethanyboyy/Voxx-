/**
 * [P6-C] DISCOVERY UNDER ECONOMIC PROVENANCE — adversarial tests.
 *
 * P6-B made every economically material figure independently auditable. P6-C is
 * the first thing that generates those figures from nothing, which makes it the
 * first real test of whether the boundary holds.
 *
 * The attack this suite is built around is not subtle and it is very easy to
 * commit by accident:
 *
 *     await db.opportunity.create({ data: {
 *       title, description,
 *       expectedProfitCents: 50_000,      // "just for compatibility"
 *       probabilityOfSuccess: 0.3,
 *     }});
 *
 * Those two columns go through `legacyColumnBasis()`. A row with no `source`
 * reads as `STATED`, and `STATED` is the capital minimum — so a model's
 * invention would clear `capitalBasisGate()` without ever touching the
 * provenance layer. Every structural guard in `discovery/` exists for that one
 * line, and most of the tests below are trying to write it.
 *
 * The others ask:
 *
 *   Can a model claim its own basis, or cite evidence that does not exist?
 *   Can repetition, agreement between passes, or model confidence become
 *     corroboration?
 *   Does a discovered opportunity still rank, and still refuse to be funded?
 *   Does the refusal name the figure, all the way to the surface?
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { grantPermission, PermissionDeniedError } from "@/lib/permissions/service";
import {
  CLAIM_KEYS,
  proposalDigest,
  validateCandidate,
  type ProposedOpportunity,
} from "@/lib/discovery/contract";
import {
  DISCOVERY_CAPABILITY,
  DISCOVERY_LEVEL,
  DISCOVERY_SOURCE,
  assertNoLegacyEconomicColumns,
  listDiscoveryRuns,
  recordCandidates,
  runDiscovery,
} from "@/lib/discovery/service";
import { corroborationPlan } from "@/lib/discovery/corroboration";
import { DISCOVERY_BASIS_LABEL } from "@/components/economic/DiscoveryPanel";
import {
  ECONOMIC_FIGURES,
  EV_MATERIAL_FIGURES,
  FIGURE_SPECS,
  LEGACY_ECONOMIC_COLUMNS,
} from "@/lib/economic/figures";
import { getOpportunityModel, isHumanSource, legacyColumnBasis } from "@/lib/economic/opportunityModel";
import { listEstimates, upgradeEstimate } from "@/lib/economic/provenance";
import { expectedValueOf } from "@/lib/economic/expectedValue";
import { selectPortfolio } from "@/lib/economic/portfolio";
import { nextBestEconomicAction } from "@/lib/economic/nextAction";
import { classifyAction } from "@/lib/policy/classification";
import { evaluatePolicy } from "@/lib/policy/gate";
import { getTool } from "@/lib/tools/registry";
import { createTestUser } from "./helpers";
import type { EconomicFigure } from "@/generated/prisma/enums";
import type { User } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * A realistic model proposal — the brief's own example.
 *
 * Written by hand rather than produced by a model, because the mock provider
 * cannot return structured output and generating one with a real model would
 * need a key this repository does not have. This is exactly the shape
 * `proposeCandidates()` validates and hands to `recordCandidates()`.
 */
function proposal(over: Partial<ProposedOpportunity> = {}): ProposedOpportunity {
  return {
    title: "Niche print-on-demand line for trail runners",
    thesis:
      "A small apparel line aimed at ultramarathon runners, printed on demand so there is no inventory. The segment buys branded gear and is underserved by the large labels.",
    category: "print-on-demand",
    rationale: "Low fixed cost, fast to test, and the audience congregates in a few forums.",
    uncertainty: "No idea what the click-through on a cold ad set would be, and the margin depends on a supplier nobody has quoted.",
    figures: [
      { figure: "EXPECTED_PROFIT_CENTS", value: 50_000, reasoning: "Ten units a week at a $50 margin, for ten weeks." },
      { figure: "PROBABILITY_OF_SUCCESS", value: 0.3, reasoning: "Most apparel tests fail; this one has a defined audience." },
      { figure: "MAX_LOSS_CENTS", value: 10_000, reasoning: "The ad budget plus the sample order." },
      { figure: "TIME_TO_PAYOUT_DAYS", value: 14, reasoning: "Two weeks of ad data is enough to call it." },
      { figure: "REQUIRED_CAPITAL_CENTS", value: 10_000, reasoning: "Ad budget and one sample run." },
    ],
    ...over,
  };
}

async function seedObjective(owner: User) {
  return db.objective.create({ data: { userId: owner.id, title: "Earn net profit" } });
}

/** A user with discovery granted and an objective to discover against. */
async function readyUser() {
  const owner = await createTestUser();
  await grantPermission(owner.id, DISCOVERY_CAPABILITY, DISCOVERY_LEVEL);
  const objective = await seedObjective(owner);
  return { owner, objective };
}

async function openRun(owner: User, objectiveId: string | null) {
  return db.discoveryRun.create({
    data: {
      userId: owner.id,
      objectiveId,
      brief: "Find ways to make money online",
      provider: "test",
      model: "test-model",
      status: "RUNNING",
    },
  });
}

/** Runs a pass end to end from hand-written proposals. */
async function discover(raw: readonly unknown[]) {
  const { owner, objective } = await readyUser();
  const run = await openRun(owner, objective.id);
  const outcomes = await recordCandidates({ userId: owner.id, runId: run.id, raw });
  return { owner, objective, run, outcomes };
}

// ---------------------------------------------------------------------------
// 1. The contract: a proposal cannot claim a basis
// ---------------------------------------------------------------------------

describe("what a discovery pass is allowed to propose", () => {
  it("A PROPOSED FIGURE HAS NO BASIS FIELD TO SET", () => {
    // The structural half of the guarantee, asserted on the validated object:
    // there is no `basis` property on anything that comes out of validation, so
    // the persister has nothing to read a basis from and writes the literal.
    const result = validateCandidate(proposal());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    for (const figure of result.candidate.figures) {
      expect("basis" in figure).toBe(false);
      expect("evidence" in figure).toBe(false);
      expect("measurementId" in figure).toBe(false);
      expect("confidence" in figure).toBe(false);
    }
  });

  it("REJECTS A PROPOSAL THAT CLAIMS A BASIS", () => {
    // Rejected, not silently stripped. A permissive parse would make the pass
    // look like it worked while the model's actual claim went unrecorded.
    const result = validateCandidate({
      ...proposal(),
      figures: [{ figure: "EXPECTED_PROFIT_CENTS", value: 50_000, reasoning: "x", basis: "MEASURED" }],
    });
    expect(result.valid).toBe(false);
    expect(result.valid === false && result.reason).toBe("CLAIMS_EVIDENCE_OR_BASIS");
    expect(result.valid === false && result.detail).toMatch(/basis/);
  });

  it("REJECTS EVERY CLAIM KEY, AT EITHER LEVEL, BY ENUMERATION", () => {
    for (const key of CLAIM_KEYS) {
      // On the candidate...
      const onCandidate = validateCandidate({ ...proposal(), [key]: "anything" });
      expect(onCandidate.valid, `candidate.${key}`).toBe(false);
      expect(onCandidate.valid === false && onCandidate.reason, `candidate.${key}`).toBe(
        "CLAIMS_EVIDENCE_OR_BASIS"
      );

      // ...and nested on a figure.
      const onFigure = validateCandidate({
        ...proposal(),
        figures: [{ figure: "MAX_LOSS_CENTS", value: 1_000, reasoning: "x", [key]: "anything" }],
      });
      expect(onFigure.valid, `figure.${key}`).toBe(false);
      expect(onFigure.valid === false && onFigure.reason, `figure.${key}`).toBe("CLAIMS_EVIDENCE_OR_BASIS");
    }
  });

  it("names the claim BEFORE complaining about anything else", () => {
    // A proposal that both asserts a measured basis and carries a broken
    // number is reported as the claim it made, not as a typo. The claim is the
    // thing somebody needs to see.
    const result = validateCandidate({
      ...proposal(),
      figures: [{ figure: "MAX_LOSS_CENTS", value: 1.5, reasoning: "x", measurementId: "m-invented" }],
    });
    expect(result.valid === false && result.reason).toBe("CLAIMS_EVIDENCE_OR_BASIS");
  });

  it("refuses a value that is not storable for its figure's kind", () => {
    for (const [figure, value] of [
      ["REQUIRED_CAPITAL_CENTS", 12.5],
      ["PROBABILITY_OF_SUCCESS", 1.4],
      ["TIME_TO_PAYOUT_DAYS", 0],
      ["MAX_LOSS_CENTS", -1],
    ] as const) {
      const result = validateCandidate({
        ...proposal(),
        figures: [{ figure, value, reasoning: "x" }],
      });
      expect(result.valid, figure).toBe(false);
      expect(result.valid === false && result.reason, figure).toBe("INVALID_FIGURE_VALUE");
    }
  });

  it("refuses the same figure proposed twice", () => {
    const result = validateCandidate({
      ...proposal(),
      figures: [
        { figure: "MAX_LOSS_CENTS", value: 1_000, reasoning: "a" },
        { figure: "MAX_LOSS_CENTS", value: 2_000, reasoning: "b" },
      ],
    });
    expect(result.valid === false && result.reason).toBe("DUPLICATE_FIGURE");
  });

  it("refuses an unknown figure name rather than ignoring it", () => {
    const result = validateCandidate({
      ...proposal(),
      figures: [{ figure: "GUARANTEED_RETURN", value: 1_000, reasoning: "x" }],
    });
    expect(result.valid === false && result.reason).toBe("MALFORMED");
  });

  it("digests over the numbers, not the prose", () => {
    // Two passes that reword the same thesis around the same figures are the
    // same proposal — otherwise repeated discovery accumulates duplicates that
    // read as independent candidates agreeing.
    const a = proposal();
    const b = proposal({ thesis: a.thesis + " Rewritten entirely differently, at length.", rationale: "Other words." });
    expect(proposalDigest(b)).toBe(proposalDigest(a));

    const different = proposal({ figures: [{ figure: "MAX_LOSS_CENTS", value: 999, reasoning: "x" }] });
    expect(proposalDigest(different)).not.toBe(proposalDigest(a));
  });
});

// ---------------------------------------------------------------------------
// 2. The structural guards
// ---------------------------------------------------------------------------

describe("the guards that keep discovery off the legacy path", () => {
  it("THE FORBIDDEN COLUMN LIST COVERS EVERY COLUMN THE COMPATIBILITY PATH READS", () => {
    // Derived from the registry, and checked against the module that actually
    // reads them: every `opportunity.X` the resolver passes as a legacy value
    // must appear in the list. A fallback column missing from it is a hole an
    // automated writer could walk through — which is exactly what
    // `estimatedTimeToRevenueDays` was before `legacyFallbackColumn` existed.
    const source = readFileSync("src/lib/economic/opportunityModel.ts", "utf8");
    const read = [...source.matchAll(/resolve\(\s*"[A-Z_]+",\s*\n?\s*((?:opportunity\.\w+\s*\?\?\s*)*opportunity\.\w+)/g)]
      .flatMap((match) => [...match[1].matchAll(/opportunity\.(\w+)/g)].map((m) => m[1]));
    expect(read.length).toBeGreaterThan(4);
    for (const column of read) {
      expect(LEGACY_ECONOMIC_COLUMNS, column).toContain(column);
    }
    // And the legacy profit column, which the profit resolver reads separately.
    expect(LEGACY_ECONOMIC_COLUMNS).toContain("expectedProfitCents");
    expect(LEGACY_ECONOMIC_COLUMNS).toContain("estimatedTimeToRevenueDays");
  });

  it("THROWS ON ANY ATTEMPT TO WRITE AN ECONOMIC COLUMN", () => {
    // The adversarial case, one column at a time.
    for (const column of LEGACY_ECONOMIC_COLUMNS) {
      expect(
        () => assertNoLegacyEconomicColumns({ title: "x", [column]: 1 }),
        column
      ).toThrow(/may not write economic columns/i);
    }
    // And the honest case passes.
    expect(() =>
      assertNoLegacyEconomicColumns({ title: "x", description: "y", source: DISCOVERY_SOURCE })
    ).not.toThrow();
  });

  it("THE DISCOVERY SOURCE IS NOT A HUMAN SOURCE", () => {
    // Asserted against the single definition, not a copy. If this ever became
    // true, every legacy-read figure on every discovered row would be STATED.
    expect(isHumanSource(DISCOVERY_SOURCE)).toBe(false);
    expect(legacyColumnBasis(DISCOVERY_SOURCE)).toBe("MODEL_SUGGESTED");
    // The things that ARE human sources, for contrast.
    for (const human of ["user", "human", "owner", "manual", "", null]) {
      expect(isHumanSource(human), String(human)).toBe(true);
    }
  });

  it("the discovery layer imports no gate mutator", () => {
    for (const file of [
      "src/lib/discovery/service.ts",
      "src/lib/discovery/contract.ts",
      "src/lib/discovery/corroboration.ts",
    ]) {
      const imports = (readFileSync(file, "utf8").match(/import[\s\S]*?from\s+["'][^"']+["'];/g) ?? []).join("\n");
      for (const forbidden of [
        "grantPermission",
        "createApprovalGrant",
        "consumeApprovalGrant",
        "approveCapitalAllocation",
        "requestCapital",
        "recordSpend",
        "recordPolicySpend",
        "executeCommercialAction",
        "capitalBasisGate",
      ]) {
        expect(imports, `${file} / ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("NOTHING ON THE ECONOMIC PATH READS THE RAW MODEL PROPOSAL", () => {
    // `rawProposal` and `uncertainty` are audit text. If an economic module
    // parsed either, a model's own words would be back on the decision path by
    // a different route.
    const economic = [
      "estimate",
      "figures",
      "provenance",
      "opportunityModel",
      "expectedValue",
      "portfolio",
      "nextAction",
      "calibration",
    ].map((name) => `src/lib/economic/${name}.ts`);
    for (const file of economic) {
      const source = readFileSync(file, "utf8");
      for (const forbidden of ["rawProposal", "uncertainty", "discoveryCandidate", "discoveryRun"]) {
        expect(source, `${file} / ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("there is no column for model confidence at all", () => {
    // Not stored, so there is nothing for a future gate to be tempted by.
    const schema = readFileSync("prisma/schema.prisma", "utf8");
    const candidateModel = schema.slice(
      schema.indexOf("model DiscoveryCandidate"),
      schema.indexOf("model DiscoveryCandidate") + 2500
    );
    expect(candidateModel).not.toMatch(/^\s*confidence\s/m);
    expect(candidateModel).not.toMatch(/^\s*certainty\s/m);
    expect(candidateModel).not.toMatch(/^\s*basis\s/m);
  });
});

// ---------------------------------------------------------------------------
// 3. Discovery end to end
// ---------------------------------------------------------------------------

describe("a discovery pass, end to end", () => {
  it("RECORDS EVERY FIGURE AT MODEL_SUGGESTED, ONE AT A TIME", async () => {
    const { owner, outcomes } = await discover([proposal()]);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].status).toBe("ACCEPTED");
    expect(outcomes[0].figuresRecorded).toBe(5);

    const estimates = await listEstimates(owner.id, outcomes[0].opportunityId!);
    expect(Object.keys(estimates).sort()).toEqual(
      ["EXPECTED_PROFIT_CENTS", "MAX_LOSS_CENTS", "PROBABILITY_OF_SUCCESS", "REQUIRED_CAPITAL_CENTS", "TIME_TO_PAYOUT_DAYS"].sort()
    );
    for (const [figure, row] of Object.entries(estimates)) {
      expect(row!.basis, figure).toBe("MODEL_SUGGESTED");
      // No evidence references: a model's own output is not a research result,
      // a measurement or a comparable.
      expect(row!.measurementId, figure).toBeNull();
      expect(row!.experimentId, figure).toBeNull();
      expect(row!.comparableId, figure).toBeNull();
      expect(row!.researchItemId, figure).toBeNull();
      // The model's reasoning survives, labelled as a hypothesis.
      expect(row!.provenance, figure).toMatch(/uncorroborated/i);
    }
  });

  it("NEVER CREATES A STATED, COMPARABLE OR MEASURED FIGURE", async () => {
    const { owner, outcomes } = await discover([proposal(), proposal({ title: "A second idea entirely" })]);
    const rows = await db.opportunityEstimate.findMany({ where: { userId: owner.id } });
    expect(rows.length).toBeGreaterThan(0);
    expect([...new Set(rows.map((r) => r.basis))]).toEqual(["MODEL_SUGGESTED"]);
    expect(outcomes.every((o) => o.status === "ACCEPTED")).toBe(true);
  });

  it("WRITES NO ECONOMIC COLUMN ON THE OPPORTUNITY", async () => {
    const { owner, outcomes } = await discover([proposal()]);
    const opportunity = await db.opportunity.findUniqueOrThrow({
      where: { id: outcomes[0].opportunityId! },
    });
    const row = opportunity as unknown as Record<string, unknown>;
    for (const column of LEGACY_ECONOMIC_COLUMNS) {
      expect(row[column], column).toBeNull();
    }
    // The figures are real, and they live in the provenance layer.
    const model = await getOpportunityModel(owner.id, opportunity.id);
    expect(model!.figures.EXPECTED_PROFIT_CENTS.value).toBe(50_000);
    expect(model!.figures.EXPECTED_PROFIT_CENTS.source).toBe("ESTIMATE");
    expect(model!.compatibilityFigures).toEqual([]);
  });

  it("sets a non-human source and does not backdate anything", async () => {
    const before = Date.now();
    const { owner, outcomes } = await discover([proposal()]);
    const opportunity = await db.opportunity.findUniqueOrThrow({ where: { id: outcomes[0].opportunityId! } });
    expect(opportunity.source).toBe(DISCOVERY_SOURCE);

    const estimates = await listEstimates(owner.id, opportunity.id);
    for (const [figure, row] of Object.entries(estimates)) {
      // An `establishedAt` in the past would read as a figure established by
      // something historical — precisely the impression a model-proposed
      // number must not give.
      expect(row!.establishedAt.getTime(), figure).toBeGreaterThanOrEqual(before);
    }
  });

  it("RECORDS A REJECTION RATHER THAN DISCARDING IT", async () => {
    const { owner, outcomes } = await discover([
      { ...proposal(), figures: [{ figure: "MAX_LOSS_CENTS", value: 1_000, reasoning: "x", basis: "MEASURED" }] },
    ]);
    expect(outcomes[0].status).toBe("REJECTED");
    expect(outcomes[0].opportunityId).toBeNull();

    const candidates = await db.discoveryCandidate.findMany({ where: { userId: owner.id } });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].status).toBe("REJECTED");
    expect(candidates[0].rejectionReason).toMatch(/CLAIMS_EVIDENCE_OR_BASIS/);
    // The model's words are kept, so the rejection is reviewable.
    expect(candidates[0].rawProposal).toMatch(/MEASURED/);
    // And no opportunity exists for it.
    expect(await db.opportunity.count({ where: { userId: owner.id } })).toBe(0);
  });

  it("REFUSES RATHER THAN INVENTING WHEN THE PROVIDER CANNOT ANSWER", async () => {
    // The mock provider is what runs here and in any deployment without a key.
    // It cannot return structured output, and the honest result is a named
    // refusal and zero candidates.
    const { owner, objective } = await readyUser();
    const result = await runDiscovery({
      userId: owner.id,
      objectiveId: objective.id,
      brief: "Find me ways to make money online this month",
    });
    expect(result.refused).toBe(true);
    expect(result.run.status).toBe("REFUSED");
    expect(result.run.refusalReason).toBe("PROVIDER_NOT_STRUCTURED");
    expect(result.run.refusalDetail).toMatch(/no candidates were invented/i);
    expect(result.outcomes).toHaveLength(0);
    expect(await db.opportunity.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db.opportunityEstimate.count({ where: { userId: owner.id } })).toBe(0);
  });

  it("refuses a run with no objective of the user's own", async () => {
    const { owner } = await readyUser();
    const result = await runDiscovery({
      userId: owner.id,
      objectiveId: "objective-that-is-not-theirs",
      brief: "Find me ways to make money online this month",
    });
    expect(result.refused).toBe(true);
    expect(result.run.refusalReason).toBe("NO_OBJECTIVE");
  });

  it("IS GATED, AND THE GATE IS THE EXISTING ONE", async () => {
    const ungranted = await createTestUser();
    const objective = await seedObjective(ungranted);
    await expect(
      runDiscovery({ userId: ungranted.id, objectiveId: objective.id, brief: "Find me opportunities please" })
    ).rejects.toBeInstanceOf(PermissionDeniedError);

    // The persistence half is gated identically, so it is a second caller of
    // one gate rather than a way around it.
    const run = await openRun(ungranted, objective.id);
    await expect(
      recordCandidates({ userId: ungranted.id, runId: run.id, raw: [proposal()] })
    ).rejects.toBeInstanceOf(PermissionDeniedError);
    expect(await db.opportunity.count({ where: { userId: ungranted.id } })).toBe(0);
  });

  it("is scoped per user", async () => {
    const { owner, outcomes } = await discover([proposal()]);
    const other = await createTestUser();
    await grantPermission(other.id, DISCOVERY_CAPABILITY, DISCOVERY_LEVEL);

    expect(await listDiscoveryRuns(other.id)).toHaveLength(0);
    expect(await getOpportunityModel(other.id, outcomes[0].opportunityId!)).toBeNull();
    // And one user cannot record into another's run.
    const run = (await listDiscoveryRuns(owner.id))[0];
    await expect(
      recordCandidates({ userId: other.id, runId: run.id, raw: [proposal()] })
    ).rejects.toThrow(/No such discovery run/);
  });

  it("the tool goes through the policy gate as a HOLD", () => {
    const tool = getTool("discovery.scan");
    expect(tool).toBeDefined();
    expect(tool!.capability).toBe(DISCOVERY_CAPABILITY);
    expect(tool!.requiredLevel).toBe("RECOMMEND");
    const classification = classifyAction("tool", "discovery.scan").classification;
    // Untrusted output: everything the pass produces is model text, including
    // the numbers.
    expect(classification.untrustedOutput).toBe(true);
    expect(classification.financial).toBe(false);
    expect(classification.externalSystemOfRecord).toBe(false);
    expect(evaluatePolicy({ action: classification }).decision).toBe("HOLD");
  });
});

// ---------------------------------------------------------------------------
// 4. A discovered opportunity ranks, and cannot be funded
// ---------------------------------------------------------------------------

describe("discovered opportunities rank and refuse capital", () => {
  it("RANKS, which is the whole point of recording the figures", async () => {
    const { owner, outcomes } = await discover([proposal()]);
    const model = await getOpportunityModel(owner.id, outcomes[0].opportunityId!);
    const expectation = expectedValueOf(model!);

    expect(expectation.rankable).toBe(true);
    if (!expectation.rankable) return;
    // 0.3 × 50,000 − 0.7 × 10,000 = 8,000 cents over 14 days.
    expect(expectation.expectedNetCents).toBe(8_000);
    expect(expectation.terms.horizonDays).toBe(14);
    expect(expectation.expectedNetPerDayCents).toBe(Math.round(8_000 / 14));
  });

  it("CANNOT RESERVE CAPITAL, AND EVERY MATERIAL FIGURE IS NAMED", async () => {
    const { owner, outcomes } = await discover([proposal()]);
    const model = await getOpportunityModel(owner.id, outcomes[0].opportunityId!);

    expect(model!.capital.eligible).toBe(false);
    // All four ev-material figures that were proposed, each blocking on its own
    // basis — not one rolled-up verdict.
    expect(model!.capital.blocking.map((b) => b.figure).sort()).toEqual(
      [...EV_MATERIAL_FIGURES].sort()
    );
    expect(model!.capital.blocking.every((b) => b.reason === "TOO_WEAK")).toBe(true);

    const plan = selectPortfolio({
      expectations: [expectedValueOf(model!)],
      deployableCents: 10_000_000,
      activeExperiments: 0,
      halted: false,
    });
    expect(plan.selected).toHaveLength(0);
    expect(plan.proposedTotalCents).toBe(0);
    expect(plan.deferred[0].reason).toBe("BASIS_TOO_WEAK");
    expect(plan.deferred[0].blockingFigures.length).toBeGreaterThan(0);
  });

  it("A FAVOURABLE EXPECTED VALUE IS NOT PROOF OF ANYTHING", async () => {
    // Spectacular figures, all model-proposed. The expectation is large, the
    // ranking is honest, and nothing is reserved or sent.
    const { owner, outcomes } = await discover([
      proposal({
        title: "An extraordinary opportunity",
        figures: [
          { figure: "EXPECTED_PROFIT_CENTS", value: 5_000_000, reasoning: "A very large number." },
          { figure: "PROBABILITY_OF_SUCCESS", value: 0.95, reasoning: "Almost certain, says the model." },
          { figure: "MAX_LOSS_CENTS", value: 1_000, reasoning: "Barely any downside." },
          { figure: "TIME_TO_PAYOUT_DAYS", value: 2, reasoning: "Two days." },
          { figure: "REQUIRED_CAPITAL_CENTS", value: 1_000, reasoning: "Ten dollars." },
        ],
      }),
    ]);
    await db.user.update({ where: { id: owner.id }, data: { maxAutonomousSpendUsd: 100_000 } });

    const model = await getOpportunityModel(owner.id, outcomes[0].opportunityId!);
    const expectation = expectedValueOf(model!);
    expect(expectation.rankable && expectation.expectedNetCents).toBeGreaterThan(4_000_000);
    expect(expectation.rankable && expectation.capitalEligible).toBe(false);

    const posture = await nextBestEconomicAction(owner.id);
    expect(posture.recommendation.kind).toBe("CORROBORATE_OPPORTUNITY");
    expect(posture.plan.proposedTotalCents).toBe(0);
    expect(await db.capitalAllocation.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db.commercialAction.count({ where: { userId: owner.id } })).toBe(0);
    expect(await db.approvalGrant.count({ where: { userId: owner.id } })).toBe(0);
  });

  it("CORROBORATE_OPPORTUNITY NAMES THE FIGURES, not the confidence", async () => {
    const { owner, outcomes } = await discover([proposal()]);
    await db.opportunity.update({ where: { id: outcomes[0].opportunityId! }, data: { status: "ACTIVE" } });
    await db.user.update({ where: { id: owner.id }, data: { maxAutonomousSpendUsd: 10_000 } });

    const posture = await nextBestEconomicAction(owner.id);
    expect(posture.recommendation.kind).toBe("CORROBORATE_OPPORTUNITY");
    // Specific claims, by name — not "improve opportunity confidence".
    expect(posture.recommendation.action).toMatch(/expected profit on success|worst-case loss|probability of success/i);
    expect(posture.recommendation.reason).not.toMatch(/improve .*confidence/i);
    expect(posture.plan.deferred[0].blockingFigures.map((b) => b.figure)).toContain("EXPECTED_PROFIT_CENTS");
  });

  it("THE CORROBORATION PLAN SAYS WHAT WOULD CLEAR EACH FIGURE", async () => {
    const { owner } = await discover([proposal()]);
    const plan = await corroborationPlan(owner.id, { discoveredOnly: true });
    expect(plan).toHaveLength(1);
    expect(plan[0].discovered).toBe(true);
    expect(plan[0].capitalEligible).toBe(false);
    expect(plan[0].blocking.length).toBe(EV_MATERIAL_FIGURES.length);
    for (const block of plan[0].blocking) {
      expect(block.label).toBe(FIGURE_SPECS[block.figure].label);
      expect(block.minimumBasis).toBe("STATED");
      // And it says plainly that re-proposing and model agreement do not count.
      expect(block.whatWouldClearIt).toMatch(/same number again does not count/i);
      expect(block.whatWouldClearIt).toMatch(/second model agreeing/i);
    }
  });

  it("A GENUINE ZERO STAYS DISTINCT FROM AN UNKNOWN", async () => {
    // Discovery proposing a zero worst case is a claim; omitting the figure is
    // not. Both are MODEL_SUGGESTED, and only one has a value.
    const { owner, outcomes } = await discover([
      proposal({
        title: "Costs nothing to try",
        figures: [
          { figure: "EXPECTED_PROFIT_CENTS", value: 50_000, reasoning: "x" },
          { figure: "PROBABILITY_OF_SUCCESS", value: 0.3, reasoning: "x" },
          { figure: "MAX_LOSS_CENTS", value: 0, reasoning: "Nothing is spent to test it." },
          { figure: "TIME_TO_PAYOUT_DAYS", value: 14, reasoning: "x" },
        ],
      }),
    ]);
    const model = await getOpportunityModel(owner.id, outcomes[0].opportunityId!);

    expect(model!.figures.MAX_LOSS_CENTS.value).toBe(0);
    expect(model!.figures.MAX_LOSS_CENTS.basis).toBe("MODEL_SUGGESTED");
    // The capital requirement was not proposed at all.
    expect(model!.figures.REQUIRED_CAPITAL_CENTS.value).toBeNull();
    expect(model!.figures.REQUIRED_CAPITAL_CENTS.basis).toBe("NONE");
    expect(
      model!.capital.blocking.find((b) => b.figure === "REQUIRED_CAPITAL_CENTS")!.reason
    ).toBe("ABSENT");
    expect(model!.capital.blocking.find((b) => b.figure === "MAX_LOSS_CENTS")!.reason).toBe("TOO_WEAK");
  });

  it("TIME_TO_PAYOUT_DAYS KEEPS ITS ASYMMETRY", async () => {
    // Omitted: the conservative default applies and it does not block.
    const { owner, outcomes } = await discover([
      proposal({
        title: "No horizon proposed",
        figures: [
          { figure: "EXPECTED_PROFIT_CENTS", value: 50_000, reasoning: "x" },
          { figure: "PROBABILITY_OF_SUCCESS", value: 0.3, reasoning: "x" },
          { figure: "MAX_LOSS_CENTS", value: 10_000, reasoning: "x" },
          { figure: "REQUIRED_CAPITAL_CENTS", value: 10_000, reasoning: "x" },
        ],
      }),
    ]);
    const model = await getOpportunityModel(owner.id, outcomes[0].opportunityId!);
    expect(model!.figures.TIME_TO_PAYOUT_DAYS.basis).toBe("NONE");
    expect(model!.capital.blocking.map((b) => b.figure)).not.toContain("TIME_TO_PAYOUT_DAYS");
    // The rate is computed against the longest horizon, which understates it.
    const expectation = expectedValueOf(model!);
    expect(expectation.rankable && expectation.terms.horizonDays).toBe(365);

    // Proposed on a weak basis, it DOES block — because a model-suggested
    // "2 days" where the truth is a year inflates the per-day rate.
    const { owner: o2, outcomes: out2 } = await discover([proposal({ title: "A fast horizon, claimed" })]);
    const m2 = await getOpportunityModel(o2.id, out2[0].opportunityId!);
    expect(m2!.capital.blocking.map((b) => b.figure)).toContain("TIME_TO_PAYOUT_DAYS");
  });
});

// ---------------------------------------------------------------------------
// 5. No laundering through discovery
// ---------------------------------------------------------------------------

describe("discovery cannot manufacture corroboration", () => {
  it("REPEATED DISCOVERY DOES NOT ACCUMULATE OR UPGRADE", async () => {
    const { owner, objective } = await readyUser();

    const first = await recordCandidates({
      userId: owner.id,
      runId: (await openRun(owner, objective.id)).id,
      raw: [proposal()],
    });
    expect(first[0].status).toBe("ACCEPTED");

    // The same proposal again, in a fresh pass.
    const second = await recordCandidates({
      userId: owner.id,
      runId: (await openRun(owner, objective.id)).id,
      raw: [proposal()],
    });
    expect(second[0].status).toBe("REJECTED");
    expect(second[0].reason).toBe("DUPLICATE_OF_EXISTING");

    // One opportunity, one set of estimates, still MODEL_SUGGESTED.
    expect(await db.opportunity.count({ where: { userId: owner.id } })).toBe(1);
    const estimates = await listEstimates(owner.id, first[0].opportunityId!);
    for (const row of Object.values(estimates)) expect(row!.basis).toBe("MODEL_SUGGESTED");
  });

  it("MODEL AGREEMENT IS NOT EVIDENCE", async () => {
    // Five passes, five different models, all proposing the same numbers with
    // different reasoning. Consensus produces no basis change — and no second
    // opportunity that would read as independent support.
    const { owner, objective } = await readyUser();
    for (const model of ["model-a", "model-b", "model-c", "model-d", "model-e"]) {
      const run = await db.discoveryRun.create({
        data: {
          userId: owner.id,
          objectiveId: objective.id,
          brief: "Find money",
          provider: "test",
          model,
          status: "RUNNING",
        },
      });
      await recordCandidates({
        userId: owner.id,
        runId: run.id,
        raw: [proposal({ rationale: `Reasoned differently by ${model}.` })],
      });
    }

    expect(await db.opportunity.count({ where: { userId: owner.id } })).toBe(1);
    const rows = await db.opportunityEstimate.findMany({ where: { userId: owner.id } });
    expect([...new Set(rows.map((r) => r.basis))]).toEqual(["MODEL_SUGGESTED"]);
    for (const row of rows) expect(row.previousBasis).toBeNull();
  });

  it("CANNOT JUMP MODEL_SUGGESTED STRAIGHT TO MEASURED WITH AN INVENTED ID", async () => {
    const { owner, outcomes } = await discover([proposal()]);
    const result = await upgradeEstimate({
      userId: owner.id,
      opportunityId: outcomes[0].opportunityId!,
      figure: "EXPECTED_PROFIT_CENTS",
      basis: "MEASURED",
      provenance: "the model was very confident and has been right before",
      evidence: { measurementId: "measurement-that-does-not-exist" },
    });
    expect(result.upgraded).toBe(false);
    expect(result.upgraded === false && result.reason).toBe("EVIDENCE_NOT_FOUND");

    const estimates = await listEstimates(owner.id, outcomes[0].opportunityId!);
    expect(estimates.EXPECTED_PROFIT_CENTS!.basis).toBe("MODEL_SUGGESTED");
  });

  it("CANNOT CITE A RESEARCH RESULT THAT DOES NOT EXIST, AT ANY BASIS", async () => {
    // [P6-C] A citation is a claim even when the basis does not require one.
    // This used to reach the database and come back as a constraint error.
    const { owner, outcomes } = await discover([proposal()]);
    const { recordEstimate } = await import("@/lib/economic/provenance");
    const result = await recordEstimate({
      userId: owner.id,
      opportunityId: outcomes[0].opportunityId!,
      figure: "MARGIN_FRACTION",
      value: 0.4,
      basis: "MODEL_SUGGESTED",
      provenance: "a model proposed it, citing research",
      evidence: { researchItemId: "research-that-does-not-exist" },
    });
    expect(result.recorded).toBe(false);
    expect(result.recorded === false && result.reason).toBe("EVIDENCE_NOT_FOUND");
  });

  it("A RESEARCH RESULT IS NOT A MEASUREMENT", async () => {
    // Even a REAL research item cannot satisfy a MEASURED claim. Source
    // observation is not economic evidence about a figure.
    const { owner, outcomes } = await discover([proposal()]);
    const research = await db.researchItem.create({
      data: {
        userId: owner.id,
        query: "trail running apparel margins",
        title: "A blog post about margins",
        summary: "Claims 40% is typical.",
        provider: "test",
      },
    });
    const result = await upgradeEstimate({
      userId: owner.id,
      opportunityId: outcomes[0].opportunityId!,
      figure: "EXPECTED_PROFIT_CENTS",
      basis: "MEASURED",
      provenance: "a blog post said so",
      evidence: { researchItemId: research.id },
    });
    expect(result.upgraded).toBe(false);
    expect(result.upgraded === false && result.reason).toBe("EVIDENCE_REQUIRED");
  });

  it("A PERSON CAN CORROBORATE ONE FIGURE, AND ONLY THAT ONE MOVES", async () => {
    // The legitimate transition, and the one that makes discovery useful: a
    // person states the worst case from their own knowledge, and that single
    // figure becomes capital-eligible while the rest stay hypotheses.
    const { owner, outcomes } = await discover([proposal()]);
    const opportunityId = outcomes[0].opportunityId!;
    const before = await listEstimates(owner.id, opportunityId);

    const up = await upgradeEstimate({
      userId: owner.id,
      opportunityId,
      figure: "MAX_LOSS_CENTS",
      basis: "STATED",
      provenance: "I have run this ad budget before; $100 is the real ceiling.",
      value: 10_000,
    });
    expect(up.upgraded).toBe(true);
    if (!up.upgraded) return;
    expect(up.from).toBe("MODEL_SUGGESTED");
    expect(up.to).toBe("STATED");

    const after = await listEstimates(owner.id, opportunityId);
    expect(after.MAX_LOSS_CENTS!.basis).toBe("STATED");
    expect(after.MAX_LOSS_CENTS!.previousBasis).toBe("MODEL_SUGGESTED");
    for (const figure of Object.keys(before) as EconomicFigure[]) {
      if (figure === "MAX_LOSS_CENTS") continue;
      expect(after[figure]!.basis, figure).toBe("MODEL_SUGGESTED");
      expect(after[figure]!.updatedAt.getTime(), figure).toBe(before[figure]!.updatedAt.getTime());
    }

    // Still not fundable: three figures to go, and the gate names them.
    const model = await getOpportunityModel(owner.id, opportunityId);
    expect(model!.capital.eligible).toBe(false);
    expect(model!.capital.blocking.map((b) => b.figure)).not.toContain("MAX_LOSS_CENTS");
  });

  it("CORROBORATING EVERY MATERIAL FIGURE IS WHAT MAKES IT FUNDABLE", async () => {
    // The end of the ladder, so the refusals above are shown to be a gate
    // rather than a wall. Each figure is stated separately, by a person.
    const { owner, outcomes } = await discover([proposal()]);
    const opportunityId = outcomes[0].opportunityId!;
    for (const figure of EV_MATERIAL_FIGURES) {
      const result = await upgradeEstimate({
        userId: owner.id,
        opportunityId,
        figure,
        basis: "STATED",
        provenance: `I stand behind the ${FIGURE_SPECS[figure].label} myself.`,
      });
      expect(result.upgraded, figure).toBe(true);
    }

    const model = await getOpportunityModel(owner.id, opportunityId);
    expect(model!.capital.eligible).toBe(true);
    expect(model!.capital.blocking).toEqual([]);

    // And it now reaches the portfolio as a selection — through the ordinary
    // path, with the governor's limits applying as they always did.
    const plan = selectPortfolio({
      expectations: [expectedValueOf(model!)],
      deployableCents: 1_000_000,
      activeExperiments: 0,
      halted: false,
    });
    expect(plan.selected).toHaveLength(1);
    expect(plan.selected[0].proposedCapitalCents).toBe(10_000);
    // Selection is still only a PROPOSAL: committing it remains
    // requestCapital() -> a human's ApprovalGrant -> approveCapitalAllocation().
    expect(await db.capitalAllocation.count({ where: { userId: owner.id } })).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 6. The surface tells the truth
// ---------------------------------------------------------------------------

describe("the discovery surface", () => {
  /**
   * Comments stripped before a call scan.
   *
   * Same helper the P5-E, P5-F and P5-G suites define for the same reason, and
   * defined locally for the same reason they do: a source scan belongs with the
   * assertions that use it. The specific trap here is that a module explaining
   * which function it deliberately does NOT call has to name that function.
   */
  function codeOnly(text: string): string {
    return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  it("NEVER DESCRIBES AN UNCHECKED FIGURE AS CHECKED", () => {
    // Asserted on the exported label map as data, rather than by grepping prose.
    const forbidden = /verified|proven|validated|fundable|measured|confirmed|guaranteed/i;
    for (const basis of ["MODEL_SUGGESTED", "STATED", "COMPARABLE", "NONE"]) {
      expect(DISCOVERY_BASIS_LABEL[basis].text, basis).not.toMatch(forbidden);
    }
    // MODEL_SUGGESTED says what it is.
    expect(DISCOVERY_BASIS_LABEL.MODEL_SUGGESTED.text).toBe("model hypothesis");
    // And the one basis that IS an observation is described as one, without
    // borrowing the word for anything weaker.
    expect(DISCOVERY_BASIS_LABEL.MEASURED.text).toMatch(/system of record/i);
    expect(ECONOMIC_FIGURES.length).toBeGreaterThan(0);
  });

  it("renders a refusal as the reason, not as an empty list", () => {
    const source = readFileSync("src/components/economic/DiscoveryPanel.tsx", "utf8");
    // Every refusal the schema can produce has text on the surface.
    for (const reason of [
      "PROVIDER_NOT_STRUCTURED",
      "UNPARSEABLE_OUTPUT",
      "ALL_CANDIDATES_INVALID",
      "NO_OBJECTIVE",
    ]) {
      expect(source, reason).toContain(reason);
    }
  });

  it("the panel computes no capital verdict of its own", () => {
    // It reports over `corroborationPlan()`, which reads the engine's gate. A
    // UI that recomputed eligibility would be a second decision system.
    //
    // SCANNED ON IMPORTS AND CALLS, not on prose: the panel's own comment
    // explains why it does not compute the verdict, and naming the function it
    // deliberately does not call is the clearest way to say that. A symbol that
    // is neither imported nor invoked cannot produce a second answer.
    const source = readFileSync("src/components/economic/DiscoveryPanel.tsx", "utf8");
    const imports = (source.match(/import[\s\S]*?from\s+["'][^"']+["'];/g) ?? []).join("\n");
    for (const forbidden of ["capitalBasisGate", "canInfluenceCapital", "meetsMinimumBasis", "CAPITAL_MINIMUM_BASIS"]) {
      expect(imports, `imports ${forbidden}`).not.toContain(forbidden);
      expect(codeOnly(source), `calls ${forbidden}`).not.toContain(`${forbidden}(`);
    }
  });
});
