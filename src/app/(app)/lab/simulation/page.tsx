import { getCurrentUser } from "@/lib/auth/session";
import { listSimulations } from "@/lib/lab/simulations";
import { listScenarios } from "@/lib/lab/scenarios";
import { listSuits } from "@/lib/lab/suits";
import { listGadgets } from "@/lib/lab/gadgets";
import { listLabProjects } from "@/lib/lab/projects";
import { SimulationCenterClient } from "@/components/lab/SimulationCenterClient";

export default async function SimulationCenterPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [simulations, scenarios, suits, gadgets, projects] = await Promise.all([
    listSimulations(user.id),
    listScenarios(user.id),
    listSuits(user.id),
    listGadgets(user.id),
    listLabProjects(user.id),
  ]);

  return (
    <div className="vox-panel-in">
      <h1 className="vox-headline text-2xl">Simulation Center</h1>
      <p className="mt-1 text-sm text-muted">
        Select a scenario, run a deterministic physics simulation, and see the telemetry. Running a simulation
        saves it — every run is persisted as history.
      </p>
      <SimulationCenterClient
        initialSimulations={simulations.map((s) => {
          const lastRun = s.runs[0];
          return {
            id: s.id,
            name: s.name,
            scenarioName: s.scenario.name,
            suitCodename: s.suit?.codename ?? null,
            lastRun: lastRun
              ? {
                  id: lastRun.id,
                  summary: lastRun.summary,
                  peakVelocityMs: lastRun.peakVelocityMs,
                  status: lastRun.status,
                  createdAt: lastRun.createdAt.toISOString(),
                }
              : null,
          };
        })}
        scenarios={scenarios.map((sc) => ({
          id: sc.id,
          name: sc.name,
          environment: sc.environment,
          difficulty: sc.difficulty,
          isCustom: sc.isCustom,
        }))}
        suits={suits.map((s) => ({ id: s.id, codename: s.codename }))}
        gadgets={gadgets.map((g) => ({ id: g.id, name: g.name }))}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  );
}
