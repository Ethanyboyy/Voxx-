/**
 * Camera framing: how far back to stand, and where to aim.
 *
 * Extracted into a lib module because both 3D surfaces need the identical
 * answer and both previously computed it their own way — the Brain with a pair
 * of hand-tuned constants per focus mode, the Lab with a formula that ignored
 * viewport shape. The two disagreed, and the Brain's constants were only ever
 * correct at the one phone they were eyeballed against.
 *
 * The whole module is pure arithmetic on numbers, so it is testable without a
 * browser, a canvas, or a GPU — which is the only reason the portrait bug below
 * can be pinned down by a test rather than by taking screenshots.
 */

/** Degrees → radians, without pulling three.js into a pure math module. */
const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Multiplier that makes a landscape-authored distance frame correctly on any
 * viewport shape.
 *
 * A perspective camera's `fov` is VERTICAL. The horizontal field is therefore
 * `fov × aspect`, so a 390×724 phone canvas sees barely half the width a
 * desktop canvas does at the same distance — and a subject framed to fill the
 * height gets its left and right edges cut off. Standing back by `1/aspect`
 * restores exactly the horizontal coverage the distance was authored for.
 *
 * Landscape needs no correction: the vertical field is already the binding
 * constraint there, and pushing the camera further back would just shrink the
 * subject for nothing.
 */
export function portraitPullback(aspect: number): number {
  if (!Number.isFinite(aspect) || aspect <= 0) return 1;
  return 1 / Math.min(1, aspect);
}

/**
 * Distance at which a sphere of `radius` fits the frame, with breathing room.
 *
 * `margin` above 1 is deliberate: a part framed edge-to-edge reads as a crop,
 * and the surrounding asset is what tells the viewer WHERE the part is.
 */
export function distanceForRadius(radius: number, fovDegrees: number, margin = 1.9, aspect = 1): number {
  const vertical = (radius * margin) / Math.tan(rad(fovDegrees) / 2);
  return vertical * portraitPullback(aspect);
}

/** Height of the visible world, in world units, at a given distance. */
export function visibleHeightAt(distance: number, fovDegrees: number): number {
  return 2 * distance * Math.tan(rad(fovDegrees) / 2);
}

/**
 * How far to push the orbit target DOWN so the subject rides higher in frame.
 *
 * Needed because a phone's canvas is not all visible: the activity feed and
 * inspector cards cover roughly its lower half, so a subject centred in the
 * canvas is centred behind the UI. Expressed as a fraction of the visible world
 * height, so the subject holds the same position in frame at every zoom level
 * rather than drifting as the camera moves in.
 */
export function verticalBiasOffset(
  distance: number,
  fovDegrees: number,
  biasFraction: number,
): number {
  if (biasFraction <= 0) return 0;
  return biasFraction * visibleHeightAt(distance, fovDegrees);
}
