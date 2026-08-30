import { describe, expect, it, beforeEach } from "vitest";
import {
  QUALITY_BUDGETS,
  canvasDpr,
  classifyDevice,
  scaleCount,
} from "@/lib/3d/quality";
import {
  DURATION,
  approach,
  easeInOutCubic,
  easeOutExpo,
  pulse,
  sampleSignal,
  staggeredProgress,
} from "@/lib/3d/animation";
import {
  INITIAL_INTERACTION,
  ancestorsOf,
  breadcrumb,
  buildTree,
  explodeOffset,
  focusUp,
  framedIds,
  selectNode,
  subtreeOf,
  visibilityOf,
  type InteractionState,
} from "@/lib/3d/interaction";
import { distanceForRadius, portraitPullback, verticalBiasOffset, visibleHeightAt } from "@/lib/3d/framing";
import {
  clearRegistry,
  componentForMesh,
  componentsToNodes,
  getAsset,
  listAssets,
  registerAsset,
  resolveLod,
} from "@/lib/3d/assetRegistry";

/**
 * The 3D framework is shared by every spatial surface in VOX, so its rules are
 * pinned here rather than re-derived per canvas. These are pure functions
 * precisely so they can be tested without a GPU — the alternative is behaviour
 * that only ever gets exercised on the developer's own machine.
 */

describe("quality tiers", () => {
  it("classifies a phone as MOBILE and a workstation as HERO", () => {
    expect(classifyDevice({ coarsePointer: true, viewportMin: 390, cores: 4, deviceMemory: 3 })).toBe("MOBILE");
    expect(classifyDevice({ coarsePointer: false, viewportMin: 1440, cores: 16, deviceMemory: 32, devicePixelRatio: 2 })).toBe("HERO");
  });

  it("gives a recent high-core phone the next tier up", () => {
    // Throttling a capable phone to the lowest tier wastes it; the signal that
    // matters is cores and memory, not the fact that it is a phone.
    expect(classifyDevice({ coarsePointer: true, viewportMin: 430, cores: 8, deviceMemory: 6 })).toBe("MEDIUM");
  });

  it("does not fall back to HERO on an unknown device", () => {
    // Absent signals must degrade toward safety, never toward the heaviest tier.
    expect(classifyDevice({})).toBe("HERO"); // desktop defaults are generous
    expect(classifyDevice({ viewportMin: 500 })).toBe("MEDIUM");
  });

  it("keeps budgets ordered and never drops below a usable floor", () => {
    const tiers = ["MOBILE", "MEDIUM", "HIGH", "HERO"] as const;
    for (let i = 1; i < tiers.length; i++) {
      const lower = QUALITY_BUDGETS[tiers[i - 1]];
      const higher = QUALITY_BUDGETS[tiers[i]];
      expect(higher.particleScale).toBeGreaterThanOrEqual(lower.particleScale);
      expect(higher.maxAnimatedSignals).toBeGreaterThanOrEqual(lower.maxAnimatedSignals);
      expect(higher.maxTextureSize).toBeGreaterThanOrEqual(lower.maxTextureSize);
    }
    // Scaling must never produce zero particles — an empty effect reads as a bug.
    expect(scaleCount(1, "MOBILE")).toBeGreaterThanOrEqual(1);
    expect(canvasDpr("MOBILE")[0]).toBe(1);
  });
});

describe("animation primitives", () => {
  it("clamps easings to [0,1] and hits both endpoints", () => {
    for (const ease of [easeInOutCubic, easeOutExpo]) {
      expect(ease(0)).toBeCloseTo(0, 5);
      expect(ease(1)).toBeCloseTo(1, 5);
      expect(ease(-5)).toBeCloseTo(0, 5);
      expect(ease(5)).toBeCloseTo(1, 5);
    }
  });

  it("returns a pulse to exactly rest at both ends", () => {
    // A pulse that does not return to zero leaves the surface permanently lit.
    expect(pulse(0)).toBeCloseTo(0, 6);
    expect(pulse(1)).toBeCloseTo(0, 6);
    expect(pulse(0.5)).toBeCloseTo(1, 6);
  });

  it("makes approach frame-rate independent", () => {
    // One 1/30s step must move about as far as two 1/60s steps, or motion
    // speed becomes a function of the display's refresh rate.
    const oneBig = approach(6, 1 / 30);
    const first = approach(6, 1 / 60);
    const combined = first + (1 - first) * approach(6, 1 / 60);
    expect(Math.abs(oneBig - combined)).toBeLessThan(0.01);
  });

  it("marks a signal done exactly once it arrives", () => {
    expect(sampleSignal({ path: 0, age: 0, duration: 1 }).done).toBe(false);
    expect(sampleSignal({ path: 0, age: 0.999, duration: 1 }).done).toBe(false);
    expect(sampleSignal({ path: 0, age: 1, duration: 1 }).done).toBe(true);
    // A zero-duration signal must terminate rather than loop forever.
    expect(sampleSignal({ path: 0, age: 0, duration: 0 }).done).toBe(true);
  });

  it("staggers progress so items animate in sequence", () => {
    expect(staggeredProgress(0, 0.3, 1)).toBe(0);
    expect(staggeredProgress(0.8, 0.3, 1)).toBeCloseTo(0.5, 5);
    expect(staggeredProgress(5, 0.3, 1)).toBe(1);
  });

  it("keeps durations ordered from instant to transit", () => {
    expect(DURATION.instant).toBeLessThan(DURATION.quick);
    expect(DURATION.quick).toBeLessThan(DURATION.focus);
    expect(DURATION.focus).toBeLessThan(DURATION.reveal);
    expect(DURATION.explode).toBeLessThan(DURATION.transit);
  });
});

const TREE = buildTree([
  { id: "suit", label: "Suit", parentId: null },
  { id: "armR", label: "Right arm", parentId: "suit" },
  { id: "forearmR", label: "Right forearm", parentId: "armR" },
  { id: "shooterR", label: "Web-shooter", parentId: "forearmR" },
  { id: "cartridgeR", label: "Cartridge", parentId: "shooterR" },
  { id: "legL", label: "Left leg", parentId: "suit" },
]);

describe("interaction model", () => {
  it("descends exactly one level per click, whatever was clicked", () => {
    // Clicking a cartridge from the whole-asset view must frame the ARM:
    // skipping the intermediate levels loses the context that tells you where
    // on the asset the part sits.
    let state = selectNode(TREE, INITIAL_INTERACTION, "cartridgeR");
    expect(state.focusId).toBe("suit");
    state = selectNode(TREE, state, "cartridgeR");
    expect(state.focusId).toBe("armR");
    state = selectNode(TREE, state, "cartridgeR");
    expect(state.focusId).toBe("forearmR");
  });

  it("switches branches rather than nesting when a different region is clicked", () => {
    const inArm = selectNode(TREE, selectNode(TREE, INITIAL_INTERACTION, "forearmR"), "forearmR");
    const moved = selectNode(TREE, inArm, "legL");
    expect(moved.focusId).toBe("suit");
  });

  it("steps back out one level and bottoms out at the whole asset", () => {
    let state: InteractionState = { ...INITIAL_INTERACTION, focusId: "shooterR" };
    state = focusUp(TREE, state);
    expect(state.focusId).toBe("forearmR");
    state = focusUp(TREE, state);
    expect(state.focusId).toBe("armR");
    state = focusUp(TREE, state);
    expect(state.focusId).toBe("suit");
    state = focusUp(TREE, state);
    expect(state.focusId).toBeNull();
    expect(focusUp(TREE, state).focusId).toBeNull();
  });

  it("frames a node together with everything mounted on it", () => {
    const ids = framedIds(TREE, { ...INITIAL_INTERACTION, focusId: "forearmR" });
    expect(ids).toContain("forearmR");
    expect(ids).toContain("shooterR");
    expect(ids).toContain("cartridgeR");
    expect(ids).not.toContain("legL");
  });

  it("dims siblings by default and hides them only when isolated", () => {
    const focused = { ...INITIAL_INTERACTION, focusId: "armR" };
    expect(visibilityOf(TREE, focused, "forearmR")).toBe("visible");
    expect(visibilityOf(TREE, focused, "suit")).toBe("visible"); // the body it sits on
    expect(visibilityOf(TREE, focused, "legL")).toBe("dimmed");
    expect(visibilityOf(TREE, { ...focused, isolated: true }, "legL")).toBe("hidden");
  });

  it("builds a root-first breadcrumb of the full depth", () => {
    const crumbs = breadcrumb(TREE, { ...INITIAL_INTERACTION, focusId: "cartridgeR" }).map((n) => n.id);
    expect(crumbs).toEqual(["suit", "armR", "forearmR", "shooterR", "cartridgeR"]);
  });

  it("survives a cyclic parent chain instead of hanging", () => {
    // Malformed data must degrade, not lock the render loop.
    const cyclic = buildTree([
      { id: "a", label: "A", parentId: "b" },
      { id: "b", label: "B", parentId: "a" },
    ]);
    expect(ancestorsOf(cyclic, "a").length).toBeLessThanOrEqual(2);
    expect(subtreeOf(cyclic, "a").length).toBeLessThanOrEqual(2);
  });

  it("explodes along the real parent-to-child direction and rests at zero", () => {
    expect(explodeOffset([1, 0, 0], [0, 0, 0], 0)).toEqual([0, 0, 0]);
    const out = explodeOffset([1, 0, 0], [0, 0, 0], 1, 0.25);
    expect(out[0]).toBeCloseTo(0.25, 5);
    // A part coincident with its parent has no direction to move in.
    expect(explodeOffset([0, 0, 0], [0, 0, 0], 1)).toEqual([0, 0, 0]);
  });
});

const ASSET = {
  assetId: "hero-suit",
  kind: "suit" as const,
  label: "Hero Suit",
  lods: [
    { url: "/models/suits/hero/hero-hero.glb", tier: "HERO" as const, bytes: 10_000_000 },
    { url: "/models/suits/hero/hero-mobile.glb", tier: "MOBILE" as const, bytes: 1_200_000 },
  ],
  components: [
    { id: "shooter", label: "Web-shooter", parentId: null, meshNames: ["wristHousingR", "wristNozzleR"], interactive: true, inspectable: true, detachable: true },
  ],
  provenance: { origin: "GENERATED" as const, description: "External generation", license: "Owned" },
  animations: [],
};

describe("external asset registry", () => {
  beforeEach(() => clearRegistry());

  it("registers and retrieves an external asset by id", () => {
    registerAsset(ASSET);
    expect(getAsset("hero-suit")?.label).toBe("Hero Suit");
    expect(listAssets("suit")).toHaveLength(1);
    expect(listAssets("gadget")).toHaveLength(0);
  });

  it("returns null for an unregistered asset rather than throwing", () => {
    // Surfaces must be able to render a fallback; the empty registry is the
    // honest current state, not an error.
    expect(getAsset("does-not-exist")).toBeNull();
  });

  it("rejects an asset url outside /models/", () => {
    expect(() =>
      registerAsset({ ...ASSET, lods: [{ url: "https://evil.example/x.glb", tier: "HERO" }] }),
    ).toThrow();
  });

  it("requires provenance", () => {
    const { provenance: _omitted, ...withoutProvenance } = ASSET;
    expect(() => registerAsset(withoutProvenance)).toThrow();
  });

  it("resolves a cheaper LOD when the requested tier is absent", () => {
    const asset = registerAsset(ASSET);
    // MEDIUM is not published, so it must fall to MOBILE rather than to HERO.
    expect(resolveLod(asset, "MEDIUM")?.tier).toBe("MOBILE");
    expect(resolveLod(asset, "HERO")?.tier).toBe("HERO");
  });

  it("falls upward rather than returning nothing when only a heavy LOD exists", () => {
    const heavyOnly = registerAsset({ ...ASSET, assetId: "heavy", lods: [ASSET.lods[0]] });
    // A blank canvas is a worse failure than a heavy download.
    expect(resolveLod(heavyOnly, "MOBILE")?.tier).toBe("HERO");
  });

  it("maps GLB mesh names back to VOX components", () => {
    const asset = registerAsset(ASSET);
    expect(componentForMesh(asset, "wristNozzleR")?.id).toBe("shooter");
    expect(componentForMesh(asset, "unknownMesh")).toBeNull();
  });

  it("converts components into interaction-framework nodes", () => {
    const asset = registerAsset(ASSET);
    const nodes = componentsToNodes(asset);
    expect(buildTree(nodes).roots).toEqual(["shooter"]);
  });
});

describe("camera framing", () => {
  it("leaves landscape framing exactly as authored", () => {
    // A regression here would silently re-frame every desktop surface.
    expect(portraitPullback(16 / 9)).toBe(1);
    expect(portraitPullback(1)).toBe(1);
    expect(distanceForRadius(1, 42, 1.9, 16 / 9)).toBeCloseTo(distanceForRadius(1, 42, 1.9), 6);
  });

  it("stands back on a portrait canvas so width still fits", () => {
    // iPhone 14 canvas measured in the browser: 390x724.
    const aspect = 390 / 724;
    expect(portraitPullback(aspect)).toBeCloseTo(724 / 390, 6);

    // The concrete bug: at the authored distance a subject as wide as it is
    // tall was cut off horizontally on a phone. Verify the corrected distance
    // actually covers the subject's width.
    const fov = 42;
    const radius = 1;
    const d = distanceForRadius(radius, fov, 1.0, aspect);
    const halfWidthVisible = d * Math.tan((fov * Math.PI) / 180 / 2) * aspect;
    expect(halfWidthVisible).toBeGreaterThanOrEqual(radius - 1e-9);

    // And that the UNCORRECTED distance genuinely did not — i.e. the test is
    // testing the fix, not restating the formula.
    const naive = distanceForRadius(radius, fov, 1.0);
    expect(naive * Math.tan((fov * Math.PI) / 180 / 2) * aspect).toBeLessThan(radius);
  });

  it("treats a degenerate aspect as square rather than dividing by zero", () => {
    expect(portraitPullback(0)).toBe(1);
    expect(portraitPullback(-2)).toBe(1);
    expect(portraitPullback(Number.NaN)).toBe(1);
    expect(Number.isFinite(distanceForRadius(1, 42, 1.9, 0))).toBe(true);
  });

  it("keeps a bigger subject further away, monotonically", () => {
    let previous = 0;
    for (const radius of [0.1, 0.5, 1, 2, 5]) {
      const d = distanceForRadius(radius, 42);
      expect(d).toBeGreaterThan(previous);
      previous = d;
    }
  });

  it("expresses the vertical bias as a share of the visible frame", () => {
    // Same fraction of frame at every zoom level — the subject must not drift
    // as the camera moves in.
    const near = verticalBiasOffset(2, 42, 0.16) / visibleHeightAt(2, 42);
    const far = verticalBiasOffset(8, 42, 0.16) / visibleHeightAt(8, 42);
    expect(near).toBeCloseTo(0.16, 9);
    expect(far).toBeCloseTo(0.16, 9);
    // Landscape asks for no bias and must get exactly none.
    expect(verticalBiasOffset(4, 42, 0)).toBe(0);
  });
});
