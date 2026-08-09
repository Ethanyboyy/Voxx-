import { getCurrentUser } from "@/lib/auth/session";
import { listProjects } from "@/lib/projects/service";
import { ProjectsClient } from "@/components/projects/ProjectsClient";

export default async function ProjectsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const projects = await listProjects(user.id);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Projects</h1>
      <p className="mt-1 text-sm text-muted">Everything VOX is helping you build or move forward.</p>
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
