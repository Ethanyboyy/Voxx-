/**
 * [SPRINT] Tests for the 72-hour revenue sprint: the ranker and the pipeline.
 *
 * Two things are genuinely new and both are tested for what could go wrong with
 * them rather than for coverage:
 *
 *   THE RANKER must actually discriminate inside three days — the whole reason
 *   it exists instead of `scoreOpportunity()` — and must not invent a number
 *   that was not on the row.
 *
 *   THE PIPELINE must have exactly one door money comes through, and that door
 *   must demand checkable evidence, refuse to bank the same payment twice, and
 *   write USER_RECORDED rather than REALIZED. A human saying "it paid" is a
 *   human assertion; promoting it to an external confirmation is the one
 *   mistake this module could make that would matter.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";
import { scoreSprintCandidate, rankSprintCandidates, SPRINT_HORIZON_DAYS, type SprintCandidate } from "@/lib/revenue/sprintRank";
import { scoreOpportunity } from "@/lib/objectives/service";
import {
  recordOutreach,
  recordOutreachResponse,
  confirmOutreachPayment,
  pipelineSummary,
} from "@/lib/revenue/outreach";
import { createTestUser } from "./helpers";
import type { User } from "@/generated/prisma/client";

function candidate(over: Partial<SprintCandidate> = {}): SprintCandidate {
  return {
    id: "c1",
    title: "A service offer",
    estimatedValue: 450,
    estimatedMargin: 0.9,
    estimatedStartupCost: 0,
    estimatedTimeToRevenueDays: 2,
    confidence: "MEDIUM",
    effort: "MEDIUM",
    requiredHumanInvolvement: "MEDIUM",
    scalability: "MEDIUM",
    ...over,
  };
}

async function asset(owner: User, name = "Sprint services") {
  return db.economicAsset.create({ data: { userId: owner.id, name, category: "OTHER" } });
}

// ---------------------------------------------------------------------------
// The ranker
// ---------------------------------------------------------------------------

describe("the sprint ranker discriminates inside the horizon", () => {
  it("SEPARATES ONE DAY FROM SEVEN, WHERE THE GENERAL SCORER CANNOT", () => {
    // The defect that justifies this module existing at all. `scoreOpportunity()`
    // computes `30 / max(7, days)`, so 1 and 7 produce an identical speed
    // multiplier and the two rows tie.
    const base = {
      estimatedValue: 450,
      estimatedMargin: 0.9,
      estimatedStartupCost: 0,
      estimatedOperatingCost: null,
      confidence: "MEDIUM" as const,
      effort: "MEDIUM" as const,
      risk: null,
      complexity: null,
      competition: null,
      requiredHumanInvolvement: "MEDIUM" as const,
      scalability: "MEDIUM" as const,
    };
    const tomorrow = { ...base, estimatedTimeToRevenueDays: 1 };
    const nextWeek = { ...base, estimatedTimeToRevenueDays: 7 };

    // The existing scorer genuinely cannot tell these apart.
    expect(scoreOpportunity(tomorrow)).toBe(scoreOpportunity(nextWeek));

    // The sprint ranker ranks the one that pays tomorrow seven times higher.
    const fast = scoreSprintCandidate(candidate({ estimatedTimeToRevenueDays: 1 }));
    const slow = scoreSprintCandidate(candidate({ estimatedTimeToRevenueDays: 7 }));
    expect(fast.score).toBeGreaterThan(slow.score);
    expect(fast.score / slow.score).toBeCloseTo(7, 5);
  });

  it("flags what cannot pay inside the horizon instead of dropping it", () => {
    const outside = scoreSprintCandidate(candidate({ estimatedTimeToRevenueDays: 30 }));
    expect(outside.outsideHorizon).toBe(true);
    // Still scored. A list that silently omitted a row a person entered would
    // be editing their input rather than ranking it.
    expect(outside.score).toBeGreaterThan(0);
    expect(scoreSprintCandidate(candidate({ estimatedTimeToRevenueDays: SPRINT_HORIZON_DAYS })).outsideHorizon).toBe(false);
  });

  it("AN UNKNOWN MARGIN IS NOT ASSUMED TO BE 100%", () => {
    // The optimistic assumption is the dangerous one: a service business
    // keeping every dollar it bills is the best case, and defaulting to the
    // best case is how a ranking starts flattering itself.
    const unknown = scoreSprintCandidate(candidate({ estimatedMargin: null }));
    const perfect = scoreSprintCandidate(candidate({ estimatedMargin: 1 }));
    expect(unknown.marginIsAssumedDefault).toBe(true);
    expect(unknown.netPerSale).toBeLessThan(perfect.netPerSale);
  });

  it("capital at risk divides the score, and zero capital does not", () => {
    const free = scoreSprintCandidate(candidate({ estimatedStartupCost: 0 }));
    const costly = scoreSprintCandidate(candidate({ estimatedStartupCost: 500 }));
    expect(free.capitalDivisor).toBe(1);
    expect(costly.score).toBeCloseTo(free.score / 2, 6);
  });

  it("no confidence level implies a near-certain sale", () => {
    // CONFIRMED means the OPPORTUNITY is corroborated, not that a specific
    // person will pay this week.
    for (const confidence of ["LOW", "MEDIUM", "HIGH", "CONFIRMED"] as const) {
      expect(scoreSprintCandidate(candidate({ confidence })).paidProbability).toBeLessThan(0.7);
    }
  });

  it("ranks stably, so the order does not drift between identical calls", () => {
    const tied = [candidate({ id: "b" }), candidate({ id: "a" }), candidate({ id: "c" })];
    expect(rankSprintCandidates(tied).map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(rankSprintCandidates(tied).map((r) => r.id)).toEqual(rankSprintCandidates(tied).map((r) => r.id));
  });

  it("the ranker reads rows and cannot write one", () => {
    const source = readFileSync("src/lib/revenue/sprintRank.ts", "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // A pure function over a row. No database, no clock, no model, no network —
    // a ranker that could reach any of those could rank on something it made up.
    for (const forbidden of ["@/lib/db", "db.", "Date.now", "Math.random", "fetch(", "generateText"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });
});

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

describe("the pipeline records outreach and sends nothing", () => {
  it("THE MODULE HAS NO SEND PATH", () => {
    const source = readFileSync("src/lib/revenue/outreach.ts", "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // If this module could send, a model's judgement about who deserves a cold
    // pitch would be the only thing between a prospect and their inbox.
    for (const forbidden of ["fetch(", "nodemailer", "sendMail", "@/lib/notifications", "twilio", "resend"]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
  });

  it("records a sent message, defaulting to no response", async () => {
    const owner = await createTestUser();
    const attempt = await recordOutreach({
      userId: owner.id,
      prospect: "Dana Whitfield",
      organization: "Whitfield Plumbing",
      channel: "WARM_PERSONAL",
      offer: "48-hour invoice-chasing automation, $450 flat",
      askedPriceCents: 45_000,
    });

    expect(attempt.outcome).toBe("NO_RESPONSE");
    // Silence is not a response, so it carries no response timestamp.
    expect(attempt.respondedAt).toBeNull();
    expect(attempt.revenueId).toBeNull();
  });

  it("refuses an unnamed prospect", async () => {
    const owner = await createTestUser();
    await expect(
      recordOutreach({ userId: owner.id, prospect: "   ", channel: "EMAIL" })
    ).rejects.toThrow(/needs a prospect/i);
  });

  it("is scoped per user", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    const attempt = await recordOutreach({ userId: owner.id, prospect: "Dana", channel: "EMAIL" });

    const result = await recordOutreachResponse(other.id, attempt.id, "INTERESTED");
    expect(result.recorded).toBe(false);
    if (result.recorded) throw new Error("unreachable");
    expect(result.reason).toBe("NOT_FOUND");
  });

  it("DECLINED AND NO_RESPONSE STAY DIFFERENT FACTS", async () => {
    const owner = await createTestUser();
    const silent = await recordOutreach({ userId: owner.id, prospect: "A", channel: "EMAIL" });
    const no = await recordOutreach({ userId: owner.id, prospect: "B", channel: "EMAIL" });
    await recordOutreachResponse(owner.id, no.id, "DECLINED");

    const summary = await pipelineSummary(owner.id);
    expect(summary.sent).toBe(2);
    // One answered, one has not. Averaging a silence into a rejection would
    // make the pipeline unreadable.
    expect(summary.responded).toBe(1);
    const silentRow = await db.outreachAttempt.findUniqueOrThrow({ where: { id: silent.id } });
    expect(silentRow.respondedAt).toBeNull();
  });

  it("NO MONEY YET IS NULL, NOT ZERO", async () => {
    const owner = await createTestUser();
    const empty = await pipelineSummary(owner.id);
    // Same reasoning as the Observer's UNRECORDED: a sprint dashboard showing
    // $0.00 on day one reads as a result rather than as an absence.
    expect(empty.verifiedRevenueCents).toBeNull();
    // And a rate with no denominator does not exist.
    expect(empty.responseRate).toBeNull();
  });
});

describe("money has exactly one door, and it demands evidence", () => {
  it("PAID CANNOT BE SET AS A STATUS", async () => {
    const owner = await createTestUser();
    const attempt = await recordOutreach({ userId: owner.id, prospect: "Dana", channel: "EMAIL" });

    const result = await recordOutreachResponse(owner.id, attempt.id, "PAID");
    expect(result.recorded).toBe(false);
    if (result.recorded) throw new Error("unreachable");
    expect(result.reason).toBe("PAID_NEEDS_CONFIRMATION");

    // And nothing moved.
    const row = await db.outreachAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(row.outcome).toBe("NO_RESPONSE");
    // Scoped to this owner: the suite shares a database with every other spec.
    expect(await db.economicRevenue.count({ where: { asset: { userId: owner.id } } })).toBe(0);
  });

  it("REFUSES A PAYMENT WITH NO PROCESSOR OR NO REFERENCE", async () => {
    const owner = await createTestUser();
    const a = await asset(owner);
    const attempt = await recordOutreach({ userId: owner.id, prospect: "Dana", channel: "EMAIL" });

    for (const evidence of [
      { processor: "", reference: "ch_123" },
      { processor: "stripe", reference: "  " },
    ]) {
      const result = await confirmOutreachPayment({
        userId: owner.id,
        attemptId: attempt.id,
        assetId: a.id,
        amountCents: 45_000,
        ...evidence,
      });
      expect(result.confirmed).toBe(false);
      if (result.confirmed) throw new Error("unreachable");
      expect(result.reason).toBe("EVIDENCE_INCOMPLETE");
    }

    // An unreferenced "they paid, trust me" writes no money.
    expect(await db.economicRevenue.count({ where: { asset: { userId: owner.id } } })).toBe(0);
  });

  it("A VERIFIED PAYMENT IS USER_RECORDED, NEVER REALIZED", async () => {
    const owner = await createTestUser();
    const a = await asset(owner);
    const attempt = await recordOutreach({
      userId: owner.id,
      prospect: "Dana Whitfield",
      organization: "Whitfield Plumbing",
      channel: "WARM_PERSONAL",
      askedPriceCents: 45_000,
    });

    const result = await confirmOutreachPayment({
      userId: owner.id,
      attemptId: attempt.id,
      assetId: a.id,
      amountCents: 45_000,
      processor: "stripe",
      reference: "ch_3QfixtureABC",
    });

    expect(result.confirmed).toBe(true);
    if (!result.confirmed) throw new Error("unreachable");
    expect(result.provenance).toBe("USER_RECORDED");

    const revenue = await db.economicRevenue.findUniqueOrThrow({ where: { id: result.revenueId } });
    // THE ASSERTION THAT MATTERS. A person looked at Stripe and typed what they
    // saw; VOX confirmed nothing against anything. Promoting that to REALIZED
    // would be exactly the provenance laundering the figure layer prevents.
    expect(revenue.provenance).toBe("USER_RECORDED");
    expect(revenue.amountCents).toBe(45_000);
    // The reference travels with the row so the claim is checkable by somebody
    // other than whoever made it.
    expect(revenue.source).toContain("ch_3QfixtureABC");
    // And it is not attributed to a measured experiment it did not come from.
    expect(revenue.measurementId).toBeNull();

    const row = await db.outreachAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
    expect(row.outcome).toBe("PAID");
    expect(row.revenueId).toBe(result.revenueId);
  });

  it("BANKS ONE PAYMENT ONCE", async () => {
    const owner = await createTestUser();
    const a = await asset(owner);
    const attempt = await recordOutreach({ userId: owner.id, prospect: "Dana", channel: "EMAIL" });
    const evidence = { processor: "stripe", reference: "ch_once", amountCents: 45_000 };

    const first = await confirmOutreachPayment({ userId: owner.id, attemptId: attempt.id, assetId: a.id, ...evidence });
    expect(first.confirmed).toBe(true);

    const second = await confirmOutreachPayment({ userId: owner.id, attemptId: attempt.id, assetId: a.id, ...evidence });
    expect(second.confirmed).toBe(false);
    if (second.confirmed) throw new Error("unreachable");
    expect(second.reason).toBe("ALREADY_PAID");

    // One ledger row, not two. The same $450 counted twice is the most boring
    // way an honest ledger becomes a dishonest one.
    expect(await db.economicRevenue.count({ where: { assetId: a.id } })).toBe(1);
  });

  it("concurrent confirmations bank one row, not two", async () => {
    const owner = await createTestUser();
    const a = await asset(owner);
    const attempt = await recordOutreach({ userId: owner.id, prospect: "Dana", channel: "EMAIL" });
    const evidence = { processor: "stripe", reference: "ch_race", amountCents: 45_000 };

    const results = await Promise.all([
      confirmOutreachPayment({ userId: owner.id, attemptId: attempt.id, assetId: a.id, ...evidence }),
      confirmOutreachPayment({ userId: owner.id, attemptId: attempt.id, assetId: a.id, ...evidence }),
    ]);

    expect(results.filter((r) => r.confirmed)).toHaveLength(1);
    expect(await db.economicRevenue.count({ where: { assetId: a.id } })).toBe(1);
  });

  it("refuses to book revenue against another user's asset", async () => {
    const owner = await createTestUser();
    const other = await createTestUser();
    const theirAsset = await asset(other, "Someone else's business");
    const attempt = await recordOutreach({ userId: owner.id, prospect: "Dana", channel: "EMAIL" });

    const result = await confirmOutreachPayment({
      userId: owner.id,
      attemptId: attempt.id,
      assetId: theirAsset.id,
      amountCents: 45_000,
      processor: "stripe",
      reference: "ch_crossuser",
    });
    expect(result.confirmed).toBe(false);
    if (result.confirmed) throw new Error("unreachable");
    expect(result.reason).toBe("NO_ASSET");
    expect(await db.economicRevenue.count({ where: { assetId: theirAsset.id } })).toBe(0);
  });

  it("an AGREED prospect is not revenue", async () => {
    const owner = await createTestUser();
    await asset(owner);
    const attempt = await recordOutreach({ userId: owner.id, prospect: "Dana", channel: "EMAIL", askedPriceCents: 45_000 });
    await recordOutreachResponse(owner.id, attempt.id, "AGREED");

    const summary = await pipelineSummary(owner.id);
    expect(summary.agreed).toBe(1);
    expect(summary.paid).toBe(0);
    // Said yes, has not paid. The gap between those two is where optimistic
    // pipelines report money they do not have.
    expect(summary.verifiedRevenueCents).toBeNull();
    expect(summary.caveats.join(" ")).toMatch(/AGREED is not money/i);
  });

  it("the summary says payments are human-verified, not VOX-verified", async () => {
    const owner = await createTestUser();
    const summary = await pipelineSummary(owner.id);
    expect(summary.caveats.join(" ")).toMatch(/a person verified it against a processor, VOX did not/i);
  });
});
