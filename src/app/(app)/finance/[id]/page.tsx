import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getEconomicAsset } from "@/lib/economic/service";
import { EconomicAssetDetailClient } from "@/components/economic/EconomicAssetDetailClient";

export default async function EconomicAssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { id } = await params;
  const asset = await getEconomicAsset(user.id, id);
  if (!asset) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
      <EconomicAssetDetailClient
        asset={{
          id: asset.id,
          name: asset.name,
          category: asset.category,
          status: asset.status,
          description: asset.description,
          totals: asset.totals,
          revenues: asset.revenues.map((r) => ({
            id: r.id,
            amountUsd: r.amountUsd,
            source: r.source,
            occurredAt: r.occurredAt.toISOString(),
            notes: r.notes,
          })),
          expenses: asset.expenses.map((e) => ({
            id: e.id,
            amountUsd: e.amountUsd,
            category: e.category,
            occurredAt: e.occurredAt.toISOString(),
            notes: e.notes,
          })),
        }}
      />
    </div>
  );
}
