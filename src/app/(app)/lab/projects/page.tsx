import { getCurrentUser } from "@/lib/auth/session";
import { listLabProjects } from "@/lib/lab/projects";
import { LabProjectsClient } from "@/components/lab/LabProjectsClient";

export default async function LabProjectsPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const projects = await listLabProjects(user.id);

  return (
    <div className="vox-panel-in">
      <h1 className="vox-headline text-2xl">Projects</h1>
      <p className="mt-1 text-sm text-muted">
        Group suits, gadgets, web systems, simulations, and experiments under a shared initiative.
      </p>
      <LabProjectsClient
        initialProjects={projects.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          status: p.status,
          counts: {
            suits: p._count.suits,
            gadgets: p._count.gadgets,
            webProfiles: p._count.webProfiles,
            simulations: p._count.simulations,
            experiments: p._count.experiments,
          },
        }))}
      />
    </div>
  );
}
