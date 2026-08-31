import { getCurrentUser } from "@/lib/auth/session";
import { listSuits } from "@/lib/lab/suits";
import { listLabProjects } from "@/lib/lab/projects";
import { getBrainState } from "@/lib/brain/graph";
import { SuitBayRouteClient } from "@/components/lab/SuitBayRouteClient";

export default async function SuitBayPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  // The room's lighting responds to what VOX is actually doing, so the Suit Bay
  // reads the same real cognitive state the Brain does rather than inventing a
  // mood of its own.
  const [suits, projects, brain] = await Promise.all([
    listSuits(user.id),
    listLabProjects(user.id),
    getBrainState(user.id),
  ]);

  return (
    <SuitBayRouteClient
      brainState={brain.state}
      suits={suits.map((s) => ({
        id: s.id,
        codename: s.codename,
        designation: s.designation,
        archetype: s.archetype,
        status: s.status,
        realityStatus: s.realityStatus,
        modelUrl: s.modelUrl,
        colorPrimary: s.colorPrimary,
        colorSecondary: s.colorSecondary,
        silhouette: s.silhouette,
        materialLanguage: s.materialLanguage,
        patternStyle: s.patternStyle,
        armorLevel: s.armorLevel,
        maskLensStyle: s.maskLensStyle,
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
  );
}
