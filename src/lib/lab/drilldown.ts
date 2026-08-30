import { ASSEMBLY_LABEL, SLOT_COMPONENTS, NON_SLOT_COMPONENTS, specFor, type AssemblyKey, type SelectableId } from "@/lib/lab/slotBridge";

/**
 * The drill-down model: what a click means depends on where you already are.
 *
 * The interaction is progressive. From the whole suit, clicking the right arm
 * should frame the ARM, not the single plate under the cursor — you asked to
 * look at the arm. Once you are already inside the arm, clicking the
 * web-shooter should frame the WEB-SHOOTER, and clicking again should reach
 * its cartridge. Selecting the leaf part immediately from the full-body view
 * would skip the context that makes the leaf legible.
 *
 * So a click resolves against the current level rather than always meaning the
 * same thing, and every level is a real object in the scene with real bounds.
 */

export type FocusLevel = "SUIT" | "ASSEMBLY" | "COMPONENT" | "SUBCOMPONENT";

/** Wrist subcomponents, keyed by the arm assembly they belong to. */
export const WRIST_PARTS: Record<"ARM_LEFT" | "ARM_RIGHT", string[]> = {
  ARM_LEFT: ["wristHousingL", "wristMechanismL", "wristCartridgeL", "wristNozzleL", "wristTriggerL"],
  ARM_RIGHT: ["wristHousingR", "wristMechanismR", "wristCartridgeR", "wristNozzleR", "wristTriggerR"],
};

export const WRIST_PART_LABEL: Record<string, string> = {
  wristHousing: "Web-shooter housing",
  wristMechanism: "Firing mechanism",
  wristCartridge: "Web cartridge",
  wristNozzle: "Emitter nozzle",
  wristTrigger: "Trigger pad",
};

/** The parent component a wrist subcomponent hangs off. */
export function wristParentComponent(id: string): SelectableId | null {
  if (!id.startsWith("wrist")) return null;
  return id.endsWith("L") ? "forearmL" : "forearmR";
}

export function isWristPart(id: string): boolean {
  return id.startsWith("wrist");
}

/** Human label for any selectable id, including wrist subcomponents. */
export function labelFor(id: string): string {
  if (isWristPart(id)) {
    const base = id.slice(0, -1);
    return WRIST_PART_LABEL[base] ?? base;
  }
  return specFor(id as SelectableId)?.componentName ?? id;
}

/** Which assembly an id belongs to, wrist subcomponents included. */
export function assemblyOf(id: string): AssemblyKey | null {
  if (isWristPart(id)) return id.endsWith("L") ? "ARM_LEFT" : "ARM_RIGHT";
  return specFor(id as SelectableId)?.assembly ?? null;
}

export interface FocusState {
  level: FocusLevel;
  /** The assembly currently entered, if any. */
  assembly: AssemblyKey | null;
  /** The component currently entered, if any. */
  component: string | null;
  /** The subcomponent currently entered, if any. */
  subcomponent: string | null;
}

export const ROOT_FOCUS: FocusState = { level: "SUIT", assembly: null, component: null, subcomponent: null };

/**
 * Resolves a click on `id` given where the user currently is.
 *
 * The rule is one level per click, and never more: jumping straight from the
 * full body to a cartridge disorients, because the intermediate framings are
 * what tell you which arm you are looking at and where on it the device sits.
 */
export function focusOnClick(current: FocusState, id: string): FocusState {
  const assembly = assemblyOf(id);
  if (!assembly) return current;

  // Not yet inside this assembly — enter it first, whatever was clicked.
  if (current.assembly !== assembly) {
    return { level: "ASSEMBLY", assembly, component: null, subcomponent: null };
  }

  if (isWristPart(id)) {
    const parent = wristParentComponent(id);
    // Inside the arm but not yet at the wrist system: step to the component.
    if (current.component !== parent) {
      return { level: "COMPONENT", assembly, component: parent, subcomponent: null };
    }
    return { level: "SUBCOMPONENT", assembly, component: parent, subcomponent: id };
  }

  // A normal component inside the assembly we are already in.
  if (current.component !== id) {
    return { level: "COMPONENT", assembly, component: id, subcomponent: null };
  }
  return current;
}

/** One step back out. */
export function focusUp(current: FocusState): FocusState {
  if (current.level === "SUBCOMPONENT") {
    return { level: "COMPONENT", assembly: current.assembly, component: current.component, subcomponent: null };
  }
  if (current.level === "COMPONENT") {
    return { level: "ASSEMBLY", assembly: current.assembly, component: null, subcomponent: null };
  }
  return ROOT_FOCUS;
}

export interface Crumb {
  label: string;
  level: FocusLevel;
}

/** Breadcrumb for the current position, so the depth is always legible. */
export function breadcrumb(state: FocusState): Crumb[] {
  const out: Crumb[] = [{ label: "Suit", level: "SUIT" }];
  if (state.assembly) out.push({ label: ASSEMBLY_LABEL[state.assembly], level: "ASSEMBLY" });
  if (state.component) out.push({ label: labelFor(state.component), level: "COMPONENT" });
  if (state.subcomponent) out.push({ label: labelFor(state.subcomponent), level: "SUBCOMPONENT" });
  return out;
}

/**
 * Which scene object ids the camera should frame for the current state.
 *
 * Returns a LIST because assembly focus frames every piece mounted on that
 * body region, and the union of their bounds is the only correct framing for
 * geometry whose position comes from the pose at runtime.
 */
export function idsToFrame(state: FocusState): string[] {
  if (state.subcomponent) return [state.subcomponent];
  if (state.component) {
    // Framing the forearm means framing the wrist system mounted on it too,
    // otherwise entering the component crops off the device you came to see.
    if (state.component === "forearmL") return ["forearmL", ...WRIST_PARTS.ARM_LEFT];
    if (state.component === "forearmR") return ["forearmR", ...WRIST_PARTS.ARM_RIGHT];
    return [state.component];
  }
  if (state.assembly) {
    const base = [
      ...Object.keys(SLOT_COMPONENTS).filter((k) => SLOT_COMPONENTS[k as keyof typeof SLOT_COMPONENTS].assembly === state.assembly),
      ...Object.keys(NON_SLOT_COMPONENTS).filter((k) => NON_SLOT_COMPONENTS[k].assembly === state.assembly),
    ];
    if (state.assembly === "ARM_LEFT") return [...base, ...WRIST_PARTS.ARM_LEFT];
    if (state.assembly === "ARM_RIGHT") return [...base, ...WRIST_PARTS.ARM_RIGHT];
    return base;
  }
  return [];
}
