/**
 * Engineering data for inspectable components.
 *
 * The rule this module exists to enforce: **a number shown next to a component
 * must say where it came from.** A mass that was weighed, a mass that fell out
 * of a simulation, a mass someone estimated, and a mass that is a design target
 * nobody has hit yet are four different claims, and an interface that renders
 * all four identically is lying by omission — convincingly, because the
 * interface looks precise.
 *
 * So every value is a `Measurement` carrying its own `Provenance`, and the UI
 * is expected to show that provenance. Nothing here invents a value to fill a
 * field: a component with no measured mass has no mass entry, and the inspector
 * shows one fewer row rather than a plausible-looking number.
 */

export type Provenance =
  /** Physically measured on a built article. */
  | "REAL"
  /** Output of a model or simulation in this repository. */
  | "SIMULATED"
  /** A human estimate, explicitly recorded as such. */
  | "ESTIMATED"
  /** A requirement, not an observation. Nothing has been built to it yet. */
  | "DESIGN_TARGET";

export const PROVENANCE_LABEL: Record<Provenance, string> = {
  REAL: "Measured",
  SIMULATED: "Simulated",
  ESTIMATED: "Estimated",
  DESIGN_TARGET: "Target",
};

/**
 * How much weight the interface should give a value.
 *
 * Used to sort and to style: a measured value is stated plainly, a target is
 * visibly held at arm's length. Ordering is deliberate — anything that has
 * actually been observed outranks anything that has only been intended.
 */
export const PROVENANCE_RANK: Record<Provenance, number> = {
  REAL: 0,
  SIMULATED: 1,
  ESTIMATED: 2,
  DESIGN_TARGET: 3,
};

export interface Measurement {
  value: number;
  /** SI-ish display unit. Stored with the value so nothing has to guess. */
  unit: string;
  provenance: Provenance;
  /** Why this value is what it is, when that is not obvious. */
  note?: string;
}

export function formatMeasurement(m: Measurement): string {
  // Small values keep more precision; a 0.04 kg part shown as "0 kg" is worse
  // than useless.
  const decimals = Math.abs(m.value) >= 100 ? 0 : Math.abs(m.value) >= 10 ? 1 : 2;
  return `${m.value.toFixed(decimals)} ${m.unit}`;
}

export interface ComponentEngineering {
  /** Matches an Assembly part id or an asset component id. */
  componentId: string;
  /** What the part is made of. Free text, because materials are not an enum. */
  material?: string;
  mass?: Measurement;
  /** Longest dimension, for scale. */
  length?: Measurement;
  power?: Measurement;
  /** Continuous operating temperature ceiling. */
  thermalCeiling?: Measurement;
  /** Cycles before scheduled replacement. */
  serviceLife?: Measurement;
  maintenance?: string;
  /** Other component ids this one requires. */
  dependencies?: string[];
  status?: "INSTALLED" | "PROTOTYPE" | "CONCEPT" | "RETIRED";
}

/**
 * The wrist system's engineering record.
 *
 * Every entry is DESIGN_TARGET or ESTIMATED, because nothing here has been
 * built or simulated. That is the honest state, and it is why the inspector
 * shows "Target" beside these numbers rather than presenting them as specs.
 */
export const WRIST_ENGINEERING: ComponentEngineering[] = [
  {
    componentId: "wristHousing",
    material: "Machined aluminium alloy",
    mass: { value: 0.062, unit: "kg", provenance: "DESIGN_TARGET" },
    length: { value: 86, unit: "mm", provenance: "DESIGN_TARGET" },
    serviceLife: { value: 20000, unit: "cycles", provenance: "ESTIMATED", note: "From fastener pull-out, not fatigue testing." },
    maintenance: "Inspect mount fasteners at each cartridge change.",
    status: "CONCEPT",
  },
  {
    componentId: "wristCartridge",
    material: "Moulded polymer, sealed",
    mass: { value: 0.048, unit: "kg", provenance: "DESIGN_TARGET", note: "Filled. Empty target is 0.019 kg." },
    length: { value: 52, unit: "mm", provenance: "DESIGN_TARGET" },
    serviceLife: { value: 40, unit: "discharges", provenance: "DESIGN_TARGET" },
    maintenance: "Replaceable. No field service.",
    dependencies: ["wristHousing", "wristInterface"],
    status: "CONCEPT",
  },
  {
    componentId: "wristMechanism",
    material: "Alloy body, polymer valve seat",
    mass: { value: 0.031, unit: "kg", provenance: "DESIGN_TARGET" },
    power: { value: 1.8, unit: "W", provenance: "ESTIMATED", note: "Per actuation, averaged over a one-second duty cycle." },
    thermalCeiling: { value: 60, unit: "°C", provenance: "DESIGN_TARGET" },
    maintenance: "Sealed unit. Replace rather than service.",
    dependencies: ["wristHousing", "wristTrigger"],
    status: "CONCEPT",
  },
  {
    componentId: "wristNozzle",
    material: "Hardened alloy insert",
    mass: { value: 0.009, unit: "kg", provenance: "DESIGN_TARGET" },
    length: { value: 19, unit: "mm", provenance: "DESIGN_TARGET" },
    serviceLife: { value: 2000, unit: "discharges", provenance: "ESTIMATED", note: "Aperture wear dominates; no test data." },
    maintenance: "Interchangeable. Clean after each session.",
    dependencies: ["wristHousing"],
    status: "CONCEPT",
  },
  {
    componentId: "wristTrigger",
    material: "Overmoulded elastomer",
    mass: { value: 0.006, unit: "kg", provenance: "DESIGN_TARGET" },
    maintenance: "None.",
    dependencies: ["wristHousing"],
    status: "CONCEPT",
  },
  {
    componentId: "wristInterface",
    material: "Alloy, keyed",
    mass: { value: 0.011, unit: "kg", provenance: "DESIGN_TARGET" },
    maintenance: "Inspect seal face when a cartridge is changed.",
    dependencies: ["wristHousing"],
    status: "CONCEPT",
  },
];

const BY_ID = new Map(WRIST_ENGINEERING.map((e) => [e.componentId, e]));

/** Engineering record for a component, or null when none has been recorded. */
export function engineeringFor(componentId: string): ComponentEngineering | null {
  // Asset components carry an L/R suffix; the engineering record does not,
  // because a left and a right nozzle are the same part.
  const base = componentId.replace(/[LR]$/, "");
  return BY_ID.get(componentId) ?? BY_ID.get(base) ?? null;
}

export interface SpecRow {
  label: string;
  value: string;
  provenance: Provenance | null;
  note?: string;
}

/**
 * An engineering record as display rows.
 *
 * Only fields that exist produce rows. An absent measurement is absent from the
 * output — the inspector shows a shorter list, never a placeholder.
 */
export function specRows(record: ComponentEngineering): SpecRow[] {
  const rows: SpecRow[] = [];
  if (record.material) rows.push({ label: "Material", value: record.material, provenance: null });
  if (record.mass) rows.push({ label: "Mass", value: formatMeasurement(record.mass), provenance: record.mass.provenance, note: record.mass.note });
  if (record.length) rows.push({ label: "Length", value: formatMeasurement(record.length), provenance: record.length.provenance, note: record.length.note });
  if (record.power) rows.push({ label: "Power", value: formatMeasurement(record.power), provenance: record.power.provenance, note: record.power.note });
  if (record.thermalCeiling)
    rows.push({ label: "Thermal", value: formatMeasurement(record.thermalCeiling), provenance: record.thermalCeiling.provenance, note: record.thermalCeiling.note });
  if (record.serviceLife)
    rows.push({ label: "Service life", value: formatMeasurement(record.serviceLife), provenance: record.serviceLife.provenance, note: record.serviceLife.note });
  if (record.maintenance) rows.push({ label: "Maintenance", value: record.maintenance, provenance: null });
  if (record.status) rows.push({ label: "Status", value: record.status, provenance: null });
  return rows;
}

/**
 * The weakest provenance present in a record.
 *
 * A component whose every number is a design target should not be summarised as
 * if any of it were measured, so the summary takes the WORST case rather than
 * the best — the same reason a build is only as green as its reddest test.
 */
export function weakestProvenance(record: ComponentEngineering): Provenance | null {
  const all = [record.mass, record.length, record.power, record.thermalCeiling, record.serviceLife]
    .filter((m): m is Measurement => !!m)
    .map((m) => m.provenance);
  if (all.length === 0) return null;
  return all.reduce((worst, p) => (PROVENANCE_RANK[p] > PROVENANCE_RANK[worst] ? p : worst), all[0]);
}
