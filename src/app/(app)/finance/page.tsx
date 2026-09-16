import { getCurrentUser } from "@/lib/auth/session";
import { listEconomicAssets, getEconomicOverview, getBudgetSummary } from "@/lib/economic/service";
import { getAutonomyMode } from "@/lib/supervisor/service";
import { listOpportunities } from "@/lib/objectives/service";
import { getPnlReport } from "@/lib/economic/pnl";
import { EconomicCommandClient } from "@/components/economic/EconomicCommandClient";
import { BudgetAutonomyPanel } from "@/components/economic/BudgetAutonomyPanel";
import { ProfitLossPanel } from "@/components/economic/ProfitLossPanel";
import { EvidencePanel } from "@/components/economic/EvidencePanel";
import { listExperimentEvidence, verifyEvidenceIntegrity } from "@/lib/economic/evidence";
import { getMeasuredProbability } from "@/lib/economic/probability";
import { toPanelData } from "@/lib/economic/panelData";
import { RoomHeader } from "@/components/ui/Instrument";

export default async function FinancePage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [assets, overview, opportunities, budget, autonomyMode, pnl, evidence, probability, integrity] =
    await Promise.all([
      listEconomicAssets(user.id),
      getEconomicOverview(user.id),
      listOpportunities(user.id),
      getBudgetSummary(user.id),
      getAutonomyMode(user.id),
      getPnlReport(user.id),
      listExperimentEvidence(user.id),
      getMeasuredProbability({ userId: user.id }),
      verifyEvidenceIntegrity(user.id),
    ]);

  const unpromoted = opportunities.filter((o) => !assets.some((a) => a.opportunityId === o.id));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <RoomHeader
        system="Execution"
        title="Economic Command"
        description={<>Real assets, real revenue and expense entries you log yourself — nothing here is a projection, a forecast, or invented income. An asset starts as an Opportunity (see Objectives) and becomes real once you record it here.</>}
      />

      <ProfitLossPanel initial={toPanelData(pnl)} />

      <div className="mt-6">
        <EvidencePanel
          evidence={evidence.map((e) => ({
            ...e,
            lastObservationAttemptAt: e.lastObservationAttemptAt?.toISOString() ?? null,
            measurement: e.measurement
              ? {
                  ...e.measurement,
                  observedAt: e.measurement.observedAt.toISOString(),
                  external: e.measurement.external
                    ? {
                        ...e.measurement.external,
                        retrievedAt: e.measurement.external.retrievedAt?.toISOString() ?? null,
                        windowStart: e.measurement.external.windowStart?.toISOString() ?? null,
                        windowEnd: e.measurement.external.windowEnd?.toISOString() ?? null,
                      }
                    : null,
                }
              : null,
            outcome: e.outcome
              ? { ...e.outcome, recordedAt: e.outcome.recordedAt?.toISOString() ?? null }
              : null,
          }))}
          probability={probability}
          integrityIssues={integrity.length}
        />
      </div>

      <div className="mt-6">
        <BudgetAutonomyPanel initialBudget={budget} initialAutonomyMode={autonomyMode} />
      </div>

      <EconomicCommandClient
        initialAssets={assets.map((a) => ({ ...a, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString() }))}
        overview={overview}
        opportunities={unpromoted.map((o) => ({ id: o.id, title: o.title }))}
      />
    </div>
  );
}
