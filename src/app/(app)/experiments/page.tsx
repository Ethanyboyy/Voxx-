import { getCurrentUser } from "@/lib/auth/session";
import { listExperiments } from "@/lib/projects/service";
import { ExperimentsClient } from "@/components/projects/ExperimentsClient";

export default async function ExperimentsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const experiments = await listExperiments(user.id);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <p className="vox-eyebrow">Laboratory</p>
      <h1 className="vox-headline mt-1 text-2xl sm:text-3xl">Experiments</h1>
      <p className="mt-1.5 text-sm text-muted">Hypotheses you&apos;re testing, and what you learned.</p>
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
