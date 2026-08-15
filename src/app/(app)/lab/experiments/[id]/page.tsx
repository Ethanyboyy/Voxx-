import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getExperiment } from "@/lib/lab/experiments";
import { ExperimentDetailClient } from "@/components/lab/ExperimentDetailClient";

export default async function ExperimentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { id } = await params;
  const experiment = await getExperiment(user.id, id);
  if (!experiment) notFound();

  return (
    <ExperimentDetailClient
      experiment={{
        id: experiment.id,
        code: experiment.code,
        title: experiment.title,
        hypothesis: experiment.hypothesis,
        objective: experiment.objective,
        variables: experiment.variables,
        equipmentNotes: experiment.equipmentNotes,
        environmentNotes: experiment.environmentNotes,
        expectedOutcome: experiment.expectedOutcome,
        status: experiment.status,
        confidence: experiment.confidence,
        nextIteration: experiment.nextIteration,
        suit: experiment.suit
          ? {
              id: experiment.suit.id,
              codename: experiment.suit.codename,
              stats: experiment.suit.currentVersion?.stats
                ? { mobility: experiment.suit.currentVersion.stats.mobility, durability: experiment.suit.currentVersion.stats.durability }
                : null,
            }
          : null,
        simulationRun: experiment.simulationRun
          ? {
              id: experiment.simulationRun.id,
              simulationId: experiment.simulationRun.simulationId,
              summary: experiment.simulationRun.summary,
            }
          : null,
        results: experiment.results.map((r) => ({
          id: r.id,
          outcome: r.outcome,
          learnings: r.learnings,
          confidence: r.confidence,
          createdAt: r.createdAt.toISOString(),
        })),
      }}
    />
  );
}
