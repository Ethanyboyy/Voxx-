import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getLabProject } from "@/lib/lab/projects";
import { HolographicPanel, LabSectionLabel, LabStatusBadge } from "@/components/lab/primitives";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function LabProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { id } = await params;
  const project = await getLabProject(user.id, id);
  if (!project) notFound();

  return (
    <div className="vox-panel-in flex flex-col gap-5">
      <div>
        <Link href="/lab/projects" className="text-xs text-muted-foreground hover:text-foreground">
          ← Projects
        </Link>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{project.name}</h1>
          <LabStatusBadge status={project.status} />
        </div>
        {project.description ? <p className="mt-2 max-w-2xl text-sm text-muted">{project.description}</p> : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ProjectSection title="Suits" emptyText="No suits linked to this project yet.">
          {project.suits.map((s) => (
            <Link
              key={s.id}
              href={`/lab/suits/${s.id}`}
              className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover"
            >
              <span className="text-foreground">
                {s.codename} <span className="text-xs text-muted-foreground">· {s.archetype}</span>
              </span>
              <LabStatusBadge status={s.status} />
            </Link>
          ))}
        </ProjectSection>

        <ProjectSection title="Gadgets" emptyText="No gadgets linked to this project yet.">
          {project.gadgets.map((g) => (
            <Link
              key={g.id}
              href={`/lab/engineering/${g.id}`}
              className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover"
            >
              <span className="text-foreground">
                {g.name} <span className="text-xs text-muted-foreground">· {g.category}</span>
              </span>
              <LabStatusBadge status={g.status} />
            </Link>
          ))}
        </ProjectSection>

        <ProjectSection title="Web Systems" emptyText="No web systems linked to this project yet.">
          {project.webProfiles.map((w) => (
            <Link
              key={w.id}
              href={`/lab/web/${w.id}`}
              className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover"
            >
              <span className="text-foreground">{w.name}</span>
              <span className="lab-mono text-[10px] text-muted-foreground">
                {new Date(w.updatedAt).toLocaleDateString()}
              </span>
            </Link>
          ))}
        </ProjectSection>

        <ProjectSection title="Simulations" emptyText="No simulations linked to this project yet.">
          {project.simulations.map((sim) => (
            <Link
              key={sim.id}
              href={`/lab/simulation/${sim.id}`}
              className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover"
            >
              <span className="text-foreground">{sim.name}</span>
              <span className="lab-mono text-[10px] text-muted-foreground">
                {new Date(sim.updatedAt).toLocaleDateString()}
              </span>
            </Link>
          ))}
        </ProjectSection>

        <ProjectSection title="Experiments" emptyText="No experiments linked to this project yet.">
          {project.experiments.map((e) => (
            <Link
              key={e.id}
              href={`/lab/experiments/${e.id}`}
              className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover"
            >
              <span className="text-foreground">
                {e.code} <span className="text-xs text-muted-foreground">· {e.title}</span>
              </span>
              <LabStatusBadge status={e.status} />
            </Link>
          ))}
        </ProjectSection>
      </div>
    </div>
  );
}

function ProjectSection({
  title,
  emptyText,
  children,
}: {
  title: string;
  emptyText: string;
  children: ReactNode[];
}) {
  return (
    <HolographicPanel className="p-4">
      <LabSectionLabel>{title}</LabSectionLabel>
      <div className="mt-3 space-y-1">
        {children.length === 0 ? <EmptyState title={emptyText} /> : children}
      </div>
    </HolographicPanel>
  );
}
