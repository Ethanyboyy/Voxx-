import type { ArmorSlot } from "@/components/lab/three/suitConfig";

/**
 * The bridge between what is RENDERED and what is RECORDED.
 *
 * Until now these were two unrelated worlds: the viewer drew shells keyed by
 * `ArmorSlot`, the Laboratory stored `LabComponent` rows keyed by a database
 * id, and nothing connected them. That is why nothing in the 3D scene could be
 * selected, priced, or inspected — not because the interaction was unbuilt,
 * but because a clicked mesh had no identity the data model recognised.
 *
 * This module is the single place that mapping lives. It is deliberately a
 * pure, closed table rather than a fuzzy name match: "find the component whose
 * name looks like the slot" silently mis-associates parts, and a wrong
 * association is worse than a missing one — it would attach real cost and real
 * engineering claims to the wrong object.
 */

/** Where a slot sits in the suit's assembly tree. */
export type AssemblyKey =
  | "HEAD"
  | "TORSO"
  | "ARM_LEFT"
  | "ARM_RIGHT"
  | "PELVIS"
  | "LEG_LEFT"
  | "LEG_RIGHT";

export interface SlotSpec {
  /** Stable identifier persisted on LabComponent.subsystem. */
  assembly: AssemblyKey;
  /** Human-facing component name. Also the match key for existing rows. */
  componentName: string;
  /** What the part is for, in engineering terms rather than marketing ones. */
  function: string;
  /** Typical manufacturing route, used by the costing model. */
  manufacturing: "CUT_AND_SEW" | "THERMOFORM" | "CNC" | "COMPOSITE_LAYUP" | "INJECTION_MOULD" | "ASSEMBLY";
}

/**
 * Every renderable slot, and the component it IS.
 *
 * Left and right are separate entries on purpose. They are separate physical
 * parts with separate costs and separate failure modes, and collapsing them
 * into one "forearm guard" would make the cost roll-up wrong by a factor of
 * two on every paired component.
 */
export const SLOT_COMPONENTS: Record<ArmorSlot, SlotSpec> = {
  collar: { assembly: "TORSO", componentName: "Collar Assembly", function: "Neck closure and helmet seal interface", manufacturing: "CUT_AND_SEW" },
  chest: { assembly: "TORSO", componentName: "Chest Plate", function: "Frontal impact distribution over the sternum and ribs", manufacturing: "COMPOSITE_LAYUP" },
  backpack: { assembly: "TORSO", componentName: "Dorsal Plate", function: "Rear impact protection and equipment mounting surface", manufacturing: "COMPOSITE_LAYUP" },
  belt: { assembly: "PELVIS", componentName: "Waist Belt", function: "Load transfer from torso to hips; mounting rail", manufacturing: "CUT_AND_SEW" },
  shoulderL: { assembly: "ARM_LEFT", componentName: "Left Pauldron", function: "Deltoid coverage without restricting abduction", manufacturing: "THERMOFORM" },
  shoulderR: { assembly: "ARM_RIGHT", componentName: "Right Pauldron", function: "Deltoid coverage without restricting abduction", manufacturing: "THERMOFORM" },
  forearmL: { assembly: "ARM_LEFT", componentName: "Left Forearm Guard", function: "Ulnar protection and wrist-system mounting", manufacturing: "THERMOFORM" },
  forearmR: { assembly: "ARM_RIGHT", componentName: "Right Forearm Guard", function: "Ulnar protection and wrist-system mounting", manufacturing: "THERMOFORM" },
  gloveL: { assembly: "ARM_LEFT", componentName: "Left Glove", function: "Grip surface and hand abrasion protection", manufacturing: "CUT_AND_SEW" },
  gloveR: { assembly: "ARM_RIGHT", componentName: "Right Glove", function: "Grip surface and hand abrasion protection", manufacturing: "CUT_AND_SEW" },
  thighL: { assembly: "LEG_LEFT", componentName: "Left Thigh Guard", function: "Quadriceps coverage over the femoral line", manufacturing: "THERMOFORM" },
  thighR: { assembly: "LEG_RIGHT", componentName: "Right Thigh Guard", function: "Quadriceps coverage over the femoral line", manufacturing: "THERMOFORM" },
  kneeL: { assembly: "LEG_LEFT", componentName: "Left Knee Cup", function: "Patellar impact protection through the flexion range", manufacturing: "INJECTION_MOULD" },
  kneeR: { assembly: "LEG_RIGHT", componentName: "Right Knee Cup", function: "Patellar impact protection through the flexion range", manufacturing: "INJECTION_MOULD" },
  shinL: { assembly: "LEG_LEFT", componentName: "Left Shin Guard", function: "Tibial protection; boot cuff interface", manufacturing: "THERMOFORM" },
  shinR: { assembly: "LEG_RIGHT", componentName: "Right Shin Guard", function: "Tibial protection; boot cuff interface", manufacturing: "THERMOFORM" },
  bootL: { assembly: "LEG_LEFT", componentName: "Left Boot", function: "Traction, ankle support and impact attenuation", manufacturing: "ASSEMBLY" },
  bootR: { assembly: "LEG_RIGHT", componentName: "Right Boot", function: "Traction, ankle support and impact attenuation", manufacturing: "ASSEMBLY" },
};

/**
 * Parts that are rendered but are not `ArmorSlot`s — the mask and its lenses
 * are drawn by the helmet block rather than the slot loop, and they are among
 * the components a user is most likely to want to inspect.
 */
export const NON_SLOT_COMPONENTS: Record<string, SlotSpec> = {
  mask: { assembly: "HEAD", componentName: "Mask Shell", function: "Cranial protection and mounting frame for the lens system", manufacturing: "THERMOFORM" },
  lensL: { assembly: "HEAD", componentName: "Left Lens", function: "Eye protection; optical substrate for any display layer", manufacturing: "INJECTION_MOULD" },
  lensR: { assembly: "HEAD", componentName: "Right Lens", function: "Eye protection; optical substrate for any display layer", manufacturing: "INJECTION_MOULD" },
};

export type SelectableId = ArmorSlot | keyof typeof NON_SLOT_COMPONENTS;

/** Every id the 3D scene can hand back on a click. */
export function allSelectableIds(): SelectableId[] {
  return [...(Object.keys(SLOT_COMPONENTS) as ArmorSlot[]), ...(Object.keys(NON_SLOT_COMPONENTS) as (keyof typeof NON_SLOT_COMPONENTS)[])];
}

export function specFor(id: SelectableId): SlotSpec | undefined {
  return SLOT_COMPONENTS[id as ArmorSlot] ?? NON_SLOT_COMPONENTS[id as string];
}

/** Assemblies in the order a person would work down a body. */
export const ASSEMBLY_ORDER: AssemblyKey[] = ["HEAD", "TORSO", "ARM_LEFT", "ARM_RIGHT", "PELVIS", "LEG_LEFT", "LEG_RIGHT"];

export const ASSEMBLY_LABEL: Record<AssemblyKey, string> = {
  HEAD: "Head assembly",
  TORSO: "Torso assembly",
  ARM_LEFT: "Left arm assembly",
  ARM_RIGHT: "Right arm assembly",
  PELVIS: "Pelvic assembly",
  LEG_LEFT: "Left leg assembly",
  LEG_RIGHT: "Right leg assembly",
};

/** Ids belonging to one assembly, for the hierarchy view and roll-ups. */
export function idsInAssembly(assembly: AssemblyKey): SelectableId[] {
  return allSelectableIds().filter((id) => specFor(id)?.assembly === assembly);
}
