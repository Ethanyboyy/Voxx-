import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { listResearchItems } from "@/lib/research/service";
import { listMemoriesByProvenance } from "@/lib/memory/service";
import { EXPERIENCE_PROVENANCE } from "@/lib/cognition/experience";
import { ResearchClient } from "@/components/research/ResearchClient";
import { RoomHeader, InstrumentPanel, PanelHeader, Readout, Seam } from "@/components/ui/Instrument";
import { ConfidenceBadge } from "@/components/ui/Badge";

export default async function ResearchPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [items, findings] = await Promise.all([
    listResearchItems(user.id),
    listMemoriesByProvenance(user.id, [EXPERIENCE_PROVENANCE.RESEARCH_FINDINGS], 5),
  ]);

  const sourced = items.filter((i) => i.sourceUrl != null);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <RoomHeader
        system="Grounded lookups"
        title="Research"
        description={
          <>
            Every result keeps its source, retrieval time, relevance, and confidence — nothing here is presented as
            verified fact without those attached. Completed lookups are also written into memory, so what VOX finds
            reaches the next plan it makes instead of stopping at this page.
          </>
        }
      />

      {/* What research has actually contributed — real counts, no estimates. */}
      <InstrumentPanel className="mt-6 pb-5" registration>
        <PanelHeader
          eyebrow="Retrieval record"
          title="What research has contributed"
          description="Counted directly from stored records."
        />
        <div className="mt-3 grid grid-cols-3 gap-4 px-5">
          <Readout label="Sources stored" value={String(items.length)} />
          <Readout label="With a source URL" value={String(sourced.length)} note="the rest reported none" />
          <Readout label="Written to memory" value={String(findings.length)} note="most recent lookups" />
        </div>

        {findings.length > 0 ? (
          <>
            <Seam className="mx-5 mt-5" />
            <div className="px-5 pt-4">
              <div className="flex items-center justify-between gap-3">
                <p className="vox-eyebrow">Reaching the planner</p>
                <Link href="/memory" className="vox-press vox-unit hover:text-foreground">
                  Memory
                </Link>
              </div>
              <ul className="mt-2.5 flex flex-col gap-2">
                {findings.map((f) => (
                  <li key={f.id} className="instrument-well px-3.5 py-3">
                    <div className="flex items-center gap-2">
                      <span className="vox-unit">research</span>
                      <ConfidenceBadge confidence={f.confidence} />
                    </div>
                    <p className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-muted">{f.content}</p>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}
      </InstrumentPanel>

      <ResearchClient initialItems={items.map((i) => ({ ...i, retrievedAt: i.retrievedAt.toISOString() }))} />
    </div>
  );
}
