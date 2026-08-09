import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getProject } from "@/lib/projects/service";
import { ProjectDetailClient } from "@/components/projects/ProjectDetailClient";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;

  const { id } = await params;
  const project = await getProject(user.id, id);
  if (!project) notFound();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">{project.name}</h1>
      {project.description ? <p className="mt-1 text-sm text-muted">{project.description}</p> : null}

      <ProjectDetailClient
        projectId={project.id}
        tasks={project.tasks.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }))}
        goals={project.goals.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() }))}
        decisions={project.decisions.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))}
        ideas={project.ideas.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() }))}
        experiments={project.experiments.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }))}
      />
    </div>
  );
}
