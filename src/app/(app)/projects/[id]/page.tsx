import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getProject, parseStringArray } from "@/lib/projects/service";
import { ProjectDetailClient } from "@/components/projects/ProjectDetailClient";
import { ensureNodeForEntity, findRelated } from "@/lib/knowledge/service";
import { RelatedGraphPanel } from "@/components/knowledge/RelatedGraphPanel";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;

  const { id } = await params;
  const project = await getProject(user.id, id);
  if (!project) notFound();

  const graphNode = await ensureNodeForEntity(user.id, "PROJECT", project.id, project.name, project.description ?? undefined);
  const related = await findRelated(user.id, graphNode.id, 1);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <p className="vox-eyebrow">Project</p>
      <h1 className="vox-headline mt-1 text-2xl sm:text-3xl">{project.name}</h1>
      {project.description ? <p className="mt-1.5 text-sm text-muted">{project.description}</p> : null}

      <ProjectDetailClient
        projectId={project.id}
        tasks={project.tasks.map((t) => ({
          ...t,
          createdAt: t.createdAt.toISOString(),
          pros: parseStringArray(t.pros),
          cons: parseStringArray(t.cons),
        }))}
        goals={project.goals.map((g) => ({ ...g, createdAt: g.createdAt.toISOString() }))}
        decisions={project.decisions.map((d) => ({ ...d, createdAt: d.createdAt.toISOString() }))}
        ideas={project.ideas.map((i) => ({ ...i, createdAt: i.createdAt.toISOString() }))}
        experiments={project.experiments.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }))}
      />

      <RelatedGraphPanel related={related} />
    </div>
  );
}
