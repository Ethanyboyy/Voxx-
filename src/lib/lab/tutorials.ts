import { db } from "@/lib/db";

export async function listTutorials(userId: string, category?: string) {
  const tutorials = await db.labTutorial.findMany({
    where: category ? { category: category as never } : undefined,
    include: { progress: { where: { userId } }, prerequisite: true },
    orderBy: [{ difficulty: "asc" }, { title: "asc" }],
  });
  return tutorials.map((t) => ({
    ...t,
    completed: t.progress[0]?.completed ?? false,
    score: t.progress[0]?.score ?? null,
    locked: Boolean(t.prerequisite && !isPrereqComplete(t.prerequisiteId, tutorials)),
  }));
}

function isPrereqComplete(
  prerequisiteId: string | null,
  all: { id: string; progress: { completed: boolean }[] }[]
): boolean {
  if (!prerequisiteId) return true;
  const prereq = all.find((t) => t.id === prerequisiteId);
  return prereq?.progress[0]?.completed ?? false;
}

export async function getTutorial(userId: string, id: string) {
  const tutorial = await db.labTutorial.findUnique({
    where: { id },
    include: { progress: { where: { userId } }, prerequisite: true, unlocks: true },
  });
  if (!tutorial) return null;
  return { ...tutorial, completed: tutorial.progress[0]?.completed ?? false, score: tutorial.progress[0]?.score ?? null };
}

export async function completeTutorial(userId: string, tutorialId: string, score: number) {
  return db.labTutorialProgress.upsert({
    where: { userId_tutorialId: { userId, tutorialId } },
    create: { userId, tutorialId, completed: true, score, completedAt: new Date() },
    update: { completed: true, score, completedAt: new Date() },
  });
}
