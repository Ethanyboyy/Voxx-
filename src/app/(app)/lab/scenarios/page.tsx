import { getCurrentUser } from "@/lib/auth/session";
import { listScenarios } from "@/lib/lab/scenarios";
import { ScenarioGeneratorClient } from "@/components/lab/ScenarioGeneratorClient";

export default async function ScenarioGeneratorPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const scenarios = await listScenarios(user.id);

  return (
    <div className="vox-panel-in">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Scenario Generator</h1>
      <p className="mt-1 text-sm text-muted">
        Seeded and custom environmental scenarios for simulations and training sessions.
      </p>
      <ScenarioGeneratorClient
        initialScenarios={scenarios.map((s) => ({
          id: s.id,
          name: s.name,
          environment: s.environment,
          objectiveType: s.objectiveType,
          difficulty: s.difficulty,
          description: s.description,
          timeOfDay: s.timeOfDay,
          precipitation: s.precipitation,
          windMs: s.windMs,
          temperatureC: s.temperatureC,
          fogPercent: s.fogPercent,
          gravityMs2: s.gravityMs2,
          surfaceType: s.surfaceType,
          elevationM: s.elevationM,
          obstacleCount: s.obstacleCount,
          isCustom: s.isCustom,
        }))}
      />
    </div>
  );
}
