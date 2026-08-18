import { notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getMemory } from "@/lib/memory/service";
import { ensureNodeForEntity, findRelated } from "@/lib/knowledge/service";
import { RelatedGraphPanel } from "@/components/knowledge/RelatedGraphPanel";
import { Card, CardContent } from "@/components/ui/Card";
import { ConfidenceBadge, Badge } from "@/components/ui/Badge";

export default async function MemoryDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;

  const { id } = await params;
  const memory = await getMemory(user.id, id);
  if (!memory) notFound();

  const graphNode = await ensureNodeForEntity(
    user.id,
    "MEMORY",
    memory.id,
    memory.content.length > 80 ? `${memory.content.slice(0, 80)}…` : memory.content,
    memory.category
  );
  const related = await findRelated(user.id, graphNode.id, 1);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <Link href="/memory" className="text-xs text-accent underline underline-offset-2">
        Back to memory
      </Link>
      <p className="vox-eyebrow mt-3">Memory</p>
      <h1 className="vox-headline mt-1 text-2xl sm:text-3xl">Detail</h1>

      <Card className="vox-lift mt-6">
        <CardContent className="flex flex-col gap-3 pt-5">
          <p className="text-sm leading-relaxed text-foreground">{memory.content}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{memory.category.toLowerCase()}</Badge>
            <ConfidenceBadge confidence={memory.confidence} />
            <span className="text-xs text-muted">{new Date(memory.createdAt).toLocaleDateString()}</span>
          </div>
        </CardContent>
      </Card>

      <RelatedGraphPanel related={related} />
    </div>
  );
}
