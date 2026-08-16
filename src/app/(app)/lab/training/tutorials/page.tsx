import { getCurrentUser } from "@/lib/auth/session";
import { listTutorials } from "@/lib/lab/tutorials";
import { TutorialsClient } from "@/components/lab/TutorialsClient";

export default async function TutorialsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const tutorials = await listTutorials(user.id);

  return (
    <div className="vox-panel-in">
      <h1 className="vox-headline text-2xl">Tutorials</h1>
      <p className="mt-1 text-sm text-muted">
        Lesson-and-quiz walkthroughs of lab systems. Complete a tutorial&apos;s quiz to unlock what it gates.
      </p>
      <TutorialsClient
        tutorials={tutorials.map((t) => ({
          id: t.id,
          title: t.title,
          category: t.category,
          difficulty: t.difficulty,
          completed: t.completed,
          score: t.score,
          locked: t.locked,
          prerequisiteTitle: t.prerequisite?.title ?? null,
        }))}
      />
    </div>
  );
}
