import { db } from "@/lib/db";

/**
 * Component-level costing for the Laboratory.
 *
 * The Lab could not answer "why does this suit cost this much" because only
 * 2 of 224 components carried a cost at all. That is not fixable by typing
 * numbers into rows: invented per-part prices look precise, are unfalsifiable,
 * and are exactly the fabricated precision the engineering rules forbid.
 *
 * So cost is DERIVED, from data the database already holds:
 *   material cost = massKg × LabMaterial.costPerKgUsd
 * 222 of 224 components carry a real mass and all 20 materials carry a real
 * cost per kilogram, so this is a computation over recorded values rather than
 * a guess. Fabrication and labour are then applied as an explicit multiplier
 * per manufacturing route, and every line reports which inputs it actually had.
 *
 * Nothing here is presented as vendor pricing. Every figure is ESTIMATED
 * unless a component carries an explicit stored `costUsd`, which is treated as
 * the authored value and wins.
 */

/** How a figure was arrived at. Mirrors the Lab's existing provenance idiom. */
export type CostBasis = "STORED" | "DERIVED" | "UNKNOWN";

/**
 * Fabrication multipliers applied to raw material cost.
 *
 * These are ratios, not prices, and they encode a single well-known idea: the
 * same kilogram of material costs very different amounts to turn into a part
 * depending on the process. Cut-and-sew is close to material cost; a CNC part
 * throws most of the billet away and pays for machine time.
 */
export const PROCESS_MULTIPLIER: Record<string, number> = {
  CUT_AND_SEW: 2.2,
  THERMOFORM: 3.1,
  INJECTION_MOULD: 2.6,
  COMPOSITE_LAYUP: 5.4,
  CNC: 7.5,
  ASSEMBLY: 3.6,
};

/** Applied when a component names no manufacturing route. */
const DEFAULT_MULTIPLIER = 3.0;

/** Below this the derived figure is noise, so it is reported as a floor. */
const MIN_REPORTABLE_USD = 0.5;

export interface ComponentCost {
  componentId: string;
  name: string;
  subsystem: string | null;
  basis: CostBasis;
  /** Raw material cost, when mass and a material price were both available. */
  materialUsd: number | null;
  /** Material plus fabrication/labour multiplier. */
  totalUsd: number | null;
  /** Multiplier actually applied, so the arithmetic can be shown. */
  processMultiplier: number | null;
  /** Why this line is what it is — surfaced in the UI, not just logged. */
  note: string;
  /** Confidence carried from the component row, untouched. */
  confidence: string | null;
}

export interface SuitCostSummary {
  suitId: string;
  lines: ComponentCost[];
  /** Sum over lines that produced a figure. */
  totalUsd: number;
  /** Components with no figure — reported, never silently treated as zero. */
  unpricedCount: number;
  /** How many lines came from each basis, so coverage is visible. */
  basisCounts: Record<CostBasis, number>;
}

interface CostableComponent {
  id: string;
  name: string;
  subsystem: string | null;
  massKg: number | null;
  costUsd: number | null;
  confidence: string | null;
  material: { costPerKgUsd: number | null; name: string } | null;
}

/**
 * Costs one component.
 *
 * An explicitly stored cost always wins — someone entered it deliberately and
 * a derivation must not overwrite a real number with an estimate.
 */
export function costComponent(component: CostableComponent): ComponentCost {
  const base = {
    componentId: component.id,
    name: component.name,
    subsystem: component.subsystem,
    confidence: component.confidence,
  };

  if (component.costUsd != null) {
    return {
      ...base,
      basis: "STORED",
      materialUsd: null,
      totalUsd: component.costUsd,
      processMultiplier: null,
      note: "Cost recorded on the component; not re-derived.",
    };
  }

  const perKg = component.material?.costPerKgUsd ?? null;
  if (component.massKg == null || perKg == null) {
    const missing = component.massKg == null ? "no mass recorded" : "material has no cost per kg";
    return {
      ...base,
      basis: "UNKNOWN",
      materialUsd: null,
      totalUsd: null,
      processMultiplier: null,
      note: `Not costable: ${missing}.`,
    };
  }

  const materialUsd = component.massKg * perKg;
  const multiplier = multiplierFor(component.subsystem);
  const total = Math.max(materialUsd * multiplier, MIN_REPORTABLE_USD);

  return {
    ...base,
    basis: "DERIVED",
    materialUsd,
    totalUsd: total,
    processMultiplier: multiplier,
    note: `ESTIMATED: ${component.massKg.toFixed(3)} kg ${component.material?.name ?? "material"} at $${perKg.toFixed(2)}/kg, ×${multiplier} for fabrication and labour.`,
  };
}

/**
 * Picks a fabrication multiplier.
 *
 * `subsystem` is the only structured hint most rows carry, so it is used when
 * it names a known process and the neutral default is used otherwise. Guessing
 * a process from a component's NAME was considered and rejected: it would be
 * wrong silently, and a silently wrong multiplier propagates into a suit total
 * that looks authoritative.
 */
function multiplierFor(subsystem: string | null): number {
  if (!subsystem) return DEFAULT_MULTIPLIER;
  return PROCESS_MULTIPLIER[subsystem.toUpperCase()] ?? DEFAULT_MULTIPLIER;
}

/** Costs every component on a suit and rolls the figures up. */
export async function getSuitCost(userId: string, suitId: string): Promise<SuitCostSummary> {
  const components = await db.labComponent.findMany({
    where: { suitId, suit: { userId } },
    select: {
      id: true,
      name: true,
      subsystem: true,
      massKg: true,
      costUsd: true,
      confidence: true,
      material: { select: { costPerKgUsd: true, name: true } },
    },
    orderBy: { order: "asc" },
  });

  const lines = components.map(costComponent);
  const basisCounts: Record<CostBasis, number> = { STORED: 0, DERIVED: 0, UNKNOWN: 0 };
  let totalUsd = 0;
  let unpricedCount = 0;

  for (const line of lines) {
    basisCounts[line.basis] += 1;
    if (line.totalUsd == null) unpricedCount += 1;
    else totalUsd += line.totalUsd;
  }

  return { suitId, lines, totalUsd, unpricedCount, basisCounts };
}
