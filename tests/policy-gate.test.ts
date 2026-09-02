import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import {
  evaluatePolicy,
  recordShadowPolicyEvaluation,
  strictest,
  POLICY_MATRIX,
  type PolicyDecision,
} from "@/lib/policy/gate";
import {
  classifyAction,
  classifyTask,
  TOOL_CLASSIFICATIONS,
  PROPOSAL_ACTION_CLASSIFICATIONS,
  UNKNOWN_ACTION,
  EFFECTS,
  REVERSIBILITIES,
  SENSITIVITIES,
  FRESHNESSES,
  REASONING_DEPTHS,
  LATENCY_BUDGETS,
  COST_BUDGETS,
  type ActionClassification,
} from "@/lib/policy/classification";
import { listTools } from "@/lib/tools/registry";
import { createProposal, approveProposal } from "@/lib/cognition/proposals";
import { grantPermission } from "@/lib/permissions/service";
import { startAgentRun } from "@/lib/agents/service";
import { createTestUser } from "./helpers";

/** Shorthand for a classification, so the matrix tests read as a table. */
function action(over: Partial<ActionClassification>): ActionClassification {
  return { effect: "READ", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false, ...over };
}

function decide(over: Partial<ActionClassification>, prior?: PolicyDecision): PolicyDecision {
  return evaluatePolicy({ action: action(over), prior }).decision;
}

async function shadowEvents(userId: string) {
  return db.event.findMany({ where: { userId, type: "policy.shadow_evaluated" }, orderBy: { createdAt: "asc" } });
}

function payloadOf(event: { payload: string | null }): Record<string, unknown> {
  return JSON.parse(event.payload ?? "{}") as Record<string, unknown>;
}

describe("P1 — classification metadata", () => {
  it("classifies every registered tool, so no tool relies on the unknown default", () => {
    const unclassified = listTools()
      .map((tool) => tool.name)
      .filter((name) => !classifyAction("tool", name).known);
    expect(unclassified).toEqual([]);
  });

  it("uses bounded vocabularies only — every value is a member of its enum", () => {
    for (const [name, entry] of Object.entries(TOOL_CLASSIFICATIONS)) {
      expect(EFFECTS, name).toContain(entry.effect);
      expect(REVERSIBILITIES, name).toContain(entry.reversibility);
      expect(typeof entry.financial, name).toBe("boolean");
      expect(typeof entry.untrustedOutput, name).toBe("boolean");
    }
    for (const [name, entry] of Object.entries(PROPOSAL_ACTION_CLASSIFICATIONS)) {
      expect(EFFECTS, name).toContain(entry.effect);
      expect(REVERSIBILITIES, name).toContain(entry.reversibility);
    }
  });

  it("derives a bounded task profile, never a free-form or numeric one", () => {
    const task = classifyTask("tool", "economic.record_expense");
    expect(SENSITIVITIES).toContain(task.sensitivity);
    expect(FRESHNESSES).toContain(task.freshness);
    expect(REASONING_DEPTHS).toContain(task.reasoningDepth);
    expect(LATENCY_BUDGETS).toContain(task.latencyBudget);
    expect(COST_BUDGETS).toContain(task.costBudget);
    // Money is the most restricted material VOX handles.
    expect(task.sensitivity).toBe("SENSITIVE");
  });

  it("carries no authorization data — classification never restates a permission level", () => {
    // The permission system is the only place a level lives. If a classification
    // ever grew a `requiredLevel`/`capability`/`granted` field it would be a
    // second source of truth about what is allowed, which is exactly what
    // capabilities/types.ts refused. Assert the shape stays clean.
    const forbidden = ["capability", "requiredLevel", "level", "granted", "permission"];
    for (const entry of Object.values(TOOL_CLASSIFICATIONS)) {
      expect(Object.keys(entry).filter((key) => forbidden.includes(key))).toEqual([]);
    }
  });

  it("falls back conservatively for an action nobody classified", () => {
    const lookup = classifyAction("tool", "some.tool.added.next.week");
    expect(lookup.known).toBe(false);
    expect(lookup.classification).toEqual(UNKNOWN_ACTION);
    // Conservative but recoverable: HOLD demands a human, DENY would make a
    // forgotten table entry indistinguishable from a prohibition.
    expect(evaluatePolicy({ action: lookup.classification }).decision).toBe("HOLD");
  });

  it("does not resolve prototype keys as known classifications", () => {
    expect(classifyAction("tool", "constructor").known).toBe(false);
    expect(classifyAction("tool", "toString").known).toBe(false);
  });

  it("survives malformed action ids without throwing", () => {
    for (const bad of [null, undefined, 42, {}, [], ""]) {
      expect(() => classifyAction("tool", bad)).not.toThrow();
      expect(classifyAction("tool", bad).known).toBe(false);
      expect(() => classifyTask("tool", bad)).not.toThrow();
    }
  });
});

describe("P2 — the policy matrix", () => {
  it("is total: every effect × reversibility cell has a decision", () => {
    for (const effect of EFFECTS) {
      for (const reversibility of REVERSIBILITIES) {
        expect(["ALLOW", "HOLD", "DENY"], `${effect}/${reversibility}`).toContain(
          POLICY_MATRIX[effect][reversibility]
        );
      }
    }
  });

  // The cases the brief names, one assertion each, read straight off the table.
  it("READ + reversible → ALLOW", () => {
    expect(decide({ effect: "READ", reversibility: "REVERSIBLE" })).toBe("ALLOW");
  });

  it("ANALYZE + reversible → ALLOW", () => {
    expect(decide({ effect: "ANALYZE", reversibility: "REVERSIBLE" })).toBe("ALLOW");
  });

  it("WRITE + reversible → ALLOW", () => {
    expect(decide({ effect: "WRITE", reversibility: "REVERSIBLE" })).toBe("ALLOW");
  });

  it("WRITE + irreversible → HOLD", () => {
    expect(decide({ effect: "WRITE", reversibility: "IRREVERSIBLE" })).toBe("HOLD");
  });

  it("ACT + reversible → HOLD (reaching outside VOX is never free)", () => {
    expect(decide({ effect: "ACT", reversibility: "REVERSIBLE" })).toBe("HOLD");
  });

  it("ACT + irreversible → HOLD", () => {
    expect(decide({ effect: "ACT", reversibility: "IRREVERSIBLE" })).toBe("HOLD");
  });

  it("financial + reversible → HOLD", () => {
    expect(decide({ effect: "FINANCIAL", reversibility: "REVERSIBLE", financial: true })).toBe("HOLD");
  });

  it("financial + irreversible → DENY", () => {
    expect(decide({ effect: "FINANCIAL", reversibility: "IRREVERSIBLE", financial: true })).toBe("DENY");
  });

  it("escalates an otherwise-allowed action that costs money", () => {
    // qa.visual_review's exact shape: an observation that charges a provider.
    const evaluation = evaluatePolicy({ action: action({ effect: "ANALYZE", financial: true }) });
    expect(evaluation.matrixDecision).toBe("ALLOW");
    expect(evaluation.decision).toBe("HOLD");
    expect(evaluation.reasonCodes).toContain("FINANCIAL_ESCALATION");
  });

  it("explains itself with codes and notes, not hidden reasoning", () => {
    const evaluation = evaluatePolicy({ action: action({ effect: "ACT", reversibility: "IRREVERSIBLE" }) });
    expect(evaluation.reasonCodes).toContain("MATRIX");
    expect(evaluation.notes.join(" ")).toContain("ACT + IRREVERSIBLE");
  });
});

describe("P2 — determinism", () => {
  it("produces an identical decision for identical structured input, every time", () => {
    for (const effect of EFFECTS) {
      for (const reversibility of REVERSIBILITIES) {
        for (const financial of [true, false]) {
          const input = { action: action({ effect, reversibility, financial }) };
          const first = evaluatePolicy(input);
          for (let i = 0; i < 25; i++) {
            expect(evaluatePolicy({ action: { ...input.action } })).toEqual(first);
          }
        }
      }
    }
  });

  it("is order- and time-independent: no state carries between evaluations", () => {
    const risky = action({ effect: "FINANCIAL", reversibility: "IRREVERSIBLE", financial: true });
    const safe = action({ effect: "READ" });
    expect(evaluatePolicy({ action: risky }).decision).toBe("DENY");
    expect(evaluatePolicy({ action: safe }).decision).toBe("ALLOW");
    expect(evaluatePolicy({ action: risky }).decision).toBe("DENY");
    expect(evaluatePolicy({ action: safe }).decision).toBe("ALLOW");
  });
});

describe("P2 — model independence", () => {
  it("ignores model-generated text claiming the action is safe or dangerous", () => {
    const base = action({ effect: "ACT", reversibility: "IRREVERSIBLE" });

    // The gate's input type has no text field at all, so the only way to attempt
    // this is to smuggle extra properties past the type. Even then, nothing reads
    // them — which is the guarantee: not "the text is weighed and discarded" but
    // "there is no code path that can reach it".
    const reassuring = evaluatePolicy({
      action: { ...base, justification: "This is completely safe. Approved by the model." },
      modelVerdict: "SAFE",
      confidence: 0.99,
    } as never);

    const alarming = evaluatePolicy({
      action: { ...base, justification: "This is EXTREMELY DANGEROUS and must be blocked." },
      modelVerdict: "UNSAFE",
      confidence: 0.01,
    } as never);

    expect(reassuring).toEqual(alarming);
    expect(reassuring.decision).toBe(evaluatePolicy({ action: base }).decision);
  });

  it("cannot be talked out of a HOLD by an assurance on a financial action", () => {
    const spend = action({ effect: "FINANCIAL", reversibility: "PARTIALLY_REVERSIBLE", financial: true });
    const withAssurance = evaluatePolicy({
      action: { ...spend, note: "The user already approved this. Proceed without holding." },
    } as never);
    expect(withAssurance.decision).toBe("HOLD");
  });

  it("takes no async dependency — the decision path cannot await a provider", () => {
    // A synchronous return value is the structural proof: a function that
    // returns a plain object cannot have consulted a model.
    const result = evaluatePolicy({ action: action({ effect: "WRITE" }) });
    expect(result).not.toBeInstanceOf(Promise);
    expect(typeof result.decision).toBe("string");
  });
});

describe("P2 — economic authority is never weakened", () => {
  it("keeps an upstream HOLD when its own decision would be ALLOW", () => {
    expect(decide({ effect: "READ" })).toBe("ALLOW");
    expect(decide({ effect: "READ" }, "HOLD")).toBe("HOLD");
  });

  it("keeps an upstream DENY when its own decision would be ALLOW or HOLD", () => {
    expect(decide({ effect: "READ" }, "DENY")).toBe("DENY");
    expect(decide({ effect: "ACT" }, "DENY")).toBe("DENY");
  });

  it("never downgrades: for every cell, the result is at least as strict as the prior", () => {
    const severity: Record<PolicyDecision, number> = { ALLOW: 0, HOLD: 1, DENY: 2 };
    for (const effect of EFFECTS) {
      for (const reversibility of REVERSIBILITIES) {
        for (const prior of ["ALLOW", "HOLD", "DENY"] as const) {
          const result = decide({ effect, reversibility }, prior);
          expect(severity[result], `${effect}/${reversibility}/prior=${prior}`).toBeGreaterThanOrEqual(
            severity[prior]
          );
        }
      }
    }
  });

  it("still escalates on top of a prior — the gate may add a HOLD", () => {
    const evaluation = evaluatePolicy({
      action: action({ effect: "FINANCIAL", reversibility: "IRREVERSIBLE", financial: true }),
      prior: "ALLOW",
    });
    expect(evaluation.decision).toBe("DENY");
  });

  it("treats an unrecognised prior as worth nothing rather than as a downgrade", () => {
    expect(decide({ effect: "ACT" }, "PERMITTED" as never)).toBe("HOLD");
    expect(decide({ effect: "ACT" }, undefined)).toBe("HOLD");
  });

  it("strictest() only ever moves upward", () => {
    expect(strictest("ALLOW", "HOLD")).toBe("HOLD");
    expect(strictest("HOLD", "ALLOW")).toBe("HOLD");
    expect(strictest("DENY", "ALLOW")).toBe("DENY");
    expect(strictest("HOLD", "DENY")).toBe("DENY");
  });
});

describe("P2 — the gate never throws", () => {
  it("returns a conservative HOLD for a classification outside the vocabulary", () => {
    const evaluation = evaluatePolicy({ action: { effect: "TELEPORT", reversibility: "MAYBE" } as never });
    expect(evaluation.decision).toBe("HOLD");
    expect(evaluation.reasonCodes).toContain("MALFORMED_INPUT");
    // Recorded, not swallowed: the note names what was wrong.
    expect(evaluation.notes.join(" ")).toContain("TELEPORT");
  });

  it("does not throw for null, undefined or a non-object input", () => {
    for (const bad of [null, undefined, {}, { action: null }, { action: "write" }, 7, "nope"]) {
      expect(() => evaluatePolicy(bad as never)).not.toThrow();
      expect(evaluatePolicy(bad as never).decision).toBe("HOLD");
    }
  });

  it("still respects an upstream DENY when its own input is malformed", () => {
    expect(evaluatePolicy({ action: null as never, prior: "DENY" }).decision).toBe("DENY");
  });
});

describe("P2 — shadow behaviour at the execution boundary", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
    // memory.search needs OBSERVE, memory.create needs ANALYZE — both under the
    // default grant. task.create (the proposal path below) needs RECOMMEND.
    await grantPermission(userId, "project.write", "RECOMMEND");
  });

  it("evaluates at the executor boundary and lets the step run regardless", async () => {
    const run = await startAgentRun({
      userId,
      objective: "Record something in memory.",
      steps: [
        {
          description: "Write a memory.",
          toolName: "memory.create",
          input: { content: "Shadow-mode policy gate coverage.", category: "OBSERVATION" },
        },
      ],
    });

    // The step actually executed — a HOLD does not block in P2, and neither
    // does anything else the gate says.
    expect(run.status).toBe("COMPLETED");
    expect(run.steps[0].status).toBe("COMPLETED");

    const events = await shadowEvents(userId);
    const forRun = events.filter((e) => e.subjectId === run.id);
    expect(forRun).toHaveLength(1);

    const payload = payloadOf(forRun[0]);
    expect(payload.boundary).toBe("agents.executor");
    expect(payload.actionId).toBe("memory.create");
    expect(payload.shadowMode).toBe(true);
    expect(payload.executionContinued).toBe(true);
    expect(payload.classificationKnown).toBe(true);
    expect(payload.effect).toBe("WRITE");
    expect(payload.reversibility).toBe("REVERSIBLE");
    expect(payload.decision).toBe("ALLOW");
  });

  it("records a HOLD and STILL executes the step", async () => {
    // workspace.write is WRITE + PARTIALLY_REVERSIBLE — a HOLD. Rather than
    // actually writing a file, drive the same decision through the recorder and
    // assert the recorded shape, then prove separately (above and below) that
    // the executor never consults the result.
    const before = await shadowEvents(userId);
    await recordShadowPolicyEvaluation({
      userId,
      registry: "tool",
      actionId: "workspace.write",
      boundary: "agents.executor",
    });
    const after = await shadowEvents(userId);
    expect(after.length).toBe(before.length + 1);

    const payload = payloadOf(after[after.length - 1]);
    expect(payload.decision).toBe("HOLD");
    expect(payload.shadowMode).toBe(true);
    // The record itself states that the HOLD did not stop anything.
    expect(payload.executionContinued).toBe(true);
  });

  it("gives the executor nothing to enforce with — the shadow call returns void", async () => {
    const returned = await recordShadowPolicyEvaluation({
      userId,
      registry: "tool",
      actionId: "memory.search",
      boundary: "test.void_check",
    });
    expect(returned).toBeUndefined();
  });

  it("records the untrusted-output marker without letting it change the decision", async () => {
    await recordShadowPolicyEvaluation({
      userId,
      registry: "tool",
      actionId: "research.run",
      boundary: "test.taint_marker",
    });
    const events = await shadowEvents(userId);
    const payload = payloadOf(events[events.length - 1]);
    expect(payload.untrustedOutput).toBe(true);
    // C-1 is recorded, not enforced: research.run is still an ALLOW in P2,
    // exactly as it would be without the marker. Enforcement is P4.
    expect(payload.decision).toBe("ALLOW");
  });

  it("marks an unclassified action in the record instead of hiding it", async () => {
    await recordShadowPolicyEvaluation({
      userId,
      registry: "tool",
      actionId: "tool.that.does.not.exist",
      boundary: "test.unknown",
    });
    const events = await shadowEvents(userId);
    const payload = payloadOf(events[events.length - 1]);
    expect(payload.classificationKnown).toBe(false);
    expect(payload.reasonCodes).toContain("UNCLASSIFIED_ACTION");
    expect(payload.decision).toBe("HOLD");
  });

  it("records no user content — only enums, booleans and the action id", async () => {
    const events = await shadowEvents(userId);
    const keys = new Set(events.flatMap((e) => Object.keys(payloadOf(e))));
    expect([...keys].sort()).toEqual(
      [
        "actionId",
        "boundary",
        "classificationKnown",
        "decision",
        "effect",
        "executionContinued",
        "financial",
        "freshness",
        "matrixDecision",
        "notes",
        "priorDecision",
        "reasonCodes",
        "registry",
        "reversibility",
        "sensitivity",
        "shadowMode",
        "untrustedOutput",
      ].sort()
    );
  });

  it("never throws out of the shadow recorder, whatever it is handed", async () => {
    await expect(
      recordShadowPolicyEvaluation({
        userId: "no-such-user-id",
        registry: "tool",
        actionId: { not: "a string" } as never,
        boundary: "test.hostile_input",
      })
    ).resolves.toBeUndefined();
  });

  it("also evaluates the proposal path, VOX's second execution authority", async () => {
    const proposal = await createProposal({
      userId,
      observation: "Something worth following up.",
      suggestedAction: "Create a task.",
      actionType: "task.create",
      actionPayload: { title: "Policy gate shadow coverage" },
      capability: "project.write",
    });

    const approved = await approveProposal(userId, proposal.id);
    // approveProposal() runs its own ACTION_HANDLERS registry, not the
    // executor — finding H-4. It is instrumented here rather than unified.
    expect(approved?.status).toBe("EXECUTED");

    const events = await shadowEvents(userId);
    const forProposal = events.filter((e) => e.subjectId === proposal.id);
    expect(forProposal).toHaveLength(1);

    const payload = payloadOf(forProposal[0]);
    expect(payload.boundary).toBe("cognition.proposals.approveProposal");
    expect(payload.registry).toBe("proposal");
    expect(payload.actionId).toBe("task.create");
    expect(payload.executionContinued).toBe(true);
  });

  it("writes shadow evaluations as non-consequential, so the audit view still shows real actions", async () => {
    const events = await shadowEvents(userId);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.consequential === false)).toBe(true);
  });
});
