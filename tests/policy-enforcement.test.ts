import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { startAgentRun, resumeAgentRun } from "@/lib/agents/service";
import { executeRun } from "@/lib/agents/executor";
import { grantPermission } from "@/lib/permissions/service";
import {
  createApprovalGrant,
  consumeApprovalGrant,
  hashArguments,
  STEP_APPROVAL_TARGET_TYPE,
} from "@/lib/policy/approvals";
import { getPendingStepApproval, approveAgentStep, rejectAgentStep } from "@/lib/policy/step-approvals";
import { enforceStepExecution } from "@/lib/policy/enforcement";
import { createTestUser } from "./helpers";

/**
 * P4-C3 — ENFORCEMENT.
 *
 * One question, asked twenty ways:
 *
 *   CAN A HOLD ACTION EXECUTE WITHOUT A VALID, MATCHING, UNCONSUMED HUMAN
 *   APPROVAL FOR THAT EXACT EXECUTION?
 *
 * Every test here answers no, and none of them answers it by reading a status
 * field alone. A run can be marked WAITING_FOR_PERMISSION while its tool has
 * already fired, so the assertions look for the tool's OWN side effect —
 * `research.run` writes ResearchItem rows, `workspace.write` writes a file. If
 * enforcement were cosmetic those rows would still be there.
 *
 * `research.run` is the workhorse: WRITE + PARTIALLY_REVERSIBLE → HOLD, at the
 * ANALYZE level, so a test can hold the capability and still be refused. That
 * separation matters — it is what proves the block is the POLICY gate and not
 * the permission gate wearing its clothes.
 */

let workspace: string;
let previousWorkspaceRoot: string | undefined;

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "vox-enforce-"));
  previousWorkspaceRoot = process.env.VOX_WORKSPACE_ROOT;
  process.env.VOX_WORKSPACE_ROOT = workspace;
});

afterAll(async () => {
  if (previousWorkspaceRoot === undefined) delete process.env.VOX_WORKSPACE_ROOT;
  else process.env.VOX_WORKSPACE_ROOT = previousWorkspaceRoot;
  await rm(workspace, { recursive: true, force: true });
});

/** A run holding one HOLD step, with the capability already granted. */
async function heldRun(userId: string, query = "enforcement") {
  await grantPermission(userId, "research.web", "ANALYZE");
  const run = await startAgentRun({
    userId,
    objective: "Look something up.",
    steps: [{ description: "Research.", toolName: "research.run", input: { query } }],
  });
  const step = await db.agentStep.findFirstOrThrow({ where: { runId: run.id, order: 0 } });
  return { run, step };
}

/** The tool's own side effect. Present only if `research.run` really ran. */
function researchRows(userId: string) {
  return db.researchItem.count({ where: { userId } });
}

async function approve(userId: string, runId: string, stepId: string) {
  const pending = await getPendingStepApproval(userId, runId, stepId);
  if (!pending.found) throw new Error(`expected a pending approval, got ${pending.reason}`);
  const result = await approveAgentStep({ userId, runId, stepId, argumentsHash: pending.pending.argumentsHash });
  if (!result.approved) throw new Error(`expected approval, got ${result.reason}`);
  return result.grant;
}

function payloadOf(event: { payload: string | null }): Record<string, unknown> {
  return JSON.parse(event.payload ?? "{}") as Record<string, unknown>;
}

async function refusals(userId: string) {
  return (
    await db.event.findMany({ where: { userId, type: "policy.execution_refused" }, orderBy: { createdAt: "asc" } })
  ).map(payloadOf);
}

describe("P4-C3 — a HOLD does not execute without an approval", () => {
  it("refuses the tool outright, with the capability already held", async () => {
    const user = await createTestUser();
    const { run } = await heldRun(user.id);

    expect(run.status).toBe("WAITING_FOR_PERMISSION");
    expect(run.steps[0].status).toBe("WAITING_FOR_PERMISSION");
    // THE CLAIM. Not "the status says stopped" — the work did not happen.
    expect(await researchRows(user.id)).toBe(0);

    const refused = await refusals(user.id);
    expect(refused).toHaveLength(1);
    expect(refused[0].decision).toBe("HOLD");
    expect(refused[0].disposition).toBe("AWAIT_APPROVAL");
    expect(refused[0].reasons).toEqual(["NO_GRANT"]);
    expect(refused[0].executionContinued).toBe(false);
  });

  it("keeps refusing however many times it is resumed", async () => {
    const user = await createTestUser();
    const { run } = await heldRun(user.id);

    // Resume is not approval, and repeating it is not approval either.
    await resumeAgentRun(user.id, run.id);
    await resumeAgentRun(user.id, run.id);
    await executeRun(user.id, run.id);

    expect(await researchRows(user.id)).toBe(0);
    expect(await db.approvalGrant.count({ where: { userId: user.id } })).toBe(0);
  });

  it("executes once a human approves the exact arguments", async () => {
    const user = await createTestUser();
    const { run, step } = await heldRun(user.id);
    const grant = await approve(user.id, run.id, step.id);

    const finished = await resumeAgentRun(user.id, run.id);
    expect(finished?.status).toBe("COMPLETED");
    expect(await researchRows(user.id)).toBeGreaterThan(0);

    // Spent exactly once, on the invocation it was given for.
    const stored = await db.approvalGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(stored.consumedAt).not.toBeNull();
    expect(await db.event.count({ where: { userId: user.id, type: "policy.approval_consumed" } })).toBe(1);
  });

  it("still executes an ALLOW action with no approval at all", async () => {
    const user = await createTestUser();
    // memory.create is WRITE + REVERSIBLE → ALLOW. P4-C3 is not "everything
    // needs a human", and a gate that held ordinary work would be unusable.
    const run = await startAgentRun({
      userId: user.id,
      objective: "Write a memory.",
      steps: [{ description: "Remember.", toolName: "memory.create", input: { content: "x", category: "FACT" } }],
    });

    expect(run.status).toBe("COMPLETED");
    expect(await db.memory.count({ where: { userId: user.id } })).toBe(1);
    expect(await db.approvalGrant.count({ where: { userId: user.id } })).toBe(0);
    expect(await refusals(user.id)).toEqual([]);
  });
});

describe("P4-C3 — an approval authorizes ONE execution", () => {
  it("cannot authorize a second run of the same step", async () => {
    const user = await createTestUser();
    const { run, step } = await heldRun(user.id);
    await approve(user.id, run.id, step.id);
    await resumeAgentRun(user.id, run.id);

    const after = await researchRows(user.id);
    expect(after).toBeGreaterThan(0);

    // Re-open the same logical step and drive it again. The approval is spent,
    // so this is an unapproved HOLD like any other.
    await db.agentStep.update({
      where: { id: step.id },
      data: { status: "PENDING", output: null, completedAt: null },
    });
    await db.agentRun.update({ where: { id: run.id }, data: { status: "RUNNING", currentStep: 0 } });
    const replayed = await executeRun(user.id, run.id);

    expect(replayed.status).toBe("WAITING_FOR_PERMISSION");
    expect(await researchRows(user.id)).toBe(after);
    expect((await refusals(user.id)).at(-1)!.reasons).toEqual(["NO_GRANT"]);
  });

  it("is not spent by an execution that was refused", async () => {
    const user = await createTestUser();
    const { run, step } = await heldRun(user.id);
    const grant = await approve(user.id, run.id, step.id);

    // The action is rewritten after approval — the grant no longer describes it.
    await db.agentStep.update({
      where: { id: step.id },
      data: { input: JSON.stringify({ query: "something else entirely" }) },
    });
    const resumed = await resumeAgentRun(user.id, run.id);

    expect(resumed?.status).toBe("WAITING_FOR_PERMISSION");
    expect(await researchRows(user.id)).toBe(0);
    expect((await refusals(user.id)).at(-1)!.reasons).toContain("ARGUMENTS_CHANGED");
    // And the person's approval survives to be re-used on what they approved.
    expect((await db.approvalGrant.findUniqueOrThrow({ where: { id: grant.id } })).consumedAt).toBeNull();
  });

  it("cannot be spent twice by two concurrent executions", async () => {
    const user = await createTestUser();
    const { run, step } = await heldRun(user.id);
    const grant = await approve(user.id, run.id, step.id);

    const argumentsHash = hashArguments({ query: "enforcement" });
    const call = () =>
      enforceStepExecution({
        userId: user.id,
        registry: "tool",
        actionId: "research.run",
        argumentsHash,
        capability: "research.web",
        requiredLevel: "ANALYZE",
        targetType: STEP_APPROVAL_TARGET_TYPE,
        targetId: step.id,
        runId: run.id,
        stepId: step.id,
      });

    // Both read the grant as live in the same tick; the compare-and-swap decides
    // between them. The loser must REFUSE — a near miss that fell through to
    // "permitted" would be the replay this whole model exists to prevent.
    const [a, b] = await Promise.all([call(), call()]);
    const permitted = [a, b].filter((r) => r.permitted);
    const refused = [a, b].filter((r) => !r.permitted);
    expect(permitted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].permitted).toBe(false);
    if (!refused[0].permitted) {
      expect(refused[0].reasons).toEqual(["ALREADY_CONSUMED"]);
      expect(refused[0].disposition).toBe("AWAIT_APPROVAL");
    }
    expect((await db.approvalGrant.findUniqueOrThrow({ where: { id: grant.id } })).consumedAt).not.toBeNull();
  });

  it("spends one approval per execution, not one per retry", async () => {
    const user = await createTestUser();
    const { run, step } = await heldRun(user.id);
    await approve(user.id, run.id, step.id);
    await resumeAgentRun(user.id, run.id);

    // The consumption site sits outside the retry loop, so one attempt to run a
    // step is one decision however many times the tool call is retried.
    expect(await db.event.count({ where: { userId: user.id, type: "policy.approval_consumed" } })).toBe(1);
    expect(await db.approvalGrant.count({ where: { userId: user.id } })).toBe(1);
  });
});

describe("P4-C3 — an approval is bound to one exact execution", () => {
  it("does not authorize a sibling step in the same run", async () => {
    const user = await createTestUser();
    await grantPermission(user.id, "research.web", "ANALYZE");
    // Two identical steps. Same user, same run, same action, same arguments —
    // the step id is the only thing separating them.
    const run = await startAgentRun({
      userId: user.id,
      objective: "Look it up twice.",
      steps: [
        { description: "Research.", toolName: "research.run", input: { query: "siblings" } },
        { description: "Research again.", toolName: "research.run", input: { query: "siblings" } },
      ],
    });
    const [first, second] = await db.agentStep.findMany({ where: { runId: run.id }, orderBy: { order: "asc" } });

    await approve(user.id, run.id, first.id);
    await resumeAgentRun(user.id, run.id);

    const firstRan = await researchRows(user.id);
    expect(firstRan).toBeGreaterThan(0);
    // The sibling is refused: identical in every respect except the one that
    // the grant is bound to.
    const state = await db.agentStep.findUniqueOrThrow({ where: { id: second.id } });
    expect(state.status).toBe("WAITING_FOR_PERMISSION");

    await resumeAgentRun(user.id, run.id);
    expect(await researchRows(user.id)).toBe(firstRan);
  });

  it("does not authorize the same action in another run", async () => {
    const user = await createTestUser();
    const a = await heldRun(user.id, "cross-run");
    await approve(user.id, a.run.id, a.step.id);

    const b = await heldRun(user.id, "cross-run");
    // b's step never ran, even though a live-looking approval for byte-identical
    // arguments exists on this account.
    expect(b.run.status).toBe("WAITING_FOR_PERMISSION");
    expect(await researchRows(user.id)).toBe(0);
    expect((await refusals(user.id)).at(-1)!.reasons).toContain("WRONG_TARGET");
  });

  it("does not authorize when the capability recorded on the grant differs", async () => {
    const user = await createTestUser();
    const { run, step } = await heldRun(user.id, "capability-mismatch");
    const grant = await approve(user.id, run.id, step.id);

    // A grant that names a different capability than the execution requires.
    // Rewritten directly, because no legitimate path produces one — which is
    // the point: even a tampered row must not authorize.
    await db.approvalGrant.update({ where: { id: grant.id }, data: { capability: "memory.read" } });
    await resumeAgentRun(user.id, run.id);

    expect(await researchRows(user.id)).toBe(0);
    expect((await refusals(user.id)).at(-1)!.reasons).toContain("WRONG_CAPABILITY");
  });

  it("does not authorize when the required level recorded on the grant differs", async () => {
    const user = await createTestUser();
    const { run, step } = await heldRun(user.id, "level-mismatch");
    const grant = await approve(user.id, run.id, step.id);

    await db.approvalGrant.update({ where: { id: grant.id }, data: { requiredLevel: "OBSERVE" } });
    await resumeAgentRun(user.id, run.id);

    expect(await researchRows(user.id)).toBe(0);
    expect((await refusals(user.id)).at(-1)!.reasons).toContain("WRONG_REQUIRED_LEVEL");
  });

  it("does not authorize when the classification the approval was taken under has moved", async () => {
    const user = await createTestUser();
    const { run, step } = await heldRun(user.id, "classification-drift");
    const grant = await approve(user.id, run.id, step.id);

    // Stands in for a policy amendment: the matrix changes, so the snapshot the
    // human approved under no longer describes the action. An approval given
    // for "reversible internal write" must not survive into "irreversible".
    await db.approvalGrant.update({ where: { id: grant.id }, data: { classificationHash: "0".repeat(64) } });
    await resumeAgentRun(user.id, run.id);

    expect(await researchRows(user.id)).toBe(0);
    expect((await refusals(user.id)).at(-1)!.reasons).toContain("CLASSIFICATION_CHANGED");
  });

  it("does not authorize when the arguments hash on the grant is not the current one", async () => {
    const user = await createTestUser();
    const { run, step } = await heldRun(user.id, "hash-mismatch");
    // A grant forged directly for a DIFFERENT set of arguments, bound to the
    // right step — the closest an attacker with grant-creation could get.
    await createApprovalGrant({
      userId: user.id,
      registry: "tool",
      actionId: "research.run",
      parsedArguments: { query: "not what the step will run" },
      policyDecision: "HOLD",
      capability: "research.web",
      requiredLevel: "ANALYZE",
      targetType: STEP_APPROVAL_TARGET_TYPE,
      targetId: step.id,
    });

    await resumeAgentRun(user.id, run.id);
    expect(await researchRows(user.id)).toBe(0);
    expect((await refusals(user.id)).at(-1)!.reasons).toContain("ARGUMENTS_CHANGED");
  });

  it("does not authorize another person's execution", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const { run, step } = await heldRun(owner.id, "cross-user");
    await approve(owner.id, run.id, step.id);

    // The stranger's identical run holds no approval of their own.
    const theirs = await heldRun(stranger.id, "cross-user");
    expect(theirs.run.status).toBe("WAITING_FOR_PERMISSION");
    expect(await researchRows(stranger.id)).toBe(0);
    void step;
  });
});

describe("P4-C3 — rejection and refusal semantics", () => {
  it("an explicitly rejected step never executes", async () => {
    const user = await createTestUser();
    const { run, step } = await heldRun(user.id, "rejected");

    expect(await rejectAgentStep(user.id, run.id, step.id)).toEqual({ rejected: true });
    expect((await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("CANCELLED");

    // A cancelled run is not resumable, and nothing ran.
    await executeRun(user.id, run.id);
    expect(await researchRows(user.id)).toBe(0);
    expect(await db.approvalGrant.count({ where: { userId: user.id } })).toBe(0);
  });

  it("refuses an action with no classification, rather than letting it through", async () => {
    const user = await createTestUser();
    const outcome = await enforceStepExecution({
      userId: user.id,
      registry: "tool",
      actionId: "tool.that.was.never.classified",
      argumentsHash: hashArguments({}),
      capability: "workspace.write",
      requiredLevel: "ACT",
      targetType: STEP_APPROVAL_TARGET_TYPE,
      targetId: "step-1",
    });

    // A tool added without a table entry is the one thing the gate would
    // otherwise never see. Refusing makes that a loud failure.
    expect(outcome.permitted).toBe(false);
    if (outcome.permitted) return;
    expect(outcome.reasons).toEqual(["UNCLASSIFIED_ACTION"]);
    expect(outcome.disposition).toBe("REFUSE");
  });

  it("distinguishes waiting from a supplied approval that no longer matches", async () => {
    const user = await createTestUser();
    const { run, step } = await heldRun(user.id, "distinguishable");

    // Nobody has approved: NO_GRANT.
    expect((await refusals(user.id)).at(-1)!.reasons).toEqual(["NO_GRANT"]);

    // Somebody approved, then the action moved: ARGUMENTS_CHANGED. The two are
    // different situations for a person, and the record says which is which.
    await approve(user.id, run.id, step.id);
    await db.agentStep.update({ where: { id: step.id }, data: { input: JSON.stringify({ query: "moved" }) } });
    await resumeAgentRun(user.id, run.id);
    expect((await refusals(user.id)).at(-1)!.reasons).toContain("ARGUMENTS_CHANGED");
  });

  it("leaves a refused step resumable rather than failing the run", async () => {
    const user = await createTestUser();
    const { run, step } = await heldRun(user.id, "resumable");

    // A refusal a human can act on parks; it does not burn the run down.
    expect(run.status).toBe("WAITING_FOR_PERMISSION");
    expect(run.error).toBeNull();

    await approve(user.id, run.id, step.id);
    expect((await resumeAgentRun(user.id, run.id))?.status).toBe("COMPLETED");
  });
});

describe("P4-C3 — the executor still cannot authorize itself", () => {
  it("creates no grant on any refused path", async () => {
    const user = await createTestUser();
    const { run } = await heldRun(user.id, "no-self-grant");
    await resumeAgentRun(user.id, run.id);
    await executeRun(user.id, run.id);

    // Reaching HOLD, repeatedly, is never a human saying yes.
    expect(await db.approvalGrant.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.event.count({ where: { userId: user.id, type: "policy.approval_approved" } })).toBe(0);
  });

  it("cannot reach the grant constructor from the enforcement path", async () => {
    const { readFile } = await import("node:fs/promises");
    for (const file of ["src/lib/agents/executor.ts", "src/lib/policy/enforcement.ts"]) {
      expect(await readFile(file, "utf8")).not.toContain("createApprovalGrant");
    }
  });

  it("consumes only through the compare-and-swap primitive", async () => {
    const user = await createTestUser();
    const { run, step } = await heldRun(user.id, "cas-only");
    const grant = await approve(user.id, run.id, step.id);

    // Spending it by hand first means the execution finds nothing live —
    // proving the executor reads the same row the primitive writes, rather than
    // keeping any authorization of its own.
    expect((await consumeApprovalGrant(user.id, grant.id)).consumed).toBe(true);
    await resumeAgentRun(user.id, run.id);
    expect(await researchRows(user.id)).toBe(0);
  });
});
