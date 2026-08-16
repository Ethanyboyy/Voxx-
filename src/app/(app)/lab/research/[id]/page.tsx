import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getResearchItem } from "@/lib/lab/research";
import { ResearchItemDetailClient } from "@/components/lab/ResearchItemDetailClient";

export default async function ResearchItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { id } = await params;
  const item = await getResearchItem(user.id, id);
  if (!item) notFound();

  return (
    <ResearchItemDetailClient
      item={{
        id: item.id,
        title: item.title,
        category: item.category,
        source: item.source,
        sourceDate: item.sourceDate ? item.sourceDate.toISOString() : null,
        confidence: item.confidence,
        relevance: item.relevance,
        notes: item.notes,
        project: item.project ? { id: item.project.id, name: item.project.name } : null,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      }}
    />
  );
}
