import { getCurrentUser } from "@/lib/auth/session";
import { listExperiments } from "@/lib/projects/service";
import { ExperimentsClient } from "@/components/projects/ExperimentsClient";

export default async function ExperimentsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const experiments = await listExperiments(user.id);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Experiments</h1>
      <p className="mt-1 text-sm text-muted">Hypotheses you&apos;re testing, and what you learned.</p>
      <ExperimentsClient
        initialExperiments={experiments.map((e) => ({
          ...e,
          createdAt: e.createdAt.toISOString(),
          results: e.results.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
        }))}
      />
    </div>
  );
}
