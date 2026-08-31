import { describe, it, expect } from "vitest";
import { routeDeterministic, routeRequest, finalize } from "@/lib/capabilities/router";
import { CAPABILITIES, CAPABILITY_PERMISSION_KEY, isMetered } from "@/lib/capabilities/types";
import type { Capability } from "@/lib/capabilities/types";

function caps(plan: { steps: { capability: Capability }[] }): Capability[] {
  return plan.steps.map((s) => s.capability);
}

describe("capability router", () => {
  describe("deciding NOT to use a capability", () => {
    // The hardest requirement in the brief, and the one a router gets wrong by
    // default: reaching for a provider because one is configured.
    it("returns no opinion for ordinary conversation", () => {
      expect(routeDeterministic({ request: "what did I do yesterday?" })).toBeNull();
      expect(routeDeterministic({ request: "thanks, that's great" })).toBeNull();
      expect(routeDeterministic({ request: "how many suits do I have?" })).toBeNull();
    });

    it("does not generate an image merely because one is attached", async () => {
      const plan = await routeRequest({
        request: "what do you think of this?",
        hasVisualReference: true,
      });
      expect(plan.steps).toHaveLength(0);
      expect(plan.strategy).toBe("direct");
    });

    it("answers directly when no classifier is available", async () => {
      const plan = await routeRequest({ request: "something genuinely ambiguous" });
      expect(plan.steps).toHaveLength(0);
      expect(plan.strategy).toBe("direct");
    });

    it("answers directly when the classifier throws", async () => {
      const plan = await routeRequest({ request: "ambiguous" }, async () => {
        throw new Error("provider down");
      });
      // A classifier outage must not fail the request.
      expect(plan.steps).toHaveLength(0);
      expect(plan.strategy).toBe("direct");
    });
  });

  describe("image routing", () => {
    it("routes concept and moodboard requests to image generation", () => {
      expect(caps(routeDeterministic({ request: "Create concept art for a new Lab room" })!))
        .toContain("IMAGE_GENERATION");
      expect(caps(routeDeterministic({ request: "Create a visual moodboard" })!))
        .toContain("IMAGE_GENERATION");
    });

    it("treats a request for N variations as image generation", () => {
      const plan = routeDeterministic({ request: "Give me 10 variations of this mask" })!;
      expect(caps(plan)).toContain("IMAGE_GENERATION");
    });

    it("routes 'keep this but change the colours' to editing, not generation", () => {
      const plan = routeDeterministic({ request: "Keep this exact design but change the colors" })!;
      expect(caps(plan)).toContain("IMAGE_EDIT");
      expect(caps(plan)).not.toContain("IMAGE_GENERATION");
    });

    it("routes a realism request on an existing image to editing", () => {
      const plan = routeDeterministic({ request: "Improve the realism of this reference" })!;
      expect(caps(plan)).toContain("IMAGE_EDIT");
    });
  });

  describe("video routing", () => {
    it("routes temporal requests to video", () => {
      for (const request of [
        "Make a trailer for this suit",
        "Create a cinematic reveal",
        "Show this suit walking through the Lab",
        "Create a promotional video for the Lab",
      ]) {
        expect(caps(routeDeterministic({ request })!)).toContain("VIDEO_GENERATION");
      }
    });

    it("reads 'show X <verb>ing' as temporal even with no video noun", () => {
      // Neither of these contains a word from the temporal list. The signal is
      // the continuous-form action verb.
      expect(caps(routeDeterministic({ request: "Show the suit activating" })!))
        .toContain("VIDEO_GENERATION");
      expect(caps(routeDeterministic({ request: "Show this suit walking through the Lab" })!))
        .toContain("VIDEO_GENERATION");
    });

    it("does NOT read an ordinary -ing word as motion", () => {
      // The reason motion verbs are enumerated rather than matched as /\w+ing/.
      expect(routeDeterministic({ request: "show me the existing suits" })).toBeNull();
    });

    it("does NOT route a still request to video", () => {
      const plan = routeDeterministic({ request: "Design a new stealth suit concept art" })!;
      expect(caps(plan)).not.toContain("VIDEO_GENERATION");
    });

    it("chains image generation before video when there is nothing to film", () => {
      // The brief's central example: a trailer with no existing visual needs a
      // concept first, and that ordering is a routing decision, not a
      // hardcoded pipeline.
      const plan = routeDeterministic({ request: "Make a trailer for the Mark 07 suit" })!;
      const order = caps(plan);
      expect(order).toContain("IMAGE_GENERATION");
      expect(order.indexOf("IMAGE_GENERATION")).toBeLessThan(order.indexOf("VIDEO_GENERATION"));
    });

    it("skips the concept step when a reference already exists", () => {
      const plan = routeDeterministic({
        request: "Make a trailer for the Mark 07 suit",
        hasVisualReference: true,
      })!;
      expect(caps(plan)).not.toContain("IMAGE_GENERATION");
      expect(caps(plan)).toContain("VIDEO_GENERATION");
    });

    it("also skips the concept step when a 3D model exists to film", () => {
      const plan = routeDeterministic({
        request: "Create a cinematic reveal of the Mark 07",
        hasModel3d: true,
      })!;
      expect(caps(plan)).not.toContain("IMAGE_GENERATION");
    });
  });

  describe("execution routing", () => {
    it("routes application changes to the execution agent", () => {
      for (const request of [
        "Fix the Suit Bay",
        "Build this into the Suit Bay",
        "Implement the selected concept",
      ]) {
        expect(caps(routeDeterministic({ request })!)).toContain("EXECUTION");
      }
    });

    it("does not route an execution request to image generation", () => {
      const plan = routeDeterministic({ request: "Fix the Suit Bay" })!;
      expect(caps(plan)).not.toContain("IMAGE_GENERATION");
    });
  });

  describe("memory grounding", () => {
    it("recalls first when the request names something VOX has records for", () => {
      const plan = routeDeterministic({ request: "Make a trailer for the Mark 07 suit" })!;
      expect(caps(plan)[0]).toBe("MEMORY");
    });

    it("does not recall for a subject VOX has no records of", () => {
      const plan = routeDeterministic({ request: "Create concept art for a coffee mug" })!;
      expect(caps(plan)).not.toContain("MEMORY");
    });
  });

  describe("QA gating", () => {
    it("adds an optional QA step whenever media is produced", () => {
      const plan = routeDeterministic({ request: "Create concept art for a new Lab room" })!;
      const qa = plan.steps.find((s) => s.capability === "VISUAL_QA");
      expect(qa).toBeDefined();
      // Optional: QA being unavailable must not block delivering the media.
      expect(qa?.optional).toBe(true);
    });

    it("drops QA when nothing visual survives filtering", () => {
      const plan = finalize(
        {
          steps: [
            { capability: "IMAGE_GENERATION", reason: "x", optional: false },
            { capability: "VISUAL_QA", reason: "y", optional: true },
          ],
          strategy: "deterministic",
          degraded: false,
          notes: [],
        },
        { request: "x", available: { IMAGE_GENERATION: false } },
      );
      // QA with nothing to check is noise, not diligence.
      expect(plan.steps).toHaveLength(0);
      expect(plan.degraded).toBe(true);
    });
  });

  describe("availability and permission filtering", () => {
    it("drops a capability with no configured provider and marks the plan degraded", () => {
      const plan = finalize(
        {
          steps: [
            { capability: "IMAGE_GENERATION", reason: "x", optional: false },
            { capability: "VIDEO_GENERATION", reason: "y", optional: false },
          ],
          strategy: "deterministic",
          degraded: false,
          notes: [],
        },
        { request: "x", available: { VIDEO_GENERATION: false } },
      );
      expect(caps(plan)).toEqual(["IMAGE_GENERATION"]);
      expect(plan.degraded).toBe(true);
      expect(plan.notes.join(" ")).toContain("VIDEO_GENERATION");
    });

    it("drops a denied capability", () => {
      const plan = finalize(
        {
          steps: [{ capability: "EXECUTION", reason: "x", optional: false }],
          strategy: "deterministic",
          degraded: false,
          notes: [],
        },
        { request: "x", denied: ["EXECUTION"] },
      );
      expect(plan.steps).toHaveLength(0);
      expect(plan.notes.join(" ")).toContain("not permitted");
    });

    it("keeps a capability whose availability was simply not reported", () => {
      // Absent is not the same as false. Inventing an answer either way is
      // worse than letting the provider speak for itself.
      const plan = finalize(
        {
          steps: [{ capability: "IMAGE_GENERATION", reason: "x", optional: false }],
          strategy: "deterministic",
          degraded: false,
          notes: [],
        },
        { request: "x", available: {} },
      );
      expect(caps(plan)).toEqual(["IMAGE_GENERATION"]);
      expect(plan.degraded).toBe(false);
    });
  });

  describe("routing metadata", () => {
    it("keeps reasons short and operational", () => {
      const plan = routeDeterministic({ request: "Make a trailer for the Mark 07 suit" })!;
      for (const s of plan.steps) {
        expect(s.reason.length).toBeLessThanOrEqual(120);
        expect(s.reason.length).toBeGreaterThan(0);
      }
    });
  });

  describe("taxonomy", () => {
    it("gives every capability a deliberate permission decision", () => {
      // A new capability that silently defaults to ungated is the failure this
      // guards: the map must name every member, even to say "null".
      for (const capability of CAPABILITIES) {
        expect(Object.prototype.hasOwnProperty.call(CAPABILITY_PERMISSION_KEY, capability)).toBe(true);
      }
    });

    it("meters exactly the capabilities that spend money externally", () => {
      expect(isMetered("IMAGE_GENERATION")).toBe(true);
      expect(isMetered("VIDEO_GENERATION")).toBe(true);
      expect(isMetered("MEMORY")).toBe(false);
      expect(isMetered("EXECUTION")).toBe(false);
    });
  });
});
