import { getCurrentUser } from "@/lib/auth/session";
import { listGadgets } from "@/lib/lab/gadgets";
import { listLabProjects } from "@/lib/lab/projects";
import { EngineeringBayClient } from "@/components/lab/EngineeringBayClient";

export default async function EngineeringBayPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const [gadgets, projects] = await Promise.all([listGadgets(user.id), listLabProjects(user.id)]);

  return (
    <div className="vox-panel-in">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Engineering Bay</h1>
      <p className="mt-1 text-sm text-muted">Design, inspect, and iterate on gadgets.</p>
      <EngineeringBayClient
        initialGadgets={gadgets.map((g) => ({
          id: g.id,
          name: g.name,
          category: g.category,
          status: g.status,
          stats: g.currentVersion?.stats
            ? {
                durability: g.currentVersion.stats.durability,
                sensorAccuracy: g.currentVersion.stats.sensorAccuracy,
                reliability: g.currentVersion.stats.reliability,
                massKg: g.currentVersion.stats.massKg,
                estimatedCostUsd: g.currentVersion.stats.estimatedCostUsd,
              }
            : null,
        }))}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  );
}
