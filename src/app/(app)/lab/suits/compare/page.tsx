import { getCurrentUser } from "@/lib/auth/session";
import { compareSuits } from "@/lib/lab/suits";
import { EmptyState } from "@/components/ui/EmptyState";
import { SuitCompareClient } from "@/components/lab/SuitCompareClient";

export default async function SuitComparePage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { ids } = await searchParams;
  const idList = (ids ?? "").split(",").filter(Boolean);

  if (idList.length < 2) {
    return (
      <div className="vox-panel-in">
        <h1 className="vox-headline text-2xl">Compare Suits</h1>
        <div className="mt-6">
          <EmptyState title="Select at least two suits" description="Go to Suit Bay and select suits to compare." />
        </div>
      </div>
    );
  }

  const suits = await compareSuits(user.id, idList);

  return (
    <div className="vox-panel-in">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Compare Suits</h1>
      <p className="mt-1 text-sm text-muted">Side-by-side statistics, strengths, and differences.</p>
      <SuitCompareClient
        suits={suits
          .filter((s) => s.currentVersion?.stats)
          .map((s) => ({
            id: s.id,
            codename: s.codename,
            archetype: s.archetype,
            colorPrimary: s.colorPrimary,
            colorSecondary: s.colorSecondary,
            silhouette: s.silhouette,
            materialLanguage: s.materialLanguage,
            patternStyle: s.patternStyle,
            armorLevel: s.armorLevel,
            maskLensStyle: s.maskLensStyle,
            componentCount: s.components.length,
            stats: s.currentVersion!.stats!,
          }))}
      />
    </div>
  );
}
