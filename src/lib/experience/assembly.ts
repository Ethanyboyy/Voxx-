import type { AssetNode } from "@/lib/3d/interaction";

/**
 * Assemblies: any object in VOX that comes apart into logical components.
 *
 * The wrist system is the first one, but nothing here knows that. A mask, a
 * lens array, a sensor, a fabrication head and a piece of lab equipment are all
 * the same shape of thing — a named set of parts, each with a real function, a
 * direction it separates along, and an order it comes apart in. Writing that
 * once is what stops every future gadget from being a bespoke implementation.
 *
 * Two rules keep exploded views meaningful rather than decorative:
 *
 * 1. **Parts are logical, not geometric.** A housing, a cartridge and an
 *    emitter are things a person can be told about. Forty numbered shards are
 *    not, however impressive they look flying apart.
 * 2. **Reassembly is exact.** Every part returns to the origin it left, because
 *    the offset is computed from the part's own definition each frame rather
 *    than accumulated — an assembly that ends up 2mm off has told the user the
 *    machine is imprecise.
 */

export interface AssemblyPart {
  id: string;
  label: string;
  /** What it does, in one sentence. Shown in inspection, spoken by voice. */
  function: string;
  /** Parent part id, or null for the assembly root. */
  parentId: string | null;
  /** Unit direction this part separates along, in the assembly's local space. */
  axis: [number, number, number];
  /**
   * How far along `axis` it travels at full separation, in metres.
   * Small numbers: these are hand-sized objects, and a 30cm explosion of a
   * 6cm device reads as debris rather than as a mechanism.
   */
  distance: number;
  /** Separation order. Lower comes off first — the outside comes off first. */
  order: number;
  /** Optional real specifications. Never invented by the renderer. */
  specs?: Record<string, string>;
}

export interface Assembly {
  id: string;
  label: string;
  /** What the whole thing is for. */
  summary: string;
  parts: AssemblyPart[];
}

/**
 * The wrist web system.
 *
 * Six parts, each one a thing that exists for a reason and can be explained:
 * that is the bar for adding a part to any assembly in this file.
 */
export const WRIST_ASSEMBLY: Assembly = {
  id: "wrist",
  label: "Wrist system",
  summary: "Forearm-mounted dispenser: stores a pressurised cartridge, meters a dose, and forms the strand at the nozzle.",
  parts: [
    {
      id: "wristHousing",
      label: "Housing",
      function: "Carries the assembly on the forearm and takes the reaction load when a strand is under tension.",
      parentId: null,
      axis: [0, 1, 0],
      distance: 0,
      order: 0,
      specs: { Material: "Machined alloy", Mount: "Forearm cuff" },
    },
    {
      id: "wristCartridge",
      label: "Cartridge",
      function: "Sealed reservoir of fluid polymer, held under pressure until a dose is released.",
      parentId: "wristHousing",
      axis: [0, -1, 0.15],
      distance: 0.05,
      order: 1,
      specs: { Type: "Replaceable", Interface: "Quarter-turn seal" },
    },
    {
      id: "wristMechanism",
      label: "Actuator",
      function: "Meters one dose per actuation; sets how much polymer is released and how fast.",
      parentId: "wristHousing",
      axis: [0.6, 0.5, 0],
      distance: 0.045,
      order: 2,
      specs: { Control: "Dose per pulse" },
    },
    {
      id: "wristNozzle",
      label: "Nozzle",
      function: "Shapes the polymer as it leaves; the aperture decides whether the strand is a line or a spread.",
      parentId: "wristHousing",
      axis: [0, 0, -1],
      distance: 0.055,
      order: 3,
      specs: { Aperture: "Interchangeable" },
    },
    {
      id: "wristTrigger",
      label: "Trigger",
      function: "Palm-side input. Placed so it cannot fire from a closed fist alone.",
      parentId: "wristHousing",
      axis: [0, -0.8, -0.4],
      distance: 0.04,
      order: 4,
      specs: { Safety: "Two-finger actuation" },
    },
    {
      id: "wristInterface",
      label: "Mechanical interface",
      function: "Locates the cartridge and actuator against the housing so parts seat the same way every time.",
      parentId: "wristHousing",
      axis: [-0.6, 0.3, 0.2],
      distance: 0.035,
      order: 5,
      specs: { Tolerance: "Keyed, single orientation" },
    },
  ],
};

/** Every assembly VOX knows about. Extend here, not in a component. */
export const ASSEMBLIES: Record<string, Assembly> = {
  [WRIST_ASSEMBLY.id]: WRIST_ASSEMBLY,
};

export function getAssembly(id: string): Assembly | null {
  return ASSEMBLIES[id] ?? null;
}

/**
 * Where a part sits at a given separation amount.
 *
 * `amount` is 0 (assembled) to 1 (fully separated). Computed from the part
 * definition every time rather than accumulated, so reassembly is exact by
 * construction instead of by hoping floating-point error cancels.
 *
 * Parts separate in `order`, staggered across the sequence — the outside comes
 * off before the inside, which is both how a person would take it apart and
 * what makes the animation readable rather than a simultaneous burst.
 */
export function partOffset(part: AssemblyPart, amount: number, partCount: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, amount));
  if (clamped === 0 || part.distance === 0) return [0, 0, 0];

  // Each part gets its own window inside the sequence, with generous overlap
  // so the motion stays continuous.
  const span = partCount > 1 ? 1 / (partCount + 1) : 1;
  const start = part.order * span * 0.6;
  const local = Math.min(1, Math.max(0, (clamped - start) / Math.max(0.0001, 1 - start)));

  const [x, y, z] = part.axis;
  const length = Math.hypot(x, y, z) || 1;
  const travel = local * part.distance;
  return [(x / length) * travel, (y / length) * travel, (z / length) * travel];
}

/** Assembly parts as interaction-framework nodes, so drill-down just works. */
export function assemblyNodes(assembly: Assembly): AssetNode[] {
  return assembly.parts.map((part) => ({
    id: part.id,
    label: part.label,
    parentId: part.parentId,
    kind: "component",
  }));
}

/** Everything needed to describe one part in the inspection readout. */
export function describePart(assembly: Assembly, partId: string): AssemblyPart | null {
  return assembly.parts.find((p) => p.id === partId) ?? null;
}
