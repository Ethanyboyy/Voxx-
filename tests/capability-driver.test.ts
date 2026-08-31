import { describe, it, expect, beforeAll, vi } from "vitest";
import { db } from "@/lib/db";
import { createTestUser } from "./helpers";
import { driveRequest } from "@/lib/capabilities/driver";
import { offsetStepReferences } from "@/lib/agents/references";

let userId: string;

beforeAll(async () => {
  const user = await createTestUser();
  userId = user.id;
});

describe("reference renumbering", () => {
  it("shifts every reference by the block's starting position", () => {
    const step = {
      description: "use what came before",
      toolName: "workspace.write",
      input: { path: "{{step0.output.path}}", body: "see {{step1.output}} and {{step0.output}}" },
    };
    const shifted = offsetStepReferences(step, 2);
    expect(shifted.input.path).toBe("{{step2.output.path}}");
    expect(shifted.input.body).toBe("see {{step3.output}} and {{step2.output}}");
  });

  it("is a no-op at offset zero, and leaves non-reference text alone", () => {
    const step = { description: "d", input: { a: "{{step0.output}}", b: "plain {{notastep}}" } };
    expect(offsetStepReferences(step, 0)).toEqual(step);
    expect(offsetStepReferences(step, 1).input.b).toBe("plain {{notastep}}");
  });

  it("descends into arrays and nested objects", () => {
    const shifted = offsetStepReferences(
      { input: { refs: ["{{step0.output.versions.0.versionId}}"], deep: { x: "{{step1.output}}" } } },
      5,
    );
    expect(shifted.input.refs[0]).toBe("{{step5.output.versions.0.versionId}}");
    expect(shifted.input.deep.x).toBe("{{step6.output}}");
  });
});

describe("driving a plan", () => {
  it("starts no run at all when the router says just answer", async () => {
    const before = await db.agentRun.count({ where: { userId } });
    const result = await driveRequest({ userId, request: "What did I decide about the lens shape?" });

    expect(result.plan.steps.length).toBe(0);
    expect(result.runId).toBeNull();
    // An AgentRun per ordinary question would make the activity feed useless.
    expect(await db.agentRun.count({ where: { userId } })).toBe(before);
  });

  it("emits the routing decision as operational metadata, with no reasoning text", async () => {
    const request = "Research how ripstop weave behaves under load and tell me what you find.";
    const result = await driveRequest({ userId, request });

    const routed = await db.event.findFirst({
      where: { userId, type: "capability.routed", subjectId: result.traceId },
    });
    expect(routed).toBeTruthy();
    const payload = JSON.parse(routed!.payload ?? "{}");
    expect(payload.traceId).toBe(result.traceId);
    for (const step of payload.steps ?? []) {
      // Capability + a one-line reason only. Hidden chain-of-thought must not
      // be persisted anywhere a user-facing surface could read it back.
      expect(Object.keys(step).sort()).toEqual(["capability", "optional", "reason"]);
      expect(String(step.reason).length).toBeLessThanOrEqual(120);
    }
  });

  it("groups every stage of one task under a single traceId", async () => {
    const supplied = "trace-fixed-for-this-test";
    const result = await driveRequest({
      userId,
      request: "Research the weave, then tell me about it.",
      traceId: supplied,
    });
    expect(result.traceId).toBe(supplied);

    const events = await db.event.findMany({ where: { userId, subjectId: supplied } });
    expect(events.map((e) => e.type).sort()).toEqual(["capability.requested", "capability.routed"]);
  });

  it("never plans a provider-backed stage the provider reports as unconfigured", async () => {
    // The caller asserts image generation works. The provider says otherwise,
    // and the provider is the one that would actually be called.
    const result = await driveRequest({
      userId,
      request: "Generate three concept images of the mask.",
      context: { available: { IMAGE_GENERATION: true } },
    });

    expect(result.plan.steps.some((s) => s.capability === "IMAGE_GENERATION")).toBe(false);
    expect(result.plan.degraded).toBe(true);
  });

  it("renumbers a spliced engineering plan so its references survive the splice", async () => {
    const planner = await import("@/lib/agents/planner");
    // Read-only on both steps deliberately: this test asserts on the STEPS the
    // driver produced, and the run it starts executes for real. A write tool
    // here would be an edit to the actual repository if ACT were ever granted.
    const spy = vi.spyOn(planner, "planObjective").mockResolvedValue([
      { description: "read the first", toolName: "workspace.read", input: { path: "README.md" } },
      { description: "read what the first named", toolName: "workspace.read", input: { path: "{{step0.output.path}}" } },
    ]);

    try {
      const result = await driveRequest({
        userId,
        // Phrased to pull in recall as well as execution, so the engineering
        // block does not start at zero.
        request: "Remember what we decided, then implement the lens recess in the suit builder and fix it.",
      });

      const executionIndex = result.steps.findIndex((s) => s.toolName === "workspace.read");
      // Not an escape hatch: if the router stops planning EXECUTION for this
      // phrasing, this test has stopped testing the splice and must fail.
      expect(executionIndex).toBeGreaterThanOrEqual(0);
      // The whole point — the block does not start at zero, so the reference
      // had to move.
      expect(executionIndex).toBeGreaterThan(0);

      const second = result.steps[executionIndex + 1];
      expect((second.input as Record<string, unknown>).path).toBe(`{{step${executionIndex}.output.path}}`);
    } finally {
      spy.mockRestore();
      await db.agentRun.deleteMany({ where: { userId } });
    }
  });
});
