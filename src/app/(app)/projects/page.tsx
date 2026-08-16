import { getCurrentUser } from "@/lib/auth/session";
import { listProjects } from "@/lib/projects/service";
import { ProjectsClient } from "@/components/projects/ProjectsClient";

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const projects = await listProjects(user.id);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <p className="vox-eyebrow">Execution</p>
      <h1 className="vox-headline mt-1 text-2xl sm:text-3xl">Projects</h1>
      <p className="mt-1.5 text-sm text-muted">Everything VOX is helping you build or move forward.</p>
      <ProjectsClient
        initialProjects={projects.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
