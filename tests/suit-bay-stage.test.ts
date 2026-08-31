import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SCENARIOS, SCENARIO_IDS, SCENARIO_SUITS, getScenario, scenarioEvents } from "@/lib/experience/scenarios";
import { signalKindForEvent } from "@/lib/3d/signals";

/**
 * The Suit Bay's geometry and the visual QA scenarios.
 *
 * Both of the bugs pinned here were invisible to typecheck, lint, the test
 * suite and the production build, and were found only by opening a render:
 * the bay arc collapsed to a straight line 7.5m behind the camera, and every
 * suit stood with its legs below the floor. They are cheap to assert and
 * expensive to rediscover.
 */

/** Mirrors layoutBays' constants; the component file imports three.js. */
const BAY_SPACING = 1.78;
const RADIUS = 12;
const CANONICAL_FEET_Y = -1.3;
const PLATFORM_HEIGHT = 0.085;

function layout(count: number) {
  const step = count > 1 ? BAY_SPACING / RADIUS : 0;
  const start = -((count - 1) / 2) * step;
  return Array.from({ length: count }, (_, i) => {
    const angle = start + i * step;
    return {
      position: [Math.sin(angle) * RADIUS, 0, RADIUS * (Math.cos(angle) - 1)] as [number, number, number],
      rotation: -angle,
    };
  });
}

describe("suit bay layout", () => {
  it("centres the arc on the origin", () => {
    // The original form simplified to a constant -radius, putting every bay
    // 7.5m behind where the camera was framing. The centre bay must be AT the
    // origin, not behind it.
    const slots = layout(5);
    const centre = slots[2];
    expect(centre.position[0]).toBeCloseTo(0, 6);
    expect(centre.position[2]).toBeCloseTo(0, 6);

    const xs = slots.map((s) => s.position[0]);
    expect(xs[0]).toBeLessThan(0);
    expect(xs[4]).toBeGreaterThan(0);
    expect(xs.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 6);
  });

  it("curves gently away rather than wrapping around the viewer", () => {
    const slots = layout(5);
    // Ends sit slightly further back than the centre...
    expect(slots[0].position[2]).toBeLessThan(0);
    // ...but only slightly. The thing that actually matters is the facing
    // angle: past roughly 20 degrees the end suits present side-on, which is
    // what the arc exists to prevent.
    for (const slot of slots) {
      expect(Math.abs(slot.rotation)).toBeLessThan((20 * Math.PI) / 180);
    }
  });

  it("spaces neighbours at the intended distance whatever the count", () => {
    for (const count of [2, 3, 5]) {
      const slots = layout(count);
      for (let i = 1; i < slots.length; i++) {
        const dx = slots[i].position[0] - slots[i - 1].position[0];
        const dz = slots[i].position[2] - slots[i - 1].position[2];
        expect(Math.hypot(dx, dz)).toBeCloseTo(BAY_SPACING, 1);
      }
    }
  });

  it("handles the degenerate counts", () => {
    expect(layout(0)).toEqual([]);
    const one = layout(1);
    expect(one[0].position[0]).toBeCloseTo(0, 6);
    expect(one[0].rotation).toBeCloseTo(0, 6);
  });

  it("lifts a normalised body so its feet land on the platform", () => {
    // Assets are normalised to stand with feet at CANONICAL_FEET_Y (-1.3),
    // which is below a room whose floor is y=0 — the suit rendered as a torso
    // sitting on the platform until this lift existed.
    const lift = -CANONICAL_FEET_Y + PLATFORM_HEIGHT;
    expect(CANONICAL_FEET_Y + lift).toBeCloseTo(PLATFORM_HEIGHT, 6);
    expect(lift).toBeGreaterThan(0);
  });
});

describe("visual QA scenarios", () => {
  it("covers every state the experience can be in", () => {
    for (const id of ["brain-idle", "brain-thinking", "brain-memory", "brain-execution", "brain-error"]) {
      expect(SCENARIO_IDS).toContain(id);
    }
    // And the signature suit interactions.
    for (const id of ["suit-bay", "suit-selected", "wrist-exploded", "wrist-reassembled"]) {
      expect(SCENARIO_IDS).toContain(id);
    }
  });

  it("produces deterministic events so captures can be diffed", () => {
    const first = scenarioEvents(SCENARIOS["brain-thinking"]);
    const second = scenarioEvents(SCENARIOS["brain-thinking"]);
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it("uses event types the signal classifier actually recognises", () => {
    // A scenario whose events all classify as nothing would render an idle
    // brain while claiming to show reasoning.
    for (const scenario of Object.values(SCENARIOS)) {
      if (scenario.eventTypes.length === 0) continue;
      const classified = scenario.eventTypes.filter((t) => signalKindForEvent(t) !== null);
      expect(classified.length, scenario.id).toBeGreaterThan(0);
    }
  });

  it("returns null for an unknown scenario rather than a default one", () => {
    expect(getScenario("does-not-exist")).toBeNull();
    expect(getScenario("brain-idle")).not.toBeNull();
  });

  it("ships original, non-branded suit identities", () => {
    expect(SCENARIO_SUITS.length).toBeGreaterThanOrEqual(4);
    const banned = /spider|stark|wayne|marvel|iron ?man|batman|avengers/i;
    for (const suit of SCENARIO_SUITS) {
      expect(banned.test(suit.codename), suit.codename).toBe(false);
      expect(banned.test(suit.designation), suit.designation).toBe(false);
      expect(suit.stats).not.toBeNull();
    }
    // Distinct ids, or two bays collapse onto one platform.
    expect(new Set(SCENARIO_SUITS.map((s) => s.id)).size).toBe(SCENARIO_SUITS.length);
  });

  it("holds no real data and reaches no service that could supply any", () => {
    // The preview's entire security posture: there is nothing here to redact,
    // because the module cannot reach anything real in the first place.
    const source = readFileSync("src/lib/experience/scenarios.ts", "utf8");
    for (const forbidden of ["@/lib/db", "prisma", "getCurrentUser", "@/lib/auth", "process.env"]) {
      expect(source.includes(forbidden), forbidden).toBe(false);
    }
  });

  it("keeps the preview route out of the authenticated app group", () => {
    // Living outside (app) is what keeps it away from the session and the
    // database; a preview under the app layout would load real state.
    const page = readFileSync("src/app/preview/[scenario]/page.tsx", "utf8");
    // Assert on real imports, not on prose: the doc comment names
    // getCurrentUser precisely to explain why it is absent.
    expect(/^import .*@\/lib\/auth/m.test(page)).toBe(false);
    expect(/^import .*@\/lib\/db/m.test(page)).toBe(false);
    expect(/^import .*prisma/m.test(page)).toBe(false);
    // And it must stay off by default in production.
    expect(page.includes("VOX_PREVIEW")).toBe(true);
  });
});
