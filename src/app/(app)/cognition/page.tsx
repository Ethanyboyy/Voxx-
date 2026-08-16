import { getCurrentUser } from "@/lib/auth/session";
import { getCognitiveProfile } from "@/lib/cognition/profile";
import { listPatterns } from "@/lib/cognition/patterns";
import { listHypotheses } from "@/lib/cognition/service";
import { CognitionClient } from "@/components/cognition/CognitionClient";

export default async function CognitionPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [profile, patterns, hypotheses] = await Promise.all([
    getCognitiveProfile(user.id),
    listPatterns(user.id),
    listHypotheses(user.id),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <p className="vox-eyebrow">Cognition</p>
      <h1 className="vox-headline mt-1 text-2xl text-foreground">Observed patterns, not diagnoses</h1>
      <p className="mt-1.5 text-sm text-muted">
        Observed behavior and derived hypotheses — never diagnoses. Estimates and trends are explicit inferences,
        clearly separated from raw observation counts.
      </p>
      <CognitionClient
        profile={profile}
        patterns={patterns.map((p) => ({ ...p, firstDetectedAt: p.firstDetectedAt.toISOString(), lastDetectedAt: p.lastDetectedAt.toISOString() }))}
        hypotheses={hypotheses.map((h) => ({ ...h, createdAt: h.createdAt.toISOString(), updatedAt: h.updatedAt.toISOString() }))}
      />
    </div>
  );
}
