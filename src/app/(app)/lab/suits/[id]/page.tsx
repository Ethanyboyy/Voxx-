import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getSuit } from "@/lib/lab/suits";
import { getComponentTree } from "@/lib/lab/components";
import { listDesignNotes } from "@/lib/lab/notes";
import { SuitDetailClient } from "@/components/lab/SuitDetailClient";

export default async function SuitDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { id } = await params;
  const suit = await getSuit(user.id, id);
  if (!suit || !suit.currentVersion?.stats) notFound();

  const [components, notes] = await Promise.all([
    getComponentTree({ suitId: id }),
    listDesignNotes(user.id, "LabSuit", id),
  ]);

  return (
    <SuitDetailClient
      suit={{
        id: suit.id,
        codename: suit.codename,
        designation: suit.designation,
        archetype: suit.archetype,
        description: suit.description,
        status: suit.status,
        colorPrimary: suit.colorPrimary,
        colorSecondary: suit.colorSecondary,
        silhouette: suit.silhouette,
        materialLanguage: suit.materialLanguage,
        patternStyle: suit.patternStyle,
        armorLevel: suit.armorLevel,
        maskLensStyle: suit.maskLensStyle,
        currentVersionLabel: suit.currentVersion.label,
        stats: suit.currentVersion.stats,
        versions: suit.versions.map((v) => ({
          id: v.id,
          label: v.label,
          note: v.note,
          createdAt: v.createdAt.toISOString(),
          isCurrent: v.id === suit.currentVersionId,
          stats: v.stats,
        })),
      }}
      components={components}
      notes={notes.map((n) => ({ id: n.id, content: n.content, createdAt: n.createdAt.toISOString() }))}
    />
  );
}
