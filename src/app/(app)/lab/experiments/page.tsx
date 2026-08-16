import { getCurrentUser } from "@/lib/auth/session";
import { listExperiments } from "@/lib/lab/experiments";
import { listSuits } from "@/lib/lab/suits";
import { listLabProjects } from "@/lib/lab/projects";
import { ExperimentsClient } from "@/components/lab/ExperimentsClient";

export default async function ExperimentsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [experiments, suits, projects] = await Promise.all([
    listExperiments(user.id),
    listSuits(user.id),
    listLabProjects(user.id),
  ]);

  return (
    <div className="vox-panel-in">
      <h1 className="vox-headline text-2xl">Experiments</h1>
      <p className="mt-1 text-sm text-muted">Hypothesis-driven iteration — plan, run, and record real outcomes.</p>
      <ExperimentsClient
        initialExperiments={experiments.map((e) => ({
          id: e.id,
          code: e.code,
          title: e.title,
          hypothesis: e.hypothesis,
          status: e.status,
          confidence: e.confidence,
          suitCodename: e.suit?.codename ?? null,
          resultCount: e.results.length,
          updatedAt: e.updatedAt.toISOString(),
        }))}
        suits={suits.map((s) => ({ id: s.id, codename: s.codename }))}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  );
}
