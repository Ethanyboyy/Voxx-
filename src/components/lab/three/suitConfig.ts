import type { ArmorLevel, MaterialLanguage, Silhouette } from "@/components/lab/three/suitDesign";

/**
 * The suit build specification — what a suit is actually MADE of, derived
 * from the design parameters already on the LabSuit record.
 *
 * This exists because 60 suits were rendering as the same untextured
 * mannequin in 60 colors. Colour is not a design; a suit differs from
 * another suit by what is bolted to it, how thick it is, which surfaces are
 * hard and which are woven, and where its instrumentation sits. That is
 * what this module describes, and it is what SuitArmor.tsx builds as real
 * geometry rather than painting on as a texture.
 *
 * Everything here is DERIVED, never random: the same suit always produces
 * the same build, and every input is a real column on the record. A
 * randomised build would look varied and mean nothing — you could not
 * reason about it, and re-rendering would silently change the "design".
 */

/** Where a piece of armour sits on the canonical body. */
export type ArmorSlot =
  | "collar"
  | "chest"
  | "backpack"
  | "shoulderL"
  | "shoulderR"
  | "forearmL"
  | "forearmR"
  | "belt"
  | "thighL"
  | "thighR"
  | "shinL"
  | "shinR"
  | "kneeL"
  | "kneeR"
  | "gloveL"
  | "gloveR"
  | "bootL"
  | "bootR";

/**
 * How a surface behaves under light. The whole point of separating these is
 * that a woven panel and a rigid plate must not respond to the key light the
 * same way — that difference is most of what makes a render read as
 * "constructed" instead of "a coloured mannequin".
 */
export type SurfaceClass = "FABRIC" | "TECHNICAL_FABRIC" | "ARMOR" | "ELASTOMER" | "METAL";

export interface SurfaceSpec {
  metalness: number;
  roughness: number;
  /** Clearcoat lifts a hard shell above a woven one at the same roughness. */
  clearcoat: number;
  clearcoatRoughness: number;
  /** Sheen gives woven material its grazing-angle lift. Zero on hard surfaces. */
  sheen: number;
  /** Darkens/lightens the base colour so plates read as distinct panels
   *  against the underlayer rather than the same value twice. */
  tint: number;
}

/**
 * Tuned against the studio environment in HolographicSuitCanvas, not picked
 * from a table. The spread between FABRIC (0.88) and ARMOR (0.28) roughness
 * is deliberately wide — a narrow spread reads as one material with noise.
 */
export const SURFACE_SPECS: Record<SurfaceClass, SurfaceSpec> = {
  FABRIC: { metalness: 0.0, roughness: 0.88, clearcoat: 0.0, clearcoatRoughness: 1.0, sheen: 0.55, tint: 1.0 },
  TECHNICAL_FABRIC: { metalness: 0.12, roughness: 0.62, clearcoat: 0.15, clearcoatRoughness: 0.7, sheen: 0.3, tint: 1.12 },
  ARMOR: { metalness: 0.45, roughness: 0.28, clearcoat: 0.85, clearcoatRoughness: 0.25, sheen: 0.0, tint: 1.5 },
  ELASTOMER: { metalness: 0.0, roughness: 0.55, clearcoat: 0.35, clearcoatRoughness: 0.5, sheen: 0.0, tint: 0.72 },
  METAL: { metalness: 0.95, roughness: 0.18, clearcoat: 0.4, clearcoatRoughness: 0.15, sheen: 0.0, tint: 1.9 },
};

/** The material language chosen for the suit decides its UNDERLAYER surface —
 *  the second skin the armour is mounted onto. */
const UNDERLAYER_OF: Record<MaterialLanguage, SurfaceClass> = {
  TEXTILE: "FABRIC",
  SYNTHETIC_FIBER: "TECHNICAL_FABRIC",
  FLEXIBLE_POLYMER: "ELASTOMER",
  CARBON_COMPOSITE: "TECHNICAL_FABRIC",
  EXPERIMENTAL_MATERIAL: "TECHNICAL_FABRIC",
};

/** …and its PLATE surface, where the suit carries hard components. */
const PLATE_OF: Record<MaterialLanguage, SurfaceClass> = {
  TEXTILE: "ARMOR",
  SYNTHETIC_FIBER: "ARMOR",
  FLEXIBLE_POLYMER: "ELASTOMER",
  CARBON_COMPOSITE: "ARMOR",
  EXPERIMENTAL_MATERIAL: "METAL",
};

export interface ArmorPiece {
  slot: ArmorSlot;
  /** Multiplies the slot's base thickness — how bulky this build reads. */
  bulk: number;
  surface: SurfaceClass;
}

/**
 * How a suit is COLOURED, as distinct from what it is made of.
 *
 * Every suit previously derived every surface from one stored hue, so sixty
 * designs differed only in that hue and each individual suit read as one
 * colour applied to a whole figure. Real technical garments are not
 * monochrome: the shell, the underlayer and the trim are pigmented
 * differently, often deliberately so the wearer's outline is legible.
 *
 * Hue SHIFTS are relative to the suit's own stored colour, so a suit keeps
 * its identity while its layers stop being the same swatch at three
 * brightnesses.
 */
export interface SuitPalette {
  /** Body/underlayer: dark, saturated, matte. */
  underlayerL: number;
  underlayerS: number;
  /** Hard plates: lighter, desaturated, hue-shifted off the body. */
  plateL: number;
  plateS: number;
  plateHueShift: number;
  /** Trim: seams, gloves, boots, small components. The third colour. */
  trimL: number;
  trimS: number;
  trimHueShift: number;
}

export interface SuitBuild {
  underlayer: SurfaceClass;
  plate: SurfaceClass;
  pieces: ArmorPiece[];
  /** Body proportion multipliers — a heavier build genuinely sits wider. */
  shoulderSpread: number;
  /** Emissive strength for the telemetry lines. Kept low by construction:
   *  this is instrumentation on a garment, not a light source. */
  emissiveStrength: number;
  /** Whether the chest carries a visible powered core. */
  chestCore: boolean;
  /** One-line statement of what this build is FOR, shown in the inspector. */
  concept: string;
  palette: SuitPalette;
}

/**
 * Which slots each armour level populates. Cumulative on purpose — a
 * MODERATE build is a LIGHT build plus more, so raising a suit's armour
 * level reads as adding equipment rather than swapping to a different suit.
 */
const SLOTS_BY_LEVEL: Record<ArmorLevel, ArmorSlot[]> = {
  NONE: ["collar", "belt", "gloveL", "gloveR", "bootL", "bootR"],
  LIGHT: ["collar", "belt", "chest", "forearmL", "forearmR", "shinL", "shinR", "gloveL", "gloveR", "bootL", "bootR"],
  MODERATE: [
    "collar", "belt", "chest", "forearmL", "forearmR", "shinL", "shinR",
    "shoulderL", "shoulderR", "thighL", "thighR",
    "gloveL", "gloveR", "bootL", "bootR", "kneeL", "kneeR",
  ],
  EXPERIMENTAL: [
    "collar", "belt", "chest", "forearmL", "forearmR", "shinL", "shinR",
    "shoulderL", "shoulderR", "thighL", "thighR", "backpack",
    "gloveL", "gloveR", "bootL", "bootR", "kneeL", "kneeR",
  ],
};

const BULK_BY_LEVEL: Record<ArmorLevel, number> = {
  NONE: 0.7,
  LIGHT: 0.85,
  MODERATE: 1.15,
  EXPERIMENTAL: 1.4,
};

/** Silhouette adjusts how wide the build sits across the shoulders. */
const SPREAD_BY_SILHOUETTE: Record<Silhouette, number> = {
  LIGHTWEIGHT: 0.9,
  STREAMLINED: 0.94,
  STEALTH: 0.97,
  ATHLETIC: 1.0,
  TACTICAL: 1.08,
  ARMORED: 1.18,
};

/**
 * Archetype is the strongest identity signal a suit has — it is the answer
 * to "what is this FOR" — so it, not colour, drives the build's character.
 * These read as engineering intent rather than decoration: a Stealth suit
 * loses its shoulder bulk and its glow; an Experimental one gains a
 * backpack and a core.
 */
interface ArchetypeProfile {
  concept: string;
  palette: SuitPalette;
  bulk: number;
  emissive: number;
  chestCore: boolean;
  /** Slots this archetype removes even when its armour level would grant them. */
  drop?: ArmorSlot[];
  /** Slots it adds regardless of level. */
  add?: ArmorSlot[];
  /** Overrides the plate surface where the archetype demands it. */
  plate?: SurfaceClass;
}

const ARCHETYPE_PROFILE: Record<string, ArchetypeProfile> = {
  Stealth: {
    palette: { underlayerL: 0.055, underlayerS: 0.35, plateL: 0.15, plateS: 0.1, plateHueShift: -0.02, trimL: 0.3, trimS: 0.12, trimHueShift: 0.0 },
    concept: "Low-signature build. Matte technical surfaces, minimal hard edges, instrumentation dimmed to near-dark.",
    bulk: 0.8,
    emissive: 0.35,
    chestCore: false,
    drop: ["shoulderL", "shoulderR", "backpack"],
    plate: "ELASTOMER",
  },
  Combat: {
    palette: { underlayerL: 0.1, underlayerS: 0.3, plateL: 0.42, plateS: 0.1, plateHueShift: 0.03, trimL: 0.2, trimS: 0.5, trimHueShift: -0.06 },
    concept: "Impact-rated build. Full plate coverage across the torso and limbs, reinforced shoulders, hard shell throughout.",
    bulk: 1.35,
    emissive: 0.7,
    chestCore: true,
    add: ["shoulderL", "shoulderR", "thighL", "thighR"],
    plate: "ARMOR",
  },
  Tactical: {
    palette: { underlayerL: 0.09, underlayerS: 0.28, plateL: 0.34, plateS: 0.14, plateHueShift: 0.06, trimL: 0.5, trimS: 0.18, trimHueShift: 0.02 },
    concept: "Load-bearing build. Modular plates over a technical underlayer, belt-mounted systems, balanced coverage.",
    bulk: 1.1,
    emissive: 0.6,
    chestCore: false,
    add: ["thighL", "thighR"],
  },
  Recon: {
    palette: { underlayerL: 0.11, underlayerS: 0.22, plateL: 0.5, plateS: 0.07, plateHueShift: 0.02, trimL: 0.42, trimS: 0.45, trimHueShift: 0.1 },
    concept: "Sensor-forward build. Light plating, collar-mounted optics, instrumentation prioritised over protection.",
    bulk: 0.85,
    emissive: 0.95,
    chestCore: true,
    drop: ["thighL", "thighR"],
  },
  Aerial: {
    palette: { underlayerL: 0.13, underlayerS: 0.3, plateL: 0.56, plateS: 0.06, plateHueShift: -0.03, trimL: 0.34, trimS: 0.4, trimHueShift: 0.05 },
    concept: "Mass-critical build. Minimal plating, streamlined shoulders, everything not load-bearing removed.",
    bulk: 0.7,
    emissive: 0.75,
    chestCore: false,
    drop: ["thighL", "thighR", "backpack"],
  },
  Urban: {
    palette: { underlayerL: 0.1, underlayerS: 0.24, plateL: 0.27, plateS: 0.12, plateHueShift: 0.08, trimL: 0.46, trimS: 0.2, trimHueShift: -0.04 },
    concept: "Sustained-wear build. Abrasion plating at contact points, otherwise woven, built for continuous movement.",
    bulk: 0.95,
    emissive: 0.5,
    chestCore: false,
    drop: ["backpack"],
  },
  Utility: {
    palette: { underlayerL: 0.1, underlayerS: 0.26, plateL: 0.36, plateS: 0.16, plateHueShift: 0.05, trimL: 0.55, trimS: 0.3, trimHueShift: 0.09 },
    concept: "Equipment-carrying build. Belt and back systems, forearm tooling, plating where equipment mounts.",
    bulk: 1.0,
    emissive: 0.55,
    chestCore: false,
    add: ["backpack"],
  },
  Experimental: {
    palette: { underlayerL: 0.08, underlayerS: 0.4, plateL: 0.62, plateS: 0.05, plateHueShift: 0.0, trimL: 0.38, trimS: 0.6, trimHueShift: 0.12 },
    concept: "Prototype build. Unproven material set, powered chest system, full instrumentation — not rated for field use.",
    bulk: 1.2,
    emissive: 1.0,
    chestCore: true,
    add: ["backpack", "shoulderL", "shoulderR"],
    plate: "METAL",
  },
};

const DEFAULT_PROFILE: ArchetypeProfile = {
  palette: { underlayerL: 0.1, underlayerS: 0.28, plateL: 0.34, plateS: 0.12, plateHueShift: 0.04, trimL: 0.42, trimS: 0.25, trimHueShift: 0.03 },
  concept: "General-purpose build.",
  bulk: 1.0,
  emissive: 0.6,
  chestCore: false,
};

export interface SuitBuildInput {
  archetype: string;
  silhouette: Silhouette;
  materialLanguage: MaterialLanguage;
  armorLevel: ArmorLevel;
}

/**
 * Resolves a suit's structural build. Pure and deterministic — the same
 * record always yields the same suit, so a design can be reasoned about and
 * compared rather than being a different object on every render.
 */
export function resolveSuitBuild(input: SuitBuildInput): SuitBuild {
  const profile = ARCHETYPE_PROFILE[input.archetype] ?? DEFAULT_PROFILE;

  const underlayer = UNDERLAYER_OF[input.materialLanguage];
  const plate = profile.plate ?? PLATE_OF[input.materialLanguage];

  const slots = new Set<ArmorSlot>(SLOTS_BY_LEVEL[input.armorLevel]);
  for (const slot of profile.add ?? []) slots.add(slot);
  // Dropped last so an archetype's character wins over its armour level —
  // a Stealth suit does not get pauldrons just because it is well armoured.
  for (const slot of profile.drop ?? []) slots.delete(slot);

  const bulk = BULK_BY_LEVEL[input.armorLevel] * profile.bulk;

  return {
    underlayer,
    plate,
    pieces: [...slots].map((slot) => ({
      slot,
      bulk,
      // Belt and collar are always flexible mounts even on a hard-plated
      // suit — a rigid ring at the throat would not be wearable.
      surface:
        slot === "belt" || slot === "collar" || slot === "gloveL" || slot === "gloveR"
          ? "ELASTOMER"
          : plate,
    })),
    shoulderSpread: SPREAD_BY_SILHOUETTE[input.silhouette],
    emissiveStrength: profile.emissive,
    chestCore: profile.chestCore,
    concept: profile.concept,
    palette: profile.palette,
  };
}
