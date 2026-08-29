import { getCurrentUser } from "@/lib/auth/session";
import { listTasks, listProjects } from "@/lib/projects/service";
import { TasksClient } from "@/components/tasks/TasksClient";
import { RoomHeader } from "@/components/ui/Instrument";

export default async function TasksPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [tasks, projects] = await Promise.all([listTasks(user.id), listProjects(user.id)]);
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <RoomHeader
        system="Execution"
        title="Tasks"
        description={<>Every task across every project, in one place.</>}
      />

      <TasksClient
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        tasks={tasks.map((t) => ({
          id: t.id,
          title: t.title,
          status: t.status,
          priority: t.priority,
          difficulty: t.difficulty,
          estimatedMinutes: t.estimatedMinutes,
          pros: t.pros,
          cons: t.cons,
          projectId: t.projectId,
          projectName: t.projectId ? (projectNameById.get(t.projectId) ?? null) : null,
          createdAt: t.createdAt.toISOString(),
        }))}
      />
    </div>
  );
}
