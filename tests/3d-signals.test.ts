import { describe, expect, it } from "vitest";
import {
  activeSignalKinds,
  signalKindForEvent,
  signalKindsForState,
  signalWeights,
  SIGNAL_HEX,
  SIGNAL_KINDS,
  SIGNAL_LABEL,
} from "@/lib/3d/signals";
import {
  ASSET_INDEX_URL,
  assetIndexSchema,
  assetManifestUrl,
  loadAssetDefinition,
  loadAssetIndex,
} from "@/lib/3d/assetLoader";
import { clearRegistry, getAsset } from "@/lib/3d/assetRegistry";

describe("signal classification", () => {
  it("maps real VOX event types to cognitive activities", () => {
    expect(signalKindForEvent("memory.created")).toBe("memory");
    expect(signalKindForEvent("memory.superseded")).toBe("memory");
    expect(signalKindForEvent("cognition.patterns_detected")).toBe("reasoning");
    expect(signalKindForEvent("objective.progress")).toBe("objective");
    expect(signalKindForEvent("opportunity.promoted_to_project")).toBe("objective");
    expect(signalKindForEvent("agent.run.started")).toBe("execution");
    expect(signalKindForEvent("task.completed")).toBe("execution");
    expect(signalKindForEvent("proposal.executed")).toBe("execution");
  });

  it("separates research the system PERFORMS from research it REMEMBERS", () => {
    // Same prefix, different cognitive activity. This is exactly why prefix
    // matching alone is not sufficient.
    expect(signalKindForEvent("research.performed")).toBe("reasoning");
    expect(signalKindForEvent("research.recorded")).toBe("memory");
  });

  it("classifies planning as reasoning even though supervisor.* is execution", () => {
    expect(signalKindForEvent("supervisor.planning")).toBe("reasoning");
    expect(signalKindForEvent("supervisor.replanning")).toBe("reasoning");
    expect(signalKindForEvent("supervisor.started")).toBe("execution");
  });

  it("refuses to classify non-cognitive events rather than inventing activity", () => {
    expect(signalKindForEvent("auth.login")).toBeNull();
    expect(signalKindForEvent("settings.autonomy_mode_changed")).toBeNull();
    expect(signalKindForEvent("view_suit")).toBeNull();
    expect(signalKindForEvent("")).toBeNull();
  });

  it("gives every kind a label and a colour", () => {
    for (const kind of SIGNAL_KINDS) {
      expect(SIGNAL_LABEL[kind]).toBeTruthy();
      expect(SIGNAL_HEX[kind]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe("activity mix", () => {
  it("counts only classified events", () => {
    const weights = signalWeights([
      { type: "memory.created" },
      { type: "memory.updated" },
      { type: "auth.login" },
      { type: "task.completed" },
    ]);
    expect(weights).toEqual([
      { kind: "memory", count: 2 },
      { kind: "execution", count: 1 },
    ]);
  });

  it("reports nothing for a system that has done nothing", () => {
    expect(signalWeights([{ type: "auth.logout" }])).toEqual([]);
    expect(signalWeights([])).toEqual([]);
  });

  it("weights the emitted mix toward what actually happened", () => {
    const kinds = activeSignalKinds(
      [
        ...Array.from({ length: 9 }, () => ({ type: "memory.created" })),
        { type: "task.completed" },
      ],
      "thinking",
    );
    const memory = kinds.filter((k) => k === "memory").length;
    const execution = kinds.filter((k) => k === "execution").length;
    expect(memory).toBeGreaterThan(execution);
    // A rare kind still travels — the mix is proportional, not exclusive.
    expect(execution).toBeGreaterThan(0);
  });

  it("falls back to declared state only when no event classified", () => {
    expect(activeSignalKinds([{ type: "auth.login" }], "executing")).toEqual(["execution", "objective"]);
    expect(activeSignalKinds([], "learning")).toEqual(["memory"]);
    // Evidence beats the summary: real memory events override "executing".
    expect(activeSignalKinds([{ type: "memory.created" }], "executing")).toEqual(["memory"]);
  });

  it("has a defined fallback for every brain state, including unknown ones", () => {
    for (const state of ["idle", "thinking", "executing", "researching", "learning", "waiting", "error", "???"]) {
      const kinds = signalKindsForState(state);
      expect(kinds.length).toBeGreaterThan(0);
      for (const kind of kinds) expect(SIGNAL_KINDS).toContain(kind);
    }
  });

  it("only inspects the recent window", () => {
    const events = [
      ...Array.from({ length: 3 }, () => ({ type: "memory.created" })),
      ...Array.from({ length: 50 }, () => ({ type: "task.completed" })),
    ];
    expect(signalWeights(events, 3)).toEqual([{ kind: "memory", count: 3 }]);
  });
});

/** Minimal stand-in for fetch: no network, no filesystem, no guessing. */
function fakeFetch(routes: Record<string, unknown>, status = 200) {
  return async (url: string) => ({
    ok: url in routes,
    status: url in routes ? status : 404,
    json: async () => routes[url],
  });
}

const MANIFEST = {
  assetId: "hero-v1",
  kind: "suit",
  label: "Hero Suit Mk I",
  lods: [{ url: "/models/suits/hero-v1/hero.glb", tier: "HIGH" }],
  provenance: { origin: "THIRD_PARTY", description: "test fixture", license: "CC0" },
};

describe("external asset discovery", () => {
  it("builds the conventional manifest path from kind and id", () => {
    expect(assetManifestUrl("suit", "hero-v1")).toBe("/models/suits/hero-v1/asset.json");
    expect(assetManifestUrl("gadget", "web-shooter")).toBe("/models/gadgets/web-shooter/asset.json");
  });

  it("registers a valid manifest", async () => {
    clearRegistry();
    const url = "/models/suits/hero-v1/asset.json";
    const asset = await loadAssetDefinition(url, fakeFetch({ [url]: MANIFEST }));
    expect(asset.assetId).toBe("hero-v1");
    expect(getAsset("hero-v1")).not.toBeNull();
  });

  it("refuses manifests from outside /models/ without fetching them", async () => {
    let called = false;
    const spy = async () => {
      called = true;
      return { ok: true, status: 200, json: async () => MANIFEST };
    };
    await expect(loadAssetDefinition("https://evil.example/asset.json", spy)).rejects.toThrow(/outside \/models\//);
    await expect(loadAssetDefinition("/etc/passwd", spy)).rejects.toThrow();
    expect(called).toBe(false);
  });

  it("rejects a manifest with no provenance rather than registering it", async () => {
    clearRegistry();
    const url = "/models/suits/anon/asset.json";
    const { provenance: _dropped, ...noProvenance } = MANIFEST;
    await expect(loadAssetDefinition(url, fakeFetch({ [url]: { ...noProvenance, assetId: "anon" } }))).rejects.toThrow();
    expect(getAsset("anon")).toBeNull();
  });

  it("treats a missing index as an empty project, not an error", async () => {
    const result = await loadAssetIndex(fakeFetch({}));
    expect(result).toEqual({ loaded: [], failed: [] });
  });

  it("loads every manifest the index names, and reports the ones that fail", async () => {
    clearRegistry();
    const good = "/models/suits/hero-v1/asset.json";
    const bad = "/models/suits/broken/asset.json";
    const result = await loadAssetIndex(
      fakeFetch({
        [ASSET_INDEX_URL]: { assets: [good, bad] },
        [good]: MANIFEST,
        [bad]: { assetId: "broken" },
      }),
    );
    expect(result.loaded.map((a) => a.assetId)).toEqual(["hero-v1"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].url).toBe(bad);
    // A broken sibling must not take down the good asset.
    expect(getAsset("hero-v1")).not.toBeNull();
  });

  it("rejects index entries that escape /models/", () => {
    expect(() => assetIndexSchema.parse({ assets: ["https://evil.example/a.json"] })).toThrow();
    expect(() => assetIndexSchema.parse({ assets: ["/models/../secrets.json"] })).toThrow();
    expect(assetIndexSchema.parse({}).assets).toEqual([]);
  });

  it("ships an index that is valid and honest about being empty", async () => {
    const { readFileSync } = await import("node:fs");
    const raw = JSON.parse(readFileSync("public/models/index.json", "utf8"));
    expect(assetIndexSchema.parse(raw).assets).toEqual([]);
  });
});
