import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BlenderLocalProvider } from "@/lib/generation/blenderLocal";
import { UnavailableGenerationProvider } from "@/lib/generation/unavailable";
import { _resetGenerationProviderCache, getGenerationProvider } from "@/lib/generation";

/**
 * The property that matters most here is negative: a generation provider that
 * cannot work must SAY so and refuse, never quietly produce something.
 *
 * A fabricated 3D asset is not like a mock text completion. It would land in
 * LabSuit.modelUrl, load, render, and be presented to the user as a real
 * inspectable object with real cost and engineering claims attached to it. So
 * there is deliberately no mock provider to fall back to, and these tests pin
 * that absence.
 */

const ORIGINAL = process.env.VOX_BLENDER_PYTHON;

beforeEach(() => {
  _resetGenerationProviderCache();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.VOX_BLENDER_PYTHON;
  else process.env.VOX_BLENDER_PYTHON = ORIGINAL;
  _resetGenerationProviderCache();
});

describe("generation provider resolution", () => {
  it("is unavailable by default, and says why", () => {
    delete process.env.VOX_BLENDER_PYTHON;
    const provider = getGenerationProvider();

    expect(provider.isConfigured).toBe(false);
    expect(provider.unavailableReason).toContain("VOX_BLENDER_PYTHON");
    // No capabilities are claimed by a provider that cannot run.
    expect(provider.capabilities).toEqual([]);
  });

  it("never falls back to a mock that would produce a fake asset", async () => {
    delete process.env.VOX_BLENDER_PYTHON;
    const provider = getGenerationProvider();

    await expect(
      provider.generate({ suitId: "mk-vii", recipe: "suit" }),
    ).rejects.toThrow(/No 3D generation provider is available/);
  });

  it("reports a configured path that does not exist rather than trusting the env var", () => {
    // Set-but-wrong is the common failure, and it must not read as configured.
    const provider = new BlenderLocalProvider("/nonexistent/python");
    expect(provider.isConfigured).toBe(false);
    expect(provider.unavailableReason).toContain("does not exist");
  });

  it("refuses to run when unconfigured, instead of shelling out anyway", async () => {
    const provider = new BlenderLocalProvider(null);
    await expect(provider.generate({ suitId: "x", recipe: "suit" })).rejects.toThrow(/not configured/);
  });

  it("only runs recipes from its closed table", async () => {
    // This provider spawns a subprocess. "Run whatever string you were handed"
    // must not be reachable, so an unknown recipe is rejected before anything
    // is executed — and it is rejected on a provider that IS otherwise usable,
    // so the check is the recipe table and not just the configured guard.
    const provider = new BlenderLocalProvider(process.execPath);
    expect(provider.isConfigured).toBe(true);
    await expect(
      provider.generate({ suitId: "x", recipe: "../../etc/passwd" }),
    ).rejects.toThrow(/Unknown recipe/);
  });

  it("declares only capabilities it actually has", () => {
    const provider = new BlenderLocalProvider(process.execPath);
    // Blender authors and renders geometry. It is not a generative model, and
    // claiming TEXT_TO_3D here would be a fabricated capability.
    expect(provider.capabilities).toContain("SCRIPTED_GEOMETRY");
    expect(provider.capabilities).toContain("RENDER");
    expect(provider.capabilities).not.toContain("TEXT_TO_3D");
    expect(provider.capabilities).not.toContain("IMAGE_TO_3D");
  });

  it("carries the reason through to the unavailable provider", async () => {
    const provider = new UnavailableGenerationProvider("host unreachable");
    expect(provider.isConfigured).toBe(false);
    await expect(provider.generate({ suitId: "x", recipe: "suit" })).rejects.toThrow(/host unreachable/);
  });

  it("caches the resolved provider until explicitly reset", () => {
    delete process.env.VOX_BLENDER_PYTHON;
    expect(getGenerationProvider()).toBe(getGenerationProvider());
    _resetGenerationProviderCache();
    expect(getGenerationProvider()).not.toBe(undefined);
  });
});
