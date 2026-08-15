import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getTutorial } from "@/lib/lab/tutorials";
import { TutorialDetailClient } from "@/components/lab/TutorialDetailClient";

export default async function TutorialDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { id } = await params;

  const tutorial = await getTutorial(user.id, id);
  if (!tutorial) notFound();

  return (
    <TutorialDetailClient
      tutorial={{
        id: tutorial.id,
        title: tutorial.title,
        category: tutorial.category,
        difficulty: tutorial.difficulty,
        lesson: tutorial.lesson,
        demonstration: tutorial.demonstration,
        exercisePrompt: tutorial.exercisePrompt,
        quiz: tutorial.quiz,
        completed: tutorial.completed,
        score: tutorial.score,
        prerequisiteTitle: tutorial.prerequisite?.title ?? null,
        unlocks: tutorial.unlocks.map((u) => ({ id: u.id, title: u.title })),
      }}
    />
  );
}
