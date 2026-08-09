import { getCurrentUser } from "@/lib/auth/session";
import { listMemories } from "@/lib/memory/service";
import { MemoryClient } from "@/components/memory/MemoryClient";

export default async function MemoryPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const memories = await listMemories(user.id);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Memory</h1>
      <p className="mt-1 text-sm text-muted">
        Everything VOX has stored about you. Inspect, edit, or delete anything — nothing here is hidden.
      </p>
      <MemoryClient
        initialMemories={memories.map((m) => ({
          ...m,
          createdAt: m.createdAt.toISOString(),
          updatedAt: m.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
