import { getCurrentUser } from "@/lib/auth/session";
import { listTrainingModules, getTrainingProgress } from "@/lib/lab/training";
import { TrainingCenterClient } from "@/components/lab/TrainingCenterClient";

export default async function TrainingCenterPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [modules, progress] = await Promise.all([listTrainingModules(), getTrainingProgress(user.id)]);

  return (
    <div className="vox-panel-in">
      <h1 className="vox-headline text-2xl">Training Center</h1>
      <p className="mt-1 text-sm text-muted">
        Reaction, movement, and awareness drills against simulated conditions — no combat instruction.
      </p>
      <TrainingCenterClient
        modules={modules.map((m) => ({
          id: m.id,
          name: m.name,
          category: m.category,
          difficulty: m.difficulty,
          description: m.description,
          objective: m.objective,
          durationMinutesEstimate: m.durationMinutesEstimate,
        }))}
        progress={{
          totalSessions: progress.totalSessions,
          byCategory: progress.byCategory,
          recent: progress.recent.map((s) => ({
            id: s.id,
            score: s.score,
            createdAt: s.createdAt.toISOString(),
            module: { name: s.module.name },
          })),
        }}
      />
    </div>
  );
}
