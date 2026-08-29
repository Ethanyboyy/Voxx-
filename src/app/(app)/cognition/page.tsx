import { getCurrentUser } from "@/lib/auth/session";
import { getCognitiveProfile } from "@/lib/cognition/profile";
import { listPatterns } from "@/lib/cognition/patterns";
import { listHypotheses } from "@/lib/cognition/service";
import { CognitionClient } from "@/components/cognition/CognitionClient";
import { RoomHeader } from "@/components/ui/Instrument";

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
      <RoomHeader
        system="Cognition"
        title="Observed patterns, not diagnoses"
        description={<>Observed behavior and derived hypotheses — never diagnoses. Estimates and trends are explicit inferences, clearly separated from raw observation counts.</>}
      />
      <CognitionClient
        profile={profile}
        patterns={patterns.map((p) => ({ ...p, firstDetectedAt: p.firstDetectedAt.toISOString(), lastDetectedAt: p.lastDetectedAt.toISOString() }))}
        hypotheses={hypotheses.map((h) => ({ ...h, createdAt: h.createdAt.toISOString(), updatedAt: h.updatedAt.toISOString() }))}
      />
    </div>
  );
}
