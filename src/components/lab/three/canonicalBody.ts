/**
 * The one body reference every suit asset is normalized into.
 *
 * These live in their own dependency-free module because both the loader
 * (GltfSuitModel) and the armour rig (SuitArmor) need them, and having the
 * rig import them from the loader while the loader imports the rig formed a
 * cycle that failed at runtime with a temporal-dead-zone error rather than
 * at build time — the kind of break only rendering the page finds.
 */

/** Every body/suit GLB is scaled to stand this tall in scene units,
 *  regardless of how the source asset was authored. */
export const CANONICAL_BODY_HEIGHT = 1.75;

/** The floor the body stands on — matches the projection platform and
 *  contact shadows in HolographicSuitCanvas. */
export const CANONICAL_FEET_Y = -1.3;
