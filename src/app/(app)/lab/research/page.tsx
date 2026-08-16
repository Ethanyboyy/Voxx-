import { getCurrentUser } from "@/lib/auth/session";
import { listResearchItems } from "@/lib/lab/research";
import { listLabProjects } from "@/lib/lab/projects";
import { ResearchEngineClient } from "@/components/lab/ResearchEngineClient";

export default async function ResearchPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [items, projects] = await Promise.all([listResearchItems(user.id), listLabProjects(user.id)]);

  return (
    <div className="vox-panel-in">
      <h1 className="vox-headline text-2xl">Research Engine</h1>
      <p className="mt-1 text-sm text-muted">
        Track materials, physics, and engineering findings — real sources feeding real design decisions.
      </p>
      <ResearchEngineClient
        initialItems={items.map((item) => ({
          id: item.id,
          title: item.title,
          category: item.category,
          source: item.source,
          sourceDate: item.sourceDate ? item.sourceDate.toISOString() : null,
          confidence: item.confidence,
          relevance: item.relevance,
          notes: item.notes,
          projectName: item.project?.name ?? null,
          updatedAt: item.updatedAt.toISOString(),
        }))}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
      />
    </div>
  );
}
