import { getCurrentUser } from "@/lib/auth/session";
import { listResearchItems } from "@/lib/research/service";
import { ResearchClient } from "@/components/research/ResearchClient";

export default async function ResearchPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const items = await listResearchItems(user.id);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Research</h1>
      <p className="mt-1 text-sm text-muted">
        Every result keeps its source, retrieval time, relevance, and confidence — nothing here is presented as
        verified fact without those attached.
      </p>
      <ResearchClient
        initialItems={items.map((i) => ({ ...i, retrievedAt: i.retrievedAt.toISOString() }))}
      />
    </div>
  );
}
