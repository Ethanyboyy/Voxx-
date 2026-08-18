import { getCurrentUser } from "@/lib/auth/session";
import { listEconomicAssets, getEconomicOverview } from "@/lib/economic/service";
import { listOpportunities } from "@/lib/objectives/service";
import { EconomicCommandClient } from "@/components/economic/EconomicCommandClient";

export default async function FinancePage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [assets, overview, opportunities] = await Promise.all([
    listEconomicAssets(user.id),
    getEconomicOverview(user.id),
    listOpportunities(user.id),
  ]);

  const unpromoted = opportunities.filter((o) => !assets.some((a) => a.opportunityId === o.id));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <p className="vox-eyebrow">Execution</p>
      <h1 className="vox-headline mt-1 text-2xl sm:text-3xl">Economic Command</h1>
      <p className="mt-1.5 text-sm text-muted">
        Real assets, real revenue and expense entries you log yourself — nothing here is a projection, a forecast, or
        invented income. An asset starts as an Opportunity (see Objectives) and becomes real once you record it here.
      </p>

      <EconomicCommandClient
        initialAssets={assets.map((a) => ({ ...a, createdAt: a.createdAt.toISOString(), updatedAt: a.updatedAt.toISOString() }))}
        overview={overview}
        opportunities={unpromoted.map((o) => ({ id: o.id, title: o.title }))}
      />
    </div>
  );
}
