import { describe, expect, it } from "vitest";
import {
  ROOT_FOCUS,
  assemblyOf,
  breadcrumb,
  focusOnClick,
  focusUp,
  idsToFrame,
  isWristPart,
  labelFor,
  wristParentComponent,
} from "@/lib/lab/drilldown";

/**
 * The drill-down is the interaction the Lab is built around, so its rules are
 * pinned here rather than left to be re-derived by hand each time the scene
 * changes.
 */

describe("progressive drill-down", () => {
  it("enters the assembly first, whatever was clicked", () => {
    // Clicking the web-shooter from the full-body view frames the ARM, not the
    // device: skipping the intermediate level loses the context that tells you
    // which arm you are looking at.
    const s = focusOnClick(ROOT_FOCUS, "wristNozzleR");
    expect(s.level).toBe("ASSEMBLY");
    expect(s.assembly).toBe("ARM_RIGHT");
    expect(s.component).toBeNull();
  });

  it("walks suit → arm → web-shooter → cartridge, one level per click", () => {
    let s = focusOnClick(ROOT_FOCUS, "forearmR");
    expect(s.level).toBe("ASSEMBLY");

    s = focusOnClick(s, "wristCartridgeR");
    expect(s.level).toBe("COMPONENT");
    expect(s.component).toBe("forearmR");

    s = focusOnClick(s, "wristCartridgeR");
    expect(s.level).toBe("SUBCOMPONENT");
    expect(s.subcomponent).toBe("wristCartridgeR");
  });

  it("switches assemblies rather than nesting when a different region is clicked", () => {
    const inRightArm = focusOnClick(focusOnClick(ROOT_FOCUS, "forearmR"), "forearmR");
    const s = focusOnClick(inRightArm, "bootL");
    expect(s.assembly).toBe("LEG_LEFT");
    expect(s.component).toBeNull();
    expect(s.level).toBe("ASSEMBLY");
  });

  it("steps back out one level at a time and bottoms out at the suit", () => {
    let s = focusOnClick(focusOnClick(focusOnClick(ROOT_FOCUS, "forearmL"), "wristNozzleL"), "wristNozzleL");
    expect(s.level).toBe("SUBCOMPONENT");
    s = focusUp(s);
    expect(s.level).toBe("COMPONENT");
    s = focusUp(s);
    expect(s.level).toBe("ASSEMBLY");
    s = focusUp(s);
    expect(s).toEqual(ROOT_FOCUS);
    expect(focusUp(s)).toEqual(ROOT_FOCUS);
  });

  it("frames the wrist system along with the forearm it mounts to", () => {
    // Entering the forearm without its device would crop off the thing the
    // user navigated there to look at.
    const s = focusOnClick(focusOnClick(ROOT_FOCUS, "forearmR"), "forearmR");
    const ids = idsToFrame(s);
    expect(ids).toContain("forearmR");
    expect(ids).toContain("wristNozzleR");
  });

  it("frames every piece of an assembly at assembly level", () => {
    const s = focusOnClick(ROOT_FOCUS, "bootR");
    const ids = idsToFrame(s);
    expect(ids).toContain("bootR");
    expect(ids).toContain("shinR");
    expect(ids).toContain("kneeR");
    // and nothing from the other leg
    expect(ids).not.toContain("bootL");
  });

  it("frames only the leaf at subcomponent level", () => {
    const s = focusOnClick(focusOnClick(focusOnClick(ROOT_FOCUS, "forearmL"), "wristTriggerL"), "wristTriggerL");
    expect(idsToFrame(s)).toEqual(["wristTriggerL"]);
  });

  it("routes wrist parts to the correct arm and parent", () => {
    expect(assemblyOf("wristNozzleL")).toBe("ARM_LEFT");
    expect(assemblyOf("wristNozzleR")).toBe("ARM_RIGHT");
    expect(wristParentComponent("wristCartridgeR")).toBe("forearmR");
    expect(wristParentComponent("bootL")).toBeNull();
    expect(isWristPart("wristHousingL")).toBe(true);
    expect(isWristPart("chest")).toBe(false);
  });

  it("labels wrist parts and normal components readably", () => {
    expect(labelFor("wristCartridgeR")).toBe("Web cartridge");
    expect(labelFor("chest")).toBe("Chest Plate");
  });

  it("builds a breadcrumb that shows the full depth", () => {
    const s = focusOnClick(focusOnClick(focusOnClick(ROOT_FOCUS, "forearmR"), "wristNozzleR"), "wristNozzleR");
    const crumbs = breadcrumb(s).map((c) => c.label);
    expect(crumbs).toEqual(["Suit", "Right arm assembly", "Right Forearm Guard", "Emitter nozzle"]);
  });

  it("returns nothing to frame at the root, so the camera goes home", () => {
    expect(idsToFrame(ROOT_FOCUS)).toEqual([]);
  });
});
