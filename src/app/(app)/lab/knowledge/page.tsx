import { db } from "@/lib/db";
import { HolographicPanel, LabSectionLabel, ConfidenceTag } from "@/components/lab/primitives";

const CONFIDENCE_ORDER = ["VERIFIED", "ESTIMATED", "HYPOTHETICAL", "UNKNOWN"] as const;

const CONFIDENCE_DESCRIPTION: Record<(typeof CONFIDENCE_ORDER)[number], string> = {
  VERIFIED: "Backed by a real, checkable source — a measured spec, a physical test, a published reference.",
  ESTIMATED: "A reasoned engineering estimate from known parameters, not directly measured or sourced.",
  HYPOTHETICAL: "A theoretical figure for research not yet grounded in a real material, test, or build.",
  UNKNOWN: "No confidence has been assigned — treat the figure as a placeholder.",
};

interface ConfidenceCounts {
  VERIFIED: number;
  ESTIMATED: number;
  HYPOTHETICAL: number;
  UNKNOWN: number;
}

function toCounts(rows: { confidence: string; count: number }[]): ConfidenceCounts {
  const counts: ConfidenceCounts = { VERIFIED: 0, ESTIMATED: 0, HYPOTHETICAL: 0, UNKNOWN: 0 };
  for (const row of rows) {
    if (row.confidence in counts) counts[row.confidence as keyof ConfidenceCounts] = row.count;
  }
  return counts;
}

function CountBar({ label, counts }: { label: string; counts: ConfidenceCounts }) {
  const total = CONFIDENCE_ORDER.reduce((sum, c) => sum + counts[c], 0);
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-foreground">{label}</span>
        <span className="lab-mono text-xs text-muted-foreground">{total} record{total === 1 ? "" : "s"}</span>
      </div>
      {total === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">No records yet.</p>
      ) : (
        <>
          <div className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-surface-hover">
            {CONFIDENCE_ORDER.map((c) => {
              const pct = (counts[c] / total) * 100;
              if (pct === 0) return null;
              const color =
                c === "VERIFIED"
                  ? "bg-success"
                  : c === "ESTIMATED"
                    ? "bg-[var(--accent-blue)]"
                    : c === "HYPOTHETICAL"
                      ? "bg-warning"
                      : "bg-muted-foreground";
              return <div key={c} className={color} style={{ width: `${pct}%` }} title={`${c}: ${counts[c]}`} />;
            })}
          </div>
          <div className="lab-mono mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
            {CONFIDENCE_ORDER.map((c) => (
              <span key={c}>
                {c.charAt(0) + c.slice(1).toLowerCase()}: {counts[c]}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default async function KnowledgePage() {
  const [suitStatsRows, gadgetStatsRows, materialRows, webMaterialRows] = await Promise.all([
    db.labSuitStats.groupBy({ by: ["confidence"], _count: true }),
    db.labGadgetStats.groupBy({ by: ["confidence"], _count: true }),
    db.labMaterial.groupBy({ by: ["confidence"], _count: true }),
    db.labWebMaterial.groupBy({ by: ["confidence"], _count: true }),
  ]);

  const suitStats = toCounts(suitStatsRows.map((r) => ({ confidence: r.confidence, count: r._count })));
  const gadgetStats = toCounts(gadgetStatsRows.map((r) => ({ confidence: r.confidence, count: r._count })));
  const materials = toCounts(materialRows.map((r) => ({ confidence: r.confidence, count: r._count })));
  const webMaterials = toCounts(webMaterialRows.map((r) => ({ confidence: r.confidence, count: r._count })));

  const grandTotal =
    CONFIDENCE_ORDER.reduce((s, c) => s + suitStats[c] + gadgetStats[c] + materials[c] + webMaterials[c], 0);

  return (
    <div className="vox-panel-in flex flex-col gap-5">
      <div>
        <h1 className="vox-headline text-2xl">Data / Knowledge</h1>
        <p className="mt-1 text-sm text-muted">
          Every engineering figure in the Laboratory carries an explicit confidence level. Nothing here is
          silently upgraded from a guess to a fact.
        </p>
      </div>

      <HolographicPanel className="p-4">
        <LabSectionLabel>Confidence Framework</LabSectionLabel>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CONFIDENCE_ORDER.map((c) => (
            <div key={c} className="instrument instrument-sheen flex flex-col gap-2 p-3">
              <ConfidenceTag confidence={c} />
              <p className="text-xs text-muted">{CONFIDENCE_DESCRIPTION[c]}</p>
            </div>
          ))}
        </div>
      </HolographicPanel>

      <HolographicPanel className="p-4">
        <div className="flex items-center justify-between">
          <LabSectionLabel>Lab-Wide Breakdown</LabSectionLabel>
          <span className="lab-mono text-xs text-muted-foreground">{grandTotal} total records</span>
        </div>
        <div className="mt-4 flex flex-col gap-5">
          <CountBar label="Suit Stats (LabSuitStats)" counts={suitStats} />
          <CountBar label="Gadget Stats (LabGadgetStats)" counts={gadgetStats} />
          <CountBar label="Materials (LabMaterial)" counts={materials} />
          <CountBar label="Web Materials (LabWebMaterial)" counts={webMaterials} />
        </div>
        <p className="mt-4 text-[10px] text-muted-foreground">
          Counts are queried live from the database on every page load and reflect real persisted rows, not
          illustrative data. This is a lab-wide view (not scoped per-user) — a personal single-user instance.
        </p>
      </HolographicPanel>
    </div>
  );
}
