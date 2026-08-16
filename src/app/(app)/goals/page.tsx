import { getCurrentUser } from "@/lib/auth/session";
import { listGoals, listProjects } from "@/lib/projects/service";
import { GoalsClient } from "@/components/goals/GoalsClient";

export default async function GoalsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [goals, projects] = await Promise.all([listGoals(user.id), listProjects(user.id)]);
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <p className="vox-eyebrow">Execution</p>
      <h1 className="vox-headline mt-1 text-2xl sm:text-3xl">Goals</h1>
      <p className="mt-1.5 text-sm text-muted">Every goal across every project, in one place.</p>

      <GoalsClient
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        goals={goals.map((g) => ({
          id: g.id,
          title: g.title,
          description: g.description,
          status: g.status,
          targetDate: g.targetDate ? g.targetDate.toISOString() : null,
          projectId: g.projectId,
          projectName: g.projectId ? (projectNameById.get(g.projectId) ?? null) : null,
          createdAt: g.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
