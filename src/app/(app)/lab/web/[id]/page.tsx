import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getWebProfile } from "@/lib/lab/webLab";
import { WebProfileDetailClient } from "@/components/lab/WebProfileDetailClient";

export default async function WebProfileDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { id } = await params;
  const profile = await getWebProfile(user.id, id);
  if (!profile || !profile.material || !profile.deployment || !profile.attachment) notFound();

  return (
    <WebProfileDetailClient
      profile={{
        id: profile.id,
        name: profile.name,
        description: profile.description,
        material: profile.material,
        deployment: profile.deployment,
        attachment: profile.attachment,
        loadModels: profile.loadModels.map((m) => ({
          id: m.id,
          label: m.label,
          userMassKg: m.userMassKg,
          equipmentMassKg: m.equipmentMassKg,
          swingRadiusM: m.swingRadiusM,
          velocityMs: m.velocityMs,
          staticLoadN: m.staticLoadN,
          dynamicLoadN: m.dynamicLoadN,
          accelerationMs2: m.accelerationMs2,
          forceN: m.forceN,
          tensionN: m.tensionN,
          safetyMarginPct: m.safetyMarginPct,
          confidence: m.confidence,
          createdAt: m.createdAt.toISOString(),
        })),
      }}
    />
  );
}
