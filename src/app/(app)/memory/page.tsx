import { getCurrentUser } from "@/lib/auth/session";
import { listMemories } from "@/lib/memory/service";
import { MemoryClient } from "@/components/memory/MemoryClient";
import { RoomHeader } from "@/components/ui/Instrument";

export default async function MemoryPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const memories = await listMemories(user.id);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <RoomHeader
        system="Memory"
        title="Everything VOX remembers"
        description={<>Everything VOX has stored about you. Inspect, edit, or delete anything — nothing here is hidden.</>}
      />
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
