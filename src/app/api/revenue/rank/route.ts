import { db } from "@/lib/db";
import { rankSprintCandidates, SPRINT_HORIZON_DAYS } from "@/lib/revenue/sprintRank";
import { scoreOpportunity } from "@/lib/objectives/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [SPRINT] THE OPPORTUNITY LIST, RANKED FOR A 72-HOUR HORIZON.
 *
 * READ-ONLY. It creates no opportunity, writes no estimate and changes no row —
 * it re-orders what is already recorded. An endpoint that invented an
 * opportunity in order to rank it would be fabricating the thing it claims to
 * measure.
 *
 * Both rankings are returned side by side: the sprint score AND the
 * general-purpose `scoreOpportunity()`. They disagree, on purpose, and showing
 * only one would hide which question is being answered — the general scorer
 * clamps time-to-revenue at 7 days, so inside a 3-day window it cannot tell
 * "pays tomorrow" from "pays next week".
 */
export async function GET() {
  try {
    const user = await requireUser();

    const opportunities = await db.opportunity.findMany({
      where: { userId: user.id, status: { notIn: ["REJECTED", "COMPLETED", "FAILED"] } },
      select: {
        id: true,
        title: true,
        estimatedValue: true,
        estimatedMargin: true,
        estimatedStartupCost: true,
        estimatedOperatingCost: true,
        estimatedTimeToRevenueDays: true,
        confidence: true,
        effort: true,
        risk: true,
        complexity: true,
        competition: true,
        requiredHumanInvolvement: true,
        scalability: true,
        category: true,
        source: true,
        rationale: true,
      },
      take: 200,
    });

    const byId = new Map(opportunities.map((o) => [o.id, o]));
    const ranked = rankSprintCandidates(opportunities).map((row) => ({
      ...row,
      // The general ranker's own number, for comparison. Computed from the same
      // row, never copied from the cached `scoreSnapshot` column.
      generalScore: scoreOpportunity(byId.get(row.id)!),
    }));

    return jsonOk({
      horizonDays: SPRINT_HORIZON_DAYS,
      ranked,
      caveats: [
        "A rank is not a forecast and a forecast is not a sale. Every input is an estimate somebody entered or a model suggested.",
        "The probability of payment comes from each row's own confidence field, which is a judgement, not a measured rate.",
        "Nothing here has been validated against a real customer. The figures carry whatever EvidenceBasis the provenance layer recorded — MODEL_SUGGESTED for a fresh list.",
      ],
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
