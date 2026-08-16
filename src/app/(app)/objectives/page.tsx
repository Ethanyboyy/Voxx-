import { getCurrentUser } from "@/lib/auth/session";
import { listObjectives, listOpportunities } from "@/lib/objectives/service";
import { ObjectivesClient } from "@/components/objectives/ObjectivesClient";

export default async function ObjectivesPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [objectives, opportunities] = await Promise.all([listObjectives(user.id), listOpportunities(user.id)]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <p className="vox-eyebrow">Intelligence</p>
      <h1 className="vox-headline mt-1 text-2xl sm:text-3xl">Objectives</h1>
      <p className="mt-1.5 text-sm text-muted">
        What VOX is actually helping you pursue right now. Real objectives, real opportunities — nothing here is
        invented progress or a fake revenue number.
      </p>

      <ObjectivesClient
        objectives={objectives.map((o) => ({
          id: o.id,
          title: o.title,
          description: o.description,
          strategy: o.strategy,
          assumptions: o.assumptions,
          targetValue: o.targetValue,
          targetUnit: o.targetUnit,
          currentValue: o.currentValue,
          targetDate: o.targetDate ? o.targetDate.toISOString() : null,
          status: o.status,
          createdAt: o.createdAt.toISOString(),
        }))}
        opportunities={opportunities.map((o) => ({
          id: o.id,
          objectiveId: o.objectiveId,
          title: o.title,
          description: o.description,
          estimatedValue: o.estimatedValue,
          effort: o.effort,
          confidence: o.confidence,
          risk: o.risk,
          nextAction: o.nextAction,
          status: o.status,
        }))}
      />
    </div>
  );
}
