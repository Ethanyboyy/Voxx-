import { getCurrentUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { pipelineSummary } from "@/lib/revenue/outreach";
import { rankSprintCandidates, SPRINT_HORIZON_DAYS } from "@/lib/revenue/sprintRank";
import { RoomHeader, Seam } from "@/components/ui/Instrument";

export const dynamic = "force-dynamic";

/**
 * [SPRINT] THE SPRINT BOARD.
 *
 * READ-ONLY, like the Observer and for the same reason: if the runtime does not
 * know something, this page must not pretend it does. No money is rendered as
 * `$0.00` when nothing has been paid — it says `UNRECORDED`, because a
 * dashboard showing a zero on day one reads as a result rather than an absence.
 */

function money(cents: number | null): string {
  if (cents === null) return "UNRECORDED";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function rate(value: number | null): string {
  return value === null ? "NO BASIS" : `${Math.round(value * 100)}%`;
}

export default async function RevenueSprintPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [summary, opportunities, attempts] = await Promise.all([
    pipelineSummary(user.id),
    db.opportunity.findMany({
      where: { userId: user.id, status: { notIn: ["REJECTED", "COMPLETED", "FAILED"] } },
      select: {
        id: true,
        title: true,
        estimatedValue: true,
        estimatedMargin: true,
        estimatedStartupCost: true,
        estimatedTimeToRevenueDays: true,
        confidence: true,
        effort: true,
        requiredHumanInvolvement: true,
        scalability: true,
      },
      take: 50,
    }),
    db.outreachAttempt.findMany({
      where: { userId: user.id },
      orderBy: { sentAt: "desc" },
      take: 50,
    }),
  ]);

  const ranked = rankSprintCandidates(opportunities);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <RoomHeader
        system="Economic"
        title="Revenue Sprint"
        description={
          <>
            Who has actually been asked to buy something, what they said, and whether money arrived. Every
            payment here is <strong>human-verified, not VOX-verified</strong> — a person looked at a payment
            processor and typed what they saw. Nothing on this page is a forecast.
          </>
        }
      />

      <section className="mt-8">
        <h2 className="vox-eyebrow">Pipeline</h2>
        <Seam className="mt-2" />
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
          {[
            ["Sent", String(summary.sent)],
            ["Responded", String(summary.responded)],
            ["Response rate", rate(summary.responseRate)],
            ["Interested", String(summary.interested)],
            ["Agreed (not money)", String(summary.agreed)],
            ["Verified revenue", money(summary.verifiedRevenueCents)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-[var(--hairline)] p-3">
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="mt-1 text-lg tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <ul className="mt-4 space-y-1 text-xs text-muted">
          {summary.caveats.map((c) => (
            <li key={c}>— {c}</li>
          ))}
        </ul>
      </section>

      <section className="mt-10">
        <h2 className="vox-eyebrow">Opportunities, ranked for {SPRINT_HORIZON_DAYS} days</h2>
        <Seam className="mt-2" />
        {ranked.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No opportunities recorded. This page ranks what you have entered; it does not invent candidates.
          </p>
        ) : (
          <ol className="mt-4 space-y-3">
            {ranked.map((row) => (
              <li key={row.id} className="rounded-lg border border-[var(--hairline)] p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm">
                    {row.rank}. {row.title}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-muted">
                    {row.breakdown.score.toFixed(1)}/day·$
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">
                  {money(Math.round(row.breakdown.expectedCash * 100))} expected · {row.breakdown.daysToFirstDollar}d to
                  first dollar · P(paid) {rate(row.breakdown.paidProbability)}
                  {row.breakdown.outsideHorizon ? " · OUTSIDE THE HORIZON" : ""}
                  {row.breakdown.valueIsAssumedDefault ? " · no value estimate on the row" : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="mt-10">
        <h2 className="vox-eyebrow">Attempts</h2>
        <Seam className="mt-2" />
        {attempts.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            Nobody has been contacted yet. VOX does not send anything — every message is sent by a person and
            recorded here afterwards.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {attempts.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">
                  {a.prospect}
                  {a.organization ? ` · ${a.organization}` : ""}
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {a.channel} · {a.outcome}
                  {a.outcome === "PAID" ? ` · ${money(a.paidAmountCents)}` : ""}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
