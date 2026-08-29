import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { executeRun } from "@/lib/agents/executor";
import { hasStepReference, resolveStepReferences } from "@/lib/agents/references";
import { grantPermission } from "@/lib/permissions/service";
import { createTestUser } from "./helpers";

describe("Step references: pure resolution", () => {
  const outputs = new Map<number, unknown>([
    [0, { id: "mem-1", items: [{ id: "a" }, { id: "b" }], count: 2, nested: { deep: "value" } }],
    [1, "plain string output"],
  ]);

  it("detects references only where they exist", () => {
    expect(hasStepReference("{{step0.output}}")).toBe(true);
    expect(hasStepReference({ a: ["{{step1.output}}"] })).toBe(true);
    expect(hasStepReference({ a: "no refs here" })).toBe(false);
    expect(hasStepReference(42)).toBe(false);
  });

  it("preserves the real type when a value is exactly one reference", () => {
    const { value, unresolved } = resolveStepReferences({ payload: "{{step0.output}}" }, outputs);
    expect(unresolved).toEqual([]);
    // An object must arrive at the tool's schema as an object, not a JSON string.
    expect((value as { payload: unknown }).payload).toEqual(outputs.get(0));

    const numeric = resolveStepReferences({ n: "{{step0.output.count}}" }, outputs);
    expect((numeric.value as { n: unknown }).n).toBe(2);
  });

  it("walks object paths and array indices", () => {
    const { value } = resolveStepReferences(
      { a: "{{step0.output.nested.deep}}", b: "{{step0.output.items.1.id}}" },
      outputs
    );
    expect(value).toEqual({ a: "value", b: "b" });
  });

  it("interpolates and stringifies a reference embedded in surrounding text", () => {
    const { value, unresolved } = resolveStepReferences({ note: "found id {{step0.output.id}} today" }, outputs);
    expect(unresolved).toEqual([]);
    expect((value as { note: string }).note).toBe("found id mem-1 today");
  });

  it("reports unresolved references instead of silently passing the placeholder through", () => {
    const missingStep = resolveStepReferences({ x: "{{step9.output}}" }, outputs);
    expect(missingStep.unresolved).toEqual(["{{step9.output}}"]);

    const missingPath = resolveStepReferences({ x: "{{step0.output.nope.deeper}}" }, outputs);
    expect(missingPath.unresolved).toEqual(["{{step0.output.nope.deeper}}"]);
  });

  it("leaves reference-free input untouched", () => {
    const input = { a: 1, b: ["x", "y"], c: { d: true } };
    const { value, unresolved } = resolveStepReferences(input, outputs);
    expect(value).toEqual(input);
    expect(unresolved).toEqual([]);
  });
});

describe("Step references: real chained execution", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
    await grantPermission(userId, "memory.write", "ACT");
    await grantPermission(userId, "memory.read", "ACT");
  });

  async function runSteps(steps: { description: string; toolName: string; input: object }[]) {
    const run = await db.agentRun.create({ data: { userId, objective: "chained run", status: "PLANNING" } });
    for (const [order, step] of steps.entries()) {
      await db.agentStep.create({
        data: {
          runId: run.id,
          order,
          description: step.description,
          toolName: step.toolName,
          input: JSON.stringify(step.input),
          requiredLevel: "ACT",
        },
      });
    }
    return executeRun(userId, run.id);
  }

  it("passes a real earlier output into a later step", async () => {
    const result = await runSteps([
      { description: "create a memory", toolName: "memory.create", input: { content: "Chaining works end to end.", category: "FACT" } },
      // memory.search takes a query — feed it the id the previous step really returned.
      { description: "search using the previous result", toolName: "memory.search", input: { query: "{{step0.output.id}}" } },
    ]);

    expect(result.status).toBe("COMPLETED");
    const second = result.steps.find((s) => s.order === 1);
    expect(second!.status).toBe("COMPLETED");

    // The stored input proves substitution happened before the tool ran.
    const created = JSON.parse(result.steps[0].output!);
    expect(second!.input).not.toContain("{{");
    expect(JSON.parse(second!.input!).query).toBe(created.id);
  });

  it("fails the run honestly when a reference cannot be resolved", async () => {
    const result = await runSteps([
      { description: "reference a step that does not exist", toolName: "memory.search", input: { query: "{{step7.output.id}}" } },
    ]);

    expect(result.status).toBe("FAILED");
    expect(result.error).toContain("{{step7.output.id}}");
    // Never reported as a success with a literal placeholder handed to the tool.
    expect(result.steps[0].status).toBe("FAILED");
  });
});
