import { getCurrentUser } from "@/lib/auth/session";
import { listSuits } from "@/lib/lab/suits";
import { listLabProjects } from "@/lib/lab/projects";
import { SuitBayClient } from "@/components/lab/SuitBayClient";

export default async function SuitBayPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const [suits, projects] = await Promise.all([listSuits(user.id), listLabProjects(user.id)]);

  return (
    <div className="vox-panel-in">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Suit Bay</h1>
      <p className="mt-1 text-sm text-muted">Design, inspect, compare, and simulate suits.</p>
      <SuitBayClient
        initialSuits={suits.map((s) => ({
          id: s.id,
          codename: s.codename,
          designation: s.designation,
          archetype: s.archetype,
          status: s.status,
          colorPrimary: s.colorPrimary,
          colorSecondary: s.colorSecondary,
          stats: s.currentVersion?.stats
            ? {
                stealth: s.currentVersion.stats.stealth,
                durability: s.currentVersion.stats.durability,
                mobility: s.currentVersion.stats.mobility,
                weightKg: s.currentVersion.stats.weightKg,
                estimatedCostUsd: s.currentVersion.stats.estimatedCostUsd,
              }
            : null,
        }))}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  );
}
