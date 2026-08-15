import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getTrainingModule, listTrainingSessions } from "@/lib/lab/training";
import { TrainingSessionClient } from "@/components/lab/TrainingSessionClient";

export default async function TrainingModulePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { id } = await params;

  const trainingModule = await getTrainingModule(id);
  if (!trainingModule) notFound();

  const sessions = await listTrainingSessions(user.id, id);

  return (
    <TrainingSessionClient
      module={{
        id: trainingModule.id,
        name: trainingModule.name,
        category: trainingModule.category,
        difficulty: trainingModule.difficulty,
        description: trainingModule.description,
        objective: trainingModule.objective,
        durationMinutesEstimate: trainingModule.durationMinutesEstimate,
      }}
      initialSessions={sessions.map((s) => ({
        id: s.id,
        score: s.score,
        reactionTimeMs: s.reactionTimeMs,
        completionTimeS: s.completionTimeS,
        movementEfficiencyPercent: s.movementEfficiencyPercent,
        staminaUsedPercent: s.staminaUsedPercent,
        balanceScore: s.balanceScore,
        accuracyPercent: s.accuracyPercent,
        decisionQualityPercent: s.decisionQualityPercent,
        defensiveSuccessPercent: s.defensiveSuccessPercent,
        mistakes: s.mistakes,
        notes: s.notes,
        when: (s.completedAt ?? s.startedAt).toISOString(),
      }))}
    />
  );
}
