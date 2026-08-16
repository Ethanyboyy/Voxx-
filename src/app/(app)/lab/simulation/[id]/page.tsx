import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getSimulation } from "@/lib/lab/simulations";
import { SimulationDetailClient } from "@/components/lab/SimulationDetailClient";

export default async function SimulationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { id } = await params;
  const simulation = await getSimulation(user.id, id);
  if (!simulation) notFound();

  return (
    <SimulationDetailClient
      simulation={{
        id: simulation.id,
        name: simulation.name,
        userMassKg: simulation.userMassKg,
        reactionTimeMs: simulation.reactionTimeMs,
        skillLevel: simulation.skillLevel,
        scenario: {
          name: simulation.scenario.name,
          environment: simulation.scenario.environment,
          objectiveType: simulation.scenario.objectiveType,
          difficulty: simulation.scenario.difficulty,
          description: simulation.scenario.description,
          windMs: simulation.scenario.windMs,
          temperatureC: simulation.scenario.temperatureC,
          gravityMs2: simulation.scenario.gravityMs2,
          obstacleCount: simulation.scenario.obstacleCount,
        },
        suit: simulation.suit
          ? {
              id: simulation.suit.id,
              codename: simulation.suit.codename,
              stats: simulation.suit.currentVersion?.stats
                ? {
                    mobility: simulation.suit.currentVersion.stats.mobility,
                    weightKg: simulation.suit.currentVersion.stats.weightKg,
                    thermalLoadC: simulation.suit.currentVersion.stats.thermalLoadC,
                  }
                : null,
            }
          : null,
        gadgets: simulation.gadgets.map((g) => ({
          id: g.gadget.id,
          name: g.gadget.name,
        })),
        runs: simulation.runs.map((r) => ({
          id: r.id,
          status: r.status,
          seed: r.seed,
          durationS: r.durationS,
          telemetry: r.telemetry,
          peakVelocityMs: r.peakVelocityMs,
          peakForceN: r.peakForceN,
          peakThermalLoadC: r.peakThermalLoadC,
          fatigueEstimatePct: r.fatigueEstimatePct,
          warnings: r.warnings,
          failureAnalysis: r.failureAnalysis,
          summary: r.summary,
          startedAt: r.startedAt.toISOString(),
          completedAt: r.completedAt ? r.completedAt.toISOString() : null,
        })),
      }}
    />
  );
}
