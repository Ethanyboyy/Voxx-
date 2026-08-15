import { notFound } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getGadget } from "@/lib/lab/gadgets";
import { getComponentTree } from "@/lib/lab/components";
import { listDesignNotes } from "@/lib/lab/notes";
import { GadgetDetailClient } from "@/components/lab/GadgetDetailClient";

export default async function GadgetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return null;
  const { id } = await params;
  const gadget = await getGadget(user.id, id);
  if (!gadget || !gadget.currentVersion?.stats) notFound();

  const [components, notes] = await Promise.all([
    getComponentTree({ gadgetId: id }),
    listDesignNotes(user.id, "LabGadget", id),
  ]);

  return (
    <GadgetDetailClient
      gadget={{
        id: gadget.id,
        name: gadget.name,
        category: gadget.category,
        description: gadget.description,
        status: gadget.status,
        currentVersionLabel: gadget.currentVersion.label,
        stats: gadget.currentVersion.stats,
        versions: gadget.versions.map((v) => ({
          id: v.id,
          label: v.label,
          note: v.note,
          createdAt: v.createdAt.toISOString(),
          isCurrent: v.id === gadget.currentVersionId,
          stats: v.stats,
        })),
      }}
      components={components}
      notes={notes.map((n) => ({ id: n.id, content: n.content, createdAt: n.createdAt.toISOString() }))}
    />
  );
}
