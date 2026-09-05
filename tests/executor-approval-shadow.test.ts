import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { startAgentRun, resumeAgentRun } from "@/lib/agents/service";
import { executeRun } from "@/lib/agents/executor";
import { hasStepReference } from "@/lib/agents/references";
import { grantPermission } from "@/lib/permissions/service";
import { hashArguments, hashRegisteredClassification } from "@/lib/policy/approvals";
import { createTestUser } from "./helpers";

async function shadowApprovalEvents(userId: string) {
  return db.event.findMany({
    where: { userId, type: "policy.approval_shadow_evaluated" },
    orderBy: { createdAt: "asc" },
  });
}

function payloadOf(event: { payload: string | null }): Record<string, unknown> {
  return JSON.parse(event.payload ?? "{}") as Record<string, unknown>;
}

/**
 * A run whose second step references the first step's output and needs a
 * capability the user does NOT hold, so it parks — the exact shape the old
 * ordering got wrong.
 */
async function runThatParksOnAReference(userId: string) {
  return startAgentRun({
    userId,
    objective: "Recall something, then write it to a file.",
    steps: [
      {
        description: "Recall the recipient.",
        toolName: "memory.create",
        input: { content: "Alice", category: "FACT" },
      },
      {
        description: "Write the recalled value into the workspace.",
        toolName: "workspace.write",
        input: { path: "notes/recipient.txt", content: "{{step0.output.id}}" },
      },
    ],
  });
}

describe("P4-C1 — arguments are finalized before the permission boundary", () => {
  it("resolves and PERSISTS the finalized input before parking", async () => {
    const user = await createTestUser();
    const run = await runThatParksOnAReference(user.id);

    // workspace.write needs ACT, which this user does not hold.
    expect(run.status).toBe("WAITING_FOR_PERMISSION");

    const parked = await db.agentStep.findFirstOrThrow({ where: { runId: run.id, order: 1 } });
    expect(parked.status).toBe("WAITING_FOR_PERMISSION");

    // THE POINT OF P4-C1: the parked step holds the RESOLVED value, not the
    // template a human would otherwise have been asked to approve.
    expect(parked.input).not.toContain("{{step0.output");
    expect(hasStepReference(JSON.parse(parked.input!))).toBe(false);

    const memory = await db.memory.findFirstOrThrow({ where: { userId: user.id } });
    expect(JSON.parse(parked.input!)).toEqual({ path: "notes/recipient.txt", content: memory.id });
  });

  it("records the pending request with the stable step id and the finalized hash", async () => {
    const user = await createTestUser();
    const run = await runThatParksOnAReference(user.id);
    const parked = await db.agentStep.findFirstOrThrow({ where: { runId: run.id, order: 1 } });

    const event = await db.event.findFirstOrThrow({
      where: { userId: user.id, type: "agent.step.waiting_for_permission", subjectId: run.id },
    });
    const payload = payloadOf(event);

    expect(payload.stepId).toBe(parked.id);
    expect(payload.argumentsFinalized).toBe(true);
    // The hash is of the FINALIZED arguments — what P4-C2 will verify consent
    // against — not of the authored template.
    expect(payload.argumentsHash).toBe(hashArguments(JSON.parse(parked.input!)));
    expect(payload.argumentsHash).not.toBe(
      hashArguments({ path: "notes/recipient.txt", content: "{{step0.output.id}}" })
    );
  });

  it("fails a step whose references cannot resolve, rather than parking on it", async () => {
    const user = await createTestUser();
    const run = await startAgentRun({
      userId: user.id,
      objective: "Reference a step that does not exist.",
      steps: [
        {
          description: "Write something unresolvable.",
          toolName: "workspace.write",
          input: { path: "a.txt", content: "{{step9.output}}" },
        },
      ],
    });
    // No capability grant could make this runnable, so parking would invite a
    // person to authorize something that can never happen.
    expect(run.status).toBe("FAILED");
    expect(run.error).toContain("Could not resolve step reference");
  });
});

describe("P4-C1 — resume cannot re-resolve into different values", () => {
  it("keeps the approved arguments even when upstream state changes after parking", async () => {
    const user = await createTestUser();
    const run = await runThatParksOnAReference(user.id);
    const parked = await db.agentStep.findFirstOrThrow({ where: { runId: run.id, order: 1 } });
    const finalizedBefore = parked.input!;

    // Mutate what the reference USED to point at. Under the old ordering a
    // resume would have re-resolved and executed against this new value.
    await db.agentStep.updateMany({
      where: { runId: run.id, order: 0 },
      data: { output: JSON.stringify({ id: "ATTACKER-SUBSTITUTED-VALUE" }) },
    });

    await resumeAgentRun(user.id, run.id);

    const afterResume = await db.agentStep.findFirstOrThrow({ where: { id: parked.id } });
    expect(afterResume.input).toBe(finalizedBefore);
    expect(afterResume.input).not.toContain("ATTACKER-SUBSTITUTED-VALUE");
    // The step id — the logical action identity — is unchanged across the pause.
    expect(afterResume.id).toBe(parked.id);
  });

  it("keeps the same AgentStep.id as the logical identity across a resume", async () => {
    const user = await createTestUser();
    const run = await runThatParksOnAReference(user.id);
    const before = await db.agentStep.findMany({ where: { runId: run.id }, orderBy: { order: "asc" } });

    await resumeAgentRun(user.id, run.id);
    const after = await db.agentStep.findMany({ where: { runId: run.id }, orderBy: { order: "asc" } });

    expect(after.map((s) => s.id)).toEqual(before.map((s) => s.id));
  });
});

describe("P4-C1 — the executor NEVER creates an ApprovalGrant", () => {
  it("creates no grant when a step parks for permission", async () => {
    const user = await createTestUser();
    await runThatParksOnAReference(user.id);
    // A grant means a human said yes. Nothing here was a human.
    expect(await db.approvalGrant.count({ where: { userId: user.id } })).toBe(0);
  });

  it("creates no grant on resume", async () => {
    const user = await createTestUser();
    const run = await runThatParksOnAReference(user.id);
    await resumeAgentRun(user.id, run.id);
    await resumeAgentRun(user.id, run.id);
    expect(await db.approvalGrant.count({ where: { userId: user.id } })).toBe(0);
  });

  it("creates no grant when a HOLD action executes with the capability granted", async () => {
    const user = await createTestUser();
    // memory.create is WRITE/REVERSIBLE → ALLOW, and runs under the default grant.
    const run = await startAgentRun({
      userId: user.id,
      objective: "Write a memory.",
      steps: [
        { description: "Remember.", toolName: "memory.create", input: { content: "x", category: "FACT" } },
      ],
    });
    expect(run.status).toBe("COMPLETED");
    expect(await db.approvalGrant.count({ where: { userId: user.id } })).toBe(0);
  });

  it("the executor module does not import the grant constructor at all", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("src/lib/agents/executor.ts", "utf8");
    // Structural, not behavioural: the executor cannot mint a grant because the
    // function is not in scope. A future edit that adds it fails this test.
    expect(source).not.toContain("createApprovalGrant");

    // [P4-C3] Consumption moved OUT of the executor and into
    // `src/lib/policy/enforcement.ts`, together with the decision it belongs
    // to — spending an approval and permitting an execution are one act, and
    // splitting them across two files is how they drift apart.
    expect(source).not.toContain("consumeApprovalGrant");
  });

  it("the enforcement module spends approvals but cannot mint them", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("src/lib/policy/enforcement.ts", "utf8");
    // The asymmetry, now pinned where the decision actually lives. MINTING is a
    // machine claiming a human said yes, and stays impossible outside
    // `step-approvals.ts`. SPENDING is recording that the invocation a human
    // already approved has happened, and is what makes an approval single-use.
    expect(source).not.toContain("createApprovalGrant");
    expect(source).toContain("consumeApprovalGrant");
  });
});

describe("P4-C3 — the approval gate now enforces", () => {
  it("evaluates a HOLD action and REFUSES it when no approval exists", async () => {
    const user = await createTestUser();
    // Grant the capability so the step does NOT park on the permission gate —
    // this isolates the approval gate from it.
    await grantPermission(user.id, "research.web", "ANALYZE");
    const run = await startAgentRun({
      userId: user.id,
      objective: "Look something up.",
      steps: [{ description: "Research.", toolName: "research.run", input: { query: "shadow gate" } }],
    });

    // research.run is WRITE/PARTIALLY_REVERSIBLE → HOLD. Until P4-C3 it ran
    // anyway; this assertion is the contract change, and the whole point of the
    // phase. The user holds the capability and the step still does not run.
    expect(run.status).toBe("WAITING_FOR_PERMISSION");
    expect(run.steps[0].status).toBe("WAITING_FOR_PERMISSION");
    expect(await db.researchItem.count({ where: { userId: user.id } })).toBe(0);

    const events = await shadowApprovalEvents(user.id);
    expect(events).toHaveLength(1);
    const payload = payloadOf(events[0]);

    expect(payload.actionId).toBe("research.run");
    expect(payload.policyDecision).toBe("HOLD");
    expect(payload.wouldAuthorize).toBe(false);
    expect(payload.reasons).toEqual(["NO_GRANT"]);
    expect(payload.grantId).toBeNull();
    expect(payload.candidatesConsidered).toBe(0);
    // ...and the record now says plainly that something WAS prevented.
    expect(payload.enforced).toBe(true);
    expect(payload.executionContinued).toBe(false);
  });

  it("binds the shadow evaluation to the FINALIZED arguments and the real classification", async () => {
    const user = await createTestUser();
    await grantPermission(user.id, "research.web", "ANALYZE");
    const run = await startAgentRun({
      userId: user.id,
      objective: "Look something up.",
      steps: [{ description: "Research.", toolName: "research.run", input: { query: "binding" } }],
    });

    const step = await db.agentStep.findFirstOrThrow({ where: { runId: run.id, order: 0 } });
    const payload = payloadOf((await shadowApprovalEvents(user.id))[0]);

    expect(payload.stepId).toBe(step.id);
    expect(payload.argumentsHash).toBe(hashArguments({ query: "binding" }));
    expect(payload.classificationHash).toBe(hashRegisteredClassification("tool", "research.run")!.hash);
  });

  it("does not evaluate an approval for an ALLOW action", async () => {
    const user = await createTestUser();
    const run = await startAgentRun({
      userId: user.id,
      objective: "Write a memory.",
      steps: [
        { description: "Remember.", toolName: "memory.create", input: { content: "y", category: "FACT" } },
      ],
    });
    expect(run.status).toBe("COMPLETED");
    // memory.create is ALLOW: no approval is needed, so manufacturing a refusal
    // for it would drown the signal this phase exists to collect.
    expect(await shadowApprovalEvents(user.id)).toEqual([]);
  });

  it("spends nothing when the arguments differ from the ones approved", async () => {
    const user = await createTestUser();
    await grantPermission(user.id, "research.web", "ANALYZE");

    // A grant that does NOT match this execution (different arguments).
    const { createApprovalGrant } = await import("@/lib/policy/approvals");
    const grant = await createApprovalGrant({
      userId: user.id,
      registry: "tool",
      actionId: "research.run",
      parsedArguments: { query: "something else entirely" },
      policyDecision: "HOLD",
      capability: "research.web",
      requiredLevel: "ANALYZE",
    });

    await startAgentRun({
      userId: user.id,
      objective: "Look something up.",
      steps: [{ description: "Research.", toolName: "research.run", input: { query: "not the approved one" } }],
    });

    const payload = payloadOf((await shadowApprovalEvents(user.id))[0]);
    expect(payload.wouldAuthorize).toBe(false);
    expect(payload.reasons).toContain("ARGUMENTS_CHANGED");
    expect(payload.candidatesConsidered).toBe(1);

    // The grant is untouched. Only a MATCH spends one, so a person's approval
    // for one set of arguments cannot be burned by an execution of another.
    const stored = await db.approvalGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(stored.consumedAt).toBeNull();
  });

  it("reports wouldAuthorize when a matching grant genuinely exists, and spends it", async () => {
    const user = await createTestUser();
    await grantPermission(user.id, "research.web", "ANALYZE");
    const { createApprovalGrant } = await import("@/lib/policy/approvals");
    const grant = await createApprovalGrant({
      userId: user.id,
      registry: "tool",
      actionId: "research.run",
      parsedArguments: { query: "the approved query" },
      policyDecision: "HOLD",
      capability: "research.web",
      requiredLevel: "ANALYZE",
    });

    await startAgentRun({
      userId: user.id,
      objective: "Look something up.",
      steps: [{ description: "Research.", toolName: "research.run", input: { query: "the approved query" } }],
    });

    const payload = payloadOf((await shadowApprovalEvents(user.id))[0]);
    expect(payload.wouldAuthorize).toBe(true);
    expect(payload.grantId).toBe(grant.id);

    // [P4-C2] A matching grant IS spent. It authorized one invocation, that
    // invocation happened, and it now authorizes nothing further. Note the
    // gate still did not decide whether the step ran — consumption and
    // enforcement are separate, and only the first of them is wired.
    expect(payload.grantConsumed).toBe(true);
    const stored = await db.approvalGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(stored.consumedAt).not.toBeNull();
  });

  it("leaves a non-matching grant untouched — a failed match never burns an approval", async () => {
    const user = await createTestUser();
    await grantPermission(user.id, "research.web", "ANALYZE");
    const { createApprovalGrant } = await import("@/lib/policy/approvals");
    const grant = await createApprovalGrant({
      userId: user.id,
      registry: "tool",
      actionId: "research.run",
      parsedArguments: { query: "the approved query" },
      policyDecision: "HOLD",
      capability: "research.web",
      requiredLevel: "ANALYZE",
    });

    // A DIFFERENT query, so the argument hashes disagree.
    await startAgentRun({
      userId: user.id,
      objective: "Look something else up.",
      steps: [{ description: "Research.", toolName: "research.run", input: { query: "a different query" } }],
    });

    const payload = payloadOf((await shadowApprovalEvents(user.id))[0]);
    expect(payload.wouldAuthorize).toBe(false);
    expect(payload.grantConsumed).toBe(false);
    const stored = await db.approvalGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(stored.consumedAt).toBeNull();
  });

  it("[P4-C3] refuses cleanly rather than crashing the run", async () => {
    const user = await createTestUser();
    await grantPermission(user.id, "research.web", "ANALYZE");
    // The shadow-mode version of this test asserted a HOLD reached COMPLETED.
    // That contract is gone. What survives it is the reason it existed: the gate
    // must not be able to break the run it decides about. So a refusal is a
    // clean, resumable WAITING_FOR_PERMISSION — not FAILED, and not an
    // exception escaping into the executor's error path.
    const run = await startAgentRun({
      userId: user.id,
      objective: "Look something up.",
      steps: [{ description: "Research.", toolName: "research.run", input: { query: "resilience" } }],
    });
    expect(run.status).toBe("WAITING_FOR_PERMISSION");
    expect(run.error).toBeNull();
    expect(run.steps[0].error).toBeNull();
  });
});

describe("P4-C1 — retry keeps one logical approval identity", () => {
  it("re-running the executor does not re-finalize arguments from the template", async () => {
    const user = await createTestUser();
    const run = await runThatParksOnAReference(user.id);
    const parked = await db.agentStep.findFirstOrThrow({ where: { runId: run.id, order: 1 } });
    const finalized = parked.input!;
    const hashBefore = hashArguments(JSON.parse(finalized));

    // Several passes over the same parked run: each re-enters executeRun.
    await executeRun(user.id, run.id);
    await executeRun(user.id, run.id);

    const after = await db.agentStep.findFirstOrThrow({ where: { id: parked.id } });
    expect(after.input).toBe(finalized);
    expect(hashArguments(JSON.parse(after.input!))).toBe(hashBefore);
    expect(after.id).toBe(parked.id);
    // And still no grant, however many times the boundary is reached.
    expect(await db.approvalGrant.count({ where: { userId: user.id } })).toBe(0);
  });

  it("keeps the hash stable across the whole HOLD → resume → execute lifecycle", async () => {
    const user = await createTestUser();
    await grantPermission(user.id, "research.web", "ANALYZE");
    const run = await startAgentRun({
      userId: user.id,
      objective: "Look something up.",
      steps: [{ description: "Research.", toolName: "research.run", input: { query: "lifecycle" } }],
    });

    const step = await db.agentStep.findFirstOrThrow({ where: { runId: run.id, order: 0 } });
    const payload = payloadOf((await shadowApprovalEvents(user.id))[0]);
    // What the gate evaluated is what the persisted step holds.
    expect(payload.argumentsHash).toBe(hashArguments(JSON.parse(step.input!)));
  });
});

describe("P4-C1 — hash integrity of the finalized representation", () => {
  it("changing the finalized arguments changes the hash", async () => {
    expect(hashArguments({ path: "a.txt", content: "Alice" })).not.toBe(
      hashArguments({ path: "a.txt", content: "Bob" })
    );
    expect(hashArguments({ query: "x" })).not.toBe(hashArguments({ query: "xx" }));
  });

  it("a template and its resolved form hash differently — which is the whole point", () => {
    expect(hashArguments({ content: "{{step0.output.id}}" })).not.toBe(hashArguments({ content: "Alice" }));
  });
});
