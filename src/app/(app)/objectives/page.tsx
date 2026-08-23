import { getCurrentUser } from "@/lib/auth/session";
import { listObjectives, listOpportunities, scoreOpportunity, explainOpportunityScore } from "@/lib/objectives/service";
import { listSupervisorRuns } from "@/lib/supervisor/service";
import { ObjectivesClient } from "@/components/objectives/ObjectivesClient";

export default async function ObjectivesPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [objectives, opportunities, supervisorRuns] = await Promise.all([
    listObjectives(user.id),
    listOpportunities(user.id),
    listSupervisorRuns(user.id),
  ]);

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
        opportunities={opportunities.map((o) => {
          const breakdown = explainOpportunityScore(o);
          return {
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
            score: scoreOpportunity(o),
            scoreBreakdown: breakdown,
            category: o.category,
            estimatedStartupCost: o.estimatedStartupCost,
            estimatedTimeToRevenueDays: o.estimatedTimeToRevenueDays,
          };
        })}
        supervisorRuns={supervisorRuns.map((s) => ({
          id: s.id,
          objectiveId: s.objectiveId,
          status: s.status,
          iterations: s.iterations,
          maxIterations: s.maxIterations,
          result: s.result,
          error: s.error,
          plan: s.plan,
          createdAt: s.createdAt.toISOString(),
          updatedAt: s.updatedAt.toISOString(),
          agentRuns: s.agentRuns.map((r) => ({
            id: r.id,
            status: r.status,
            error: r.error,
            steps: r.steps.map((step) => ({
              id: step.id,
              order: step.order,
              description: step.description,
              toolName: step.toolName,
              status: step.status,
              capability: step.capability,
              requiredLevel: step.requiredLevel,
              error: step.error,
            })),
          })),
        }))}
      />
    </div>
  );
}
