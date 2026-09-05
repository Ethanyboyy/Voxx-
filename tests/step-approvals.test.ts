import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { startAgentRun, resumeAgentRun } from "@/lib/agents/service";
import { executeRun } from "@/lib/agents/executor";
import { grantPermission } from "@/lib/permissions/service";
import {
  hashArguments,
  hashRegisteredClassification,
  consumeApprovalGrant,
  DEFAULT_APPROVAL_TTL_MS,
  STEP_APPROVAL_TARGET_TYPE,
} from "@/lib/policy/approvals";
import {
  getPendingStepApproval,
  approveAgentStep,
  rejectAgentStep,
} from "@/lib/policy/step-approvals";
import * as sessionModule from "@/lib/auth/session";
import { GET as approveGet, POST as approvePost } from "@/app/api/agents/[id]/steps/[stepId]/approve/route";
import { POST as rejectPost } from "@/app/api/agents/[id]/steps/[stepId]/reject/route";
import { createTestUser } from "./helpers";
import type { User } from "@/generated/prisma/client";

/**
 * P4-C2 — THE HUMAN APPROVAL ACT.
 *
 * The invariant every test here defends: an `ApprovalGrant` exists if and only
 * if an authorized human explicitly approved the exact finalized arguments of a
 * specific pending action.
 *
 * So the suite is written adversarially. The happy path is four tests; the rest
 * assume the UI has been bypassed entirely and ask what the API alone will
 * accept — a forged hash, someone else's step, a step that is not waiting, a
 * body carrying its own idea of which capability is being approved.
 */

/**
 * A run that parks on a step whose arguments were RESOLVED from a reference.
 *
 * The reference matters: it is the case where the authored template and the
 * finalized arguments genuinely differ, so "was the human shown the real thing"
 * is a question with an observable answer.
 */
async function parkedRun(userId: string) {
  const run = await startAgentRun({
    userId,
    objective: "Recall something, then write it to a file.",
    steps: [
      { description: "Recall the recipient.", toolName: "memory.create", input: { content: "Alice", category: "FACT" } },
      {
        description: "Write the recalled value into the workspace.",
        toolName: "workspace.write",
        input: { path: "notes/recipient.txt", content: "{{step0.output.id}}" },
      },
    ],
  });
  const step = await db.agentStep.findFirstOrThrow({ where: { runId: run.id, order: 1 } });
  return { run, step };
}

async function eventsOfType(userId: string, type: string) {
  return db.event.findMany({ where: { userId, type }, orderBy: { createdAt: "asc" } });
}

function payloadOf(event: { payload: string | null }): Record<string, unknown> {
  return JSON.parse(event.payload ?? "{}") as Record<string, unknown>;
}

function grantCount(userId: string) {
  return db.approvalGrant.count({ where: { userId } });
}

/** Calls the real route handler with a real Request, as a signed-in user. */
function asUser(user: User) {
  vi.spyOn(sessionModule, "getCurrentUser").mockResolvedValue(user);
}

function params(runId: string, stepId: string) {
  return { params: Promise.resolve({ id: runId, stepId }) };
}

/**
 * Some tests here approve, grant and resume, so `workspace.write` genuinely
 * runs. Point the workspace at a temp directory first — the same containment
 * `tests/workspace-tools.test.ts` uses — so the suite does not write files into
 * the repository it is testing.
 */
let workspace: string;
let previousWorkspaceRoot: string | undefined;

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "vox-approval-"));
  previousWorkspaceRoot = process.env.VOX_WORKSPACE_ROOT;
  process.env.VOX_WORKSPACE_ROOT = workspace;
});

afterAll(async () => {
  if (previousWorkspaceRoot === undefined) delete process.env.VOX_WORKSPACE_ROOT;
  else process.env.VOX_WORKSPACE_ROOT = previousWorkspaceRoot;
  await rm(workspace, { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("P4-C2 — the pending action a person is shown", () => {
  it("shows the FINALIZED arguments, not the authored template", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    const memory = await db.memory.findFirstOrThrow({ where: { userId: user.id } });

    const result = await getPendingStepApproval(user.id, run.id, step.id);
    expect(result.found).toBe(true);
    if (!result.found) return;

    // The value that will actually be written — asking someone to approve
    // "{{step0.output.id}}" would be asking them to consent to a placeholder.
    expect(result.pending.finalizedArguments).toEqual({
      path: "notes/recipient.txt",
      content: memory.id,
    });
    expect(JSON.stringify(result.pending.finalizedArguments)).not.toContain("{{step0");
    expect(result.pending.argumentsHash).toBe(
      hashArguments({ path: "notes/recipient.txt", content: memory.id })
    );
  });

  it("describes the action from the registry, not from anything a caller said", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);

    const result = await getPendingStepApproval(user.id, run.id, step.id);
    if (!result.found) throw new Error("expected a pending approval");

    expect(result.pending.actionId).toBe("workspace.write");
    expect(result.pending.capability).toBe("workspace.write");
    expect(result.pending.requiredLevel).toBe("ACT");
    // workspace.write is WRITE/PARTIALLY_REVERSIBLE → HOLD (P2 matrix).
    expect(result.pending.policyDecision).toBe("HOLD");
    expect(result.pending.classificationHash).toBe(
      hashRegisteredClassification("tool", "workspace.write")!.hash
    );
    expect(result.pending.alreadyApproved).toBe(false);
  });

  it("creates nothing, however many times it is read", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);

    await getPendingStepApproval(user.id, run.id, step.id);
    await getPendingStepApproval(user.id, run.id, step.id);
    await getPendingStepApproval(user.id, run.id, step.id);

    // Looking at a pending action is not approving it.
    expect(await grantCount(user.id)).toBe(0);
  });
});

describe("P4-C2 — approving", () => {
  it("creates exactly one grant, bound to the step and its arguments", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    const pending = await getPendingStepApproval(user.id, run.id, step.id);
    if (!pending.found) throw new Error("expected a pending approval");

    const result = await approveAgentStep({
      userId: user.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: pending.pending.argumentsHash,
    });

    expect(result.approved).toBe(true);
    if (!result.approved) return;
    expect(result.reused).toBe(false);
    expect(await grantCount(user.id)).toBe(1);

    const grant = result.grant;
    expect(grant.registry).toBe("tool");
    expect(grant.actionId).toBe("workspace.write");
    expect(grant.argumentsHash).toBe(pending.pending.argumentsHash);
    expect(grant.classificationHash).toBe(pending.pending.classificationHash);
    // The binding to ONE step. Without it the grant would authorize any
    // execution of the same action with the same arguments.
    expect(grant.targetType).toBe(STEP_APPROVAL_TARGET_TYPE);
    expect(grant.targetId).toBe(step.id);
    expect(grant.capability).toBe("workspace.write");
    expect(grant.requiredLevel).toBe("ACT");
    expect(grant.consumedAt).toBeNull();
  });

  it("expires — an approval does not outlive the context it was given in", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    const pending = await getPendingStepApproval(user.id, run.id, step.id);
    if (!pending.found) throw new Error("expected a pending approval");

    const now = new Date("2026-01-01T00:00:00.000Z");
    const result = await approveAgentStep({
      userId: user.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: pending.pending.argumentsHash,
      now,
    });
    if (!result.approved) throw new Error("expected approval");

    expect(result.grant.expiresAt.getTime()).toBe(now.getTime() + DEFAULT_APPROVAL_TTL_MS);
  });

  it("records the human act as its own event", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    const pending = await getPendingStepApproval(user.id, run.id, step.id);
    if (!pending.found) throw new Error("expected a pending approval");

    await approveAgentStep({
      userId: user.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: pending.pending.argumentsHash,
    });

    const events = await eventsOfType(user.id, "policy.approval_approved");
    expect(events).toHaveLength(1);
    expect(events[0].consequential).toBe(true);
    const payload = payloadOf(events[0]);
    expect(payload.stepId).toBe(step.id);
    expect(payload.actionId).toBe("workspace.write");
    expect(payload.argumentsHash).toBe(pending.pending.argumentsHash);
  });

  it("is idempotent — approving twice yields one grant, not two authorizations", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    const pending = await getPendingStepApproval(user.id, run.id, step.id);
    if (!pending.found) throw new Error("expected a pending approval");

    const first = await approveAgentStep({
      userId: user.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: pending.pending.argumentsHash,
    });
    const second = await approveAgentStep({
      userId: user.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: pending.pending.argumentsHash,
    });

    if (!first.approved || !second.approved) throw new Error("expected both to be approved");
    expect(second.reused).toBe(true);
    expect(second.grant.id).toBe(first.grant.id);
    // A double-click must not stockpile authorizations for the same act.
    expect(await grantCount(user.id)).toBe(1);
  });

  it("produces a grant that is single-use", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    const pending = await getPendingStepApproval(user.id, run.id, step.id);
    if (!pending.found) throw new Error("expected a pending approval");

    const result = await approveAgentStep({
      userId: user.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: pending.pending.argumentsHash,
    });
    if (!result.approved) throw new Error("expected approval");

    expect((await consumeApprovalGrant(user.id, result.grant.id)).consumed).toBe(true);
    expect((await consumeApprovalGrant(user.id, result.grant.id)).consumed).toBe(false);
  });

  it("does not grant the capability — approving an action is not authorizing a class of them", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    const pending = await getPendingStepApproval(user.id, run.id, step.id);
    if (!pending.found) throw new Error("expected a pending approval");

    await approveAgentStep({
      userId: user.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: pending.pending.argumentsHash,
    });

    // checkCapability() remains the only authority on whether the capability is
    // held, so the run is still parked on the permission it never had.
    const resumed = await resumeAgentRun(user.id, run.id);
    expect(resumed?.status).toBe("WAITING_FOR_PERMISSION");
    expect(await db.permission.count({ where: { userId: user.id, capability: "workspace.write" } })).toBe(0);
  });
});

describe("P4-C2 — the submitted hash is an assertion, never evidence", () => {
  it("refuses a hash that does not match the persisted arguments", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);

    const result = await approveAgentStep({
      userId: user.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: hashArguments({ path: "notes/recipient.txt", content: "something I made up" }),
    });

    expect(result).toEqual({ approved: false, reason: "HASH_MISMATCH" });
    expect(await grantCount(user.id)).toBe(0);
  });

  it("refuses the hash of the AUTHORED TEMPLATE — approving the placeholder is not approving the call", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);

    const result = await approveAgentStep({
      userId: user.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: hashArguments({ path: "notes/recipient.txt", content: "{{step0.output.id}}" }),
    });

    expect(result).toEqual({ approved: false, reason: "HASH_MISMATCH" });
    expect(await grantCount(user.id)).toBe(0);
  });

  it("refuses a hash that was valid before the action changed underneath it", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    const shown = await getPendingStepApproval(user.id, run.id, step.id);
    if (!shown.found) throw new Error("expected a pending approval");

    // The action is rewritten after the person looked at it — the "saw A,
    // executes B" attack, staged directly against the row.
    await db.agentStep.update({
      where: { id: step.id },
      data: { input: JSON.stringify({ path: "/etc/passwd", content: "owned" }) },
    });

    const result = await approveAgentStep({
      userId: user.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: shown.pending.argumentsHash,
    });

    expect(result).toEqual({ approved: false, reason: "HASH_MISMATCH" });
    expect(await grantCount(user.id)).toBe(0);
  });

  it("records a refused hash as a rejection, with both hashes", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    const shown = await getPendingStepApproval(user.id, run.id, step.id);
    if (!shown.found) throw new Error("expected a pending approval");

    const forged = hashArguments({ path: "x", content: "y" });
    await approveAgentStep({ userId: user.id, runId: run.id, stepId: step.id, argumentsHash: forged });

    const events = await eventsOfType(user.id, "policy.approval_rejected");
    expect(events).toHaveLength(1);
    const payload = payloadOf(events[0]);
    expect(payload.reason).toBe("HASH_MISMATCH");
    expect(payload.submittedArgumentsHash).toBe(forged);
    expect(payload.canonicalArgumentsHash).toBe(shown.pending.argumentsHash);
  });

  it("refuses to approve arguments that are still templates", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);

    // Force the un-finalized state P4-C1 normally prevents. There is no honest
    // hash for a placeholder, so the only safe answer is to refuse.
    await db.agentStep.update({
      where: { id: step.id },
      data: { input: JSON.stringify({ path: "a.txt", content: "{{step0.output.id}}" }) },
    });

    const result = await approveAgentStep({
      userId: user.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: hashArguments({ path: "a.txt", content: "{{step0.output.id}}" }),
    });

    expect(result).toEqual({ approved: false, reason: "ARGUMENTS_NOT_FINALIZED" });
    expect(await grantCount(user.id)).toBe(0);
  });
});

describe("P4-C2 — identity and ownership", () => {
  it("refuses another person's run", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const { run, step } = await parkedRun(owner.id);

    const pending = await getPendingStepApproval(stranger.id, run.id, step.id);
    expect(pending).toEqual({ found: false, reason: "RUN_NOT_FOUND" });

    // Even with the correct hash, which the attacker could have computed.
    const known = await getPendingStepApproval(owner.id, run.id, step.id);
    if (!known.found) throw new Error("expected a pending approval");
    const result = await approveAgentStep({
      userId: stranger.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: known.pending.argumentsHash,
    });

    expect(result).toEqual({ approved: false, reason: "RUN_NOT_FOUND" });
    expect(await grantCount(stranger.id)).toBe(0);
    expect(await grantCount(owner.id)).toBe(0);
  });

  it("refuses a step paired with a run it does not belong to", async () => {
    const user = await createTestUser();
    const mine = await parkedRun(user.id);
    const other = await parkedRun(user.id);

    // Both runs belong to this user, so ownership alone would let this through.
    const result = await approveAgentStep({
      userId: user.id,
      runId: mine.run.id,
      stepId: other.step.id,
      argumentsHash: hashArguments({ path: "notes/recipient.txt", content: "anything" }),
    });

    expect(result).toEqual({ approved: false, reason: "STEP_NOT_IN_RUN" });
    expect(await grantCount(user.id)).toBe(0);
  });

  it("refuses another person's step smuggled into a run you own", async () => {
    const owner = await createTestUser();
    const attacker = await createTestUser();
    const victim = await parkedRun(owner.id);
    const cover = await parkedRun(attacker.id);

    const result = await approveAgentStep({
      userId: attacker.id,
      runId: cover.run.id,
      stepId: victim.step.id,
      argumentsHash: hashArguments({ path: "notes/recipient.txt", content: "anything" }),
    });

    expect(result).toEqual({ approved: false, reason: "STEP_NOT_IN_RUN" });
    expect(await grantCount(attacker.id)).toBe(0);
    expect(await grantCount(owner.id)).toBe(0);
  });
});

describe("P4-C2 — lifecycle", () => {
  it("refuses a step that is not waiting for approval", async () => {
    const user = await createTestUser();
    const run = await startAgentRun({
      userId: user.id,
      objective: "Write a memory.",
      steps: [{ description: "Remember.", toolName: "memory.create", input: { content: "z", category: "FACT" } }],
    });
    expect(run.status).toBe("COMPLETED");
    const step = await db.agentStep.findFirstOrThrow({ where: { runId: run.id, order: 0 } });

    const result = await approveAgentStep({
      userId: user.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: hashArguments({ content: "z", category: "FACT" }),
    });

    // An already-executed action cannot be approved after the fact.
    expect(result).toEqual({ approved: false, reason: "STEP_NOT_AWAITING_APPROVAL" });
    expect(await grantCount(user.id)).toBe(0);
  });

  it("resume is not approval", async () => {
    const user = await createTestUser();
    const { run } = await parkedRun(user.id);

    await resumeAgentRun(user.id, run.id);
    await resumeAgentRun(user.id, run.id);

    // The forbidden lifecycle — reach HOLD, mint a grant, resume, execute —
    // stays impossible: nothing on this path creates a grant.
    expect(await grantCount(user.id)).toBe(0);
  });

  it("rejection creates no grant and cancels the run", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);

    expect(await rejectAgentStep(user.id, run.id, step.id)).toEqual({ rejected: true });
    expect(await grantCount(user.id)).toBe(0);

    const after = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.status).toBe("CANCELLED");

    const events = await eventsOfType(user.id, "policy.approval_rejected");
    expect(payloadOf(events[0]).reason).toBe("DECLINED_BY_HUMAN");
  });

  it("refuses to reject another person's step", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const { run, step } = await parkedRun(owner.id);

    expect(await rejectAgentStep(stranger.id, run.id, step.id)).toEqual({
      rejected: false,
      reason: "RUN_NOT_FOUND",
    });
    const after = await db.agentRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.status).toBe("WAITING_FOR_PERMISSION");
  });
});

describe("P4-C2 — the approval reaches the executor's gate", () => {
  it("an approved step reports wouldAuthorize when execution reaches the gate", async () => {
    const user = await createTestUser();
    // Park FIRST — the step only reaches the approval surface because the
    // capability is missing. Then approve, then grant, then resume, so the
    // execution the gate observes is one a human actually consented to.
    const { run, step } = await parkedRun(user.id);
    const pending = await getPendingStepApproval(user.id, run.id, step.id);
    if (!pending.found) throw new Error("expected a pending approval");
    await approveAgentStep({
      userId: user.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: pending.pending.argumentsHash,
    });

    await grantPermission(user.id, "workspace.write", "ACT");
    await resumeAgentRun(user.id, run.id);

    const shadow = await eventsOfType(user.id, "policy.approval_shadow_evaluated");
    const forStep = shadow.map(payloadOf).filter((p) => p.stepId === step.id);
    expect(forStep).toHaveLength(1);
    // The step binding is what makes this true: the executor names the step, the
    // grant names the step, and the argument hashes agree.
    expect(forStep[0].wouldAuthorize).toBe(true);
    expect(forStep[0].argumentsHash).toBe(pending.pending.argumentsHash);
    // ...and nothing was enforced. P4-C2 adds the approval act, not the block.
    expect(forStep[0].enforced).toBe(false);
    expect(forStep[0].executionContinued).toBe(true);
  });

  it("completes the whole lifecycle: approve → resume → match → consume once → execute", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    const pending = await getPendingStepApproval(user.id, run.id, step.id);
    if (!pending.found) throw new Error("expected a pending approval");
    const approved = await approveAgentStep({
      userId: user.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: pending.pending.argumentsHash,
    });
    if (!approved.approved) throw new Error("expected approval");
    expect(approved.grant.consumedAt).toBeNull();

    await grantPermission(user.id, "workspace.write", "ACT");
    const resumed = await resumeAgentRun(user.id, run.id);

    // Execution proceeded.
    expect(resumed?.status).toBe("COMPLETED");
    expect((await db.agentStep.findUniqueOrThrow({ where: { id: step.id } })).status).toBe("COMPLETED");

    // The approval was spent — exactly once, on the invocation it was given for.
    const stored = await db.approvalGrant.findUniqueOrThrow({ where: { id: approved.grant.id } });
    expect(stored.consumedAt).not.toBeNull();

    // The canonical spend record, written by `consumeApprovalGrant` itself and
    // subject-linked to the grant.
    const consumedEvents = await eventsOfType(user.id, "policy.approval_consumed");
    expect(consumedEvents).toHaveLength(1);
    expect(consumedEvents[0].subjectId).toBe(approved.grant.id);
    expect(payloadOf(consumedEvents[0]).argumentsHash).toBe(pending.pending.argumentsHash);

    // ...and the step-side view of the same fact, on the run's own timeline.
    const shadow = (await eventsOfType(user.id, "policy.approval_shadow_evaluated"))
      .map(payloadOf)
      .filter((p) => p.stepId === step.id);
    expect(shadow).toHaveLength(1);
    expect(shadow[0].wouldAuthorize).toBe(true);
    expect(shadow[0].grantId).toBe(approved.grant.id);
    expect(shadow[0].grantConsumed).toBe(true);
    // Consumption is not enforcement: the gate still did not decide this ran.
    expect(shadow[0].enforced).toBe(false);
    expect(shadow[0].executionContinued).toBe(true);
  });

  it("cannot authorize a second execution with the same grant", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    const pending = await getPendingStepApproval(user.id, run.id, step.id);
    if (!pending.found) throw new Error("expected a pending approval");
    const approved = await approveAgentStep({
      userId: user.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: pending.pending.argumentsHash,
    });
    if (!approved.approved) throw new Error("expected approval");

    await grantPermission(user.id, "workspace.write", "ACT");
    await resumeAgentRun(user.id, run.id);

    // Re-run the same logical step. The grant is spent, so nothing authorizes
    // this second execution — a single approval is not a standing permission.
    await db.agentStep.update({
      where: { id: step.id },
      data: { status: "PENDING", output: null, completedAt: null },
    });
    await db.agentRun.update({ where: { id: run.id }, data: { status: "RUNNING", currentStep: 1 } });
    await executeRun(user.id, run.id);

    const shadow = (await eventsOfType(user.id, "policy.approval_shadow_evaluated"))
      .map(payloadOf)
      .filter((p) => p.stepId === step.id);
    expect(shadow).toHaveLength(2);
    expect(shadow[0].wouldAuthorize).toBe(true);
    expect(shadow[0].grantConsumed).toBe(true);
    // The second pass finds nothing live: a consumed grant is not a candidate.
    expect(shadow[1].wouldAuthorize).toBe(false);
    expect(shadow[1].grantConsumed).toBe(false);
    expect(shadow[1].reasons).toEqual(["NO_GRANT"]);
  });

  it("a retry inside one execution spends one approval, not one per attempt", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    const pending = await getPendingStepApproval(user.id, run.id, step.id);
    if (!pending.found) throw new Error("expected a pending approval");
    await approveAgentStep({
      userId: user.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: pending.pending.argumentsHash,
    });

    await grantPermission(user.id, "workspace.write", "ACT");
    await resumeAgentRun(user.id, run.id);

    // The consumption site sits outside the retry loop, so one attempt to run a
    // step is one decision however many times the tool call is retried.
    expect(await eventsOfType(user.id, "policy.approval_consumed")).toHaveLength(1);
    // ...and a retry never mints a replacement.
    expect(await grantCount(user.id)).toBe(1);
  });

  it("leaves a valid grant unconsumed when a forged hash is executed instead", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    const pending = await getPendingStepApproval(user.id, run.id, step.id);
    if (!pending.found) throw new Error("expected a pending approval");
    const approved = await approveAgentStep({
      userId: user.id,
      runId: run.id,
      stepId: step.id,
      argumentsHash: pending.pending.argumentsHash,
    });
    if (!approved.approved) throw new Error("expected approval");

    // The action is rewritten after approval. The grant is bound to the old
    // hash, so the execution that follows matches nothing — and, critically,
    // does not spend the approval the person actually gave.
    await db.agentStep.update({
      where: { id: step.id },
      data: { input: JSON.stringify({ path: "notes/other.txt", content: "changed" }) },
    });
    await grantPermission(user.id, "workspace.write", "ACT");
    await resumeAgentRun(user.id, run.id);

    const stored = await db.approvalGrant.findUniqueOrThrow({ where: { id: approved.grant.id } });
    expect(stored.consumedAt).toBeNull();
    const shadow = (await eventsOfType(user.id, "policy.approval_shadow_evaluated"))
      .map(payloadOf)
      .filter((p) => p.stepId === step.id);
    expect(shadow[0].wouldAuthorize).toBe(false);
    expect(shadow[0].reasons).toContain("ARGUMENTS_CHANGED");
    expect(shadow[0].grantConsumed).toBe(false);
  });

  it("a grant for one step does not authorize an identical action in another", async () => {
    const user = await createTestUser();
    const first = await parkedRun(user.id);
    const pendingFirst = await getPendingStepApproval(user.id, first.run.id, first.step.id);
    if (!pendingFirst.found) throw new Error("expected a pending approval");
    await approveAgentStep({
      userId: user.id,
      runId: first.run.id,
      stepId: first.step.id,
      argumentsHash: pendingFirst.pending.argumentsHash,
    });
    await grantPermission(user.id, "workspace.write", "ACT");

    // A second run writing the SAME path with the SAME content — identical
    // arguments, identical classification, different step.
    const memory = await db.memory.findFirstOrThrow({ where: { userId: user.id } });
    const second = await startAgentRun({
      userId: user.id,
      objective: "Write the same file again.",
      steps: [
        {
          description: "Write it again.",
          toolName: "workspace.write",
          input: { path: "notes/recipient.txt", content: memory.id },
        },
      ],
    });
    const secondStep = await db.agentStep.findFirstOrThrow({ where: { runId: second.id, order: 0 } });

    const shadow = (await eventsOfType(user.id, "policy.approval_shadow_evaluated")).map(payloadOf);
    const forSecond = shadow.filter((p) => p.stepId === secondStep.id);
    expect(forSecond).toHaveLength(1);
    expect(forSecond[0].wouldAuthorize).toBe(false);
    expect(forSecond[0].reasons).toContain("WRONG_TARGET");
    // ...and the cross-run miss did not spend the grant either.
    expect(forSecond[0].grantConsumed).toBe(false);
  });

  it("a grant for one step does not authorize a sibling step in the SAME run", async () => {
    const user = await createTestUser();
    // Two workspace writes in one run, with identical arguments. Only the first
    // is approved; ownership, run and action are all shared, so the step id is
    // the only thing keeping them apart.
    const run = await startAgentRun({
      userId: user.id,
      objective: "Write the same note twice.",
      steps: [
        { description: "Write it.", toolName: "workspace.write", input: { path: "notes/twice.txt", content: "one" } },
        { description: "Write it again.", toolName: "workspace.write", input: { path: "notes/twice.txt", content: "one" } },
      ],
    });
    const [first, second] = await db.agentStep.findMany({ where: { runId: run.id }, orderBy: { order: "asc" } });

    const pending = await getPendingStepApproval(user.id, run.id, first.id);
    if (!pending.found) throw new Error("expected a pending approval");
    const approved = await approveAgentStep({
      userId: user.id,
      runId: run.id,
      stepId: first.id,
      argumentsHash: pending.pending.argumentsHash,
    });
    if (!approved.approved) throw new Error("expected approval");
    expect(approved.grant.targetId).toBe(first.id);

    await grantPermission(user.id, "workspace.write", "ACT");
    await resumeAgentRun(user.id, run.id);

    const shadow = (await eventsOfType(user.id, "policy.approval_shadow_evaluated")).map(payloadOf);
    const forFirst = shadow.filter((p) => p.stepId === first.id);
    const forSecond = shadow.filter((p) => p.stepId === second.id);

    expect(forFirst[0].wouldAuthorize).toBe(true);
    expect(forFirst[0].grantConsumed).toBe(true);
    // The sibling ran with identical arguments and was NOT authorized by it.
    expect(forSecond[0].wouldAuthorize).toBe(false);
    expect(forSecond[0].grantConsumed).toBe(false);
  });
});

describe("P4-C2 — the HTTP surface, assuming the UI is bypassed", () => {
  it("requires authentication", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    vi.spyOn(sessionModule, "getCurrentUser").mockResolvedValue(null);

    const res = await approvePost(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ argumentsHash: "a".repeat(64) }),
      }) as never,
      params(run.id, step.id)
    );

    expect(res.status).toBe(401);
    expect(await grantCount(user.id)).toBe(0);
  });

  it("GET returns the pending action and creates nothing", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    asUser(user);

    const res = await approveGet(new Request("http://localhost/x") as never, params(run.id, step.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pending.actionId).toBe("workspace.write");
    expect(body.pending.stepId).toBe(step.id);
    expect(await grantCount(user.id)).toBe(0);
  });

  it("approves with the hash, and reports the second attempt as reuse", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    asUser(user);

    const pending = await getPendingStepApproval(user.id, run.id, step.id);
    if (!pending.found) throw new Error("expected a pending approval");
    const body = JSON.stringify({ argumentsHash: pending.pending.argumentsHash });

    const first = await approvePost(
      new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body }) as never,
      params(run.id, step.id)
    );
    expect(first.status).toBe(201);
    expect((await first.json()).reused).toBe(false);

    const second = await approvePost(
      new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body }) as never,
      params(run.id, step.id)
    );
    expect(second.status).toBe(200);
    expect((await second.json()).reused).toBe(true);
    expect(await grantCount(user.id)).toBe(1);
  });

  it("rejects a body that tries to redefine the action", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    asUser(user);
    const pending = await getPendingStepApproval(user.id, run.id, step.id);
    if (!pending.found) throw new Error("expected a pending approval");

    const res = await approvePost(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          argumentsHash: pending.pending.argumentsHash,
          // Every one of these would be an escalation if it were honoured.
          actionId: "memory.create",
          capability: "memory.read",
          requiredLevel: "OBSERVE",
          policyDecision: "ALLOW",
          amplification: 500,
          parsedArguments: { path: "/etc/passwd", content: "owned" },
        }),
      }) as never,
      params(run.id, step.id)
    );

    // Loud, not silently stripped — a request that tried to name its own
    // capability should not be recorded as an ordinary approval.
    expect(res.status).toBe(400);
    expect(await grantCount(user.id)).toBe(0);
  });

  it("rejects a malformed hash before touching any state", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    asUser(user);

    for (const argumentsHash of ["", "not-a-hash", "A".repeat(64), "a".repeat(63), "a".repeat(65)]) {
      const res = await approvePost(
        new Request("http://localhost/x", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ argumentsHash }),
        }) as never,
        params(run.id, step.id)
      );
      expect(res.status).toBe(400);
    }
    expect(await grantCount(user.id)).toBe(0);
  });

  it("answers a forged hash with 409 and no grant", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    asUser(user);

    const res = await approvePost(
      new Request("http://localhost/x", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ argumentsHash: hashArguments({ path: "x", content: "y" }) }),
      }) as never,
      params(run.id, step.id)
    );

    expect(res.status).toBe(409);
    expect((await res.json()).reason).toBe("HASH_MISMATCH");
    expect(await grantCount(user.id)).toBe(0);
  });

  it("gives no existence oracle — a foreign step and a missing one answer alike", async () => {
    const owner = await createTestUser();
    const attacker = await createTestUser();
    const victim = await parkedRun(owner.id);
    const cover = await parkedRun(attacker.id);
    asUser(attacker);

    const foreign = await approveGet(
      new Request("http://localhost/x") as never,
      params(cover.run.id, victim.step.id)
    );
    const missing = await approveGet(
      new Request("http://localhost/x") as never,
      params(cover.run.id, "step-that-does-not-exist")
    );

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    // Identical, so the response cannot be used to confirm that a step id is real.
    expect(await foreign.json()).toEqual(await missing.json());
  });

  it("rejects through the API and cancels the run", async () => {
    const user = await createTestUser();
    const { run, step } = await parkedRun(user.id);
    asUser(user);

    const res = await rejectPost(new Request("http://localhost/x", { method: "POST" }) as never, params(run.id, step.id));
    expect(res.status).toBe(200);
    expect(await grantCount(user.id)).toBe(0);
    expect((await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe("CANCELLED");
  });
});

describe("P4-C2 — structural guarantees", () => {
  it("the executor still cannot mint a grant", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("src/lib/agents/executor.ts", "utf8");
    // The forbidden lifecycle — executor reaches HOLD, executor mints a grant,
    // resume, execute — is unrepresentable because the constructor is not in
    // scope, not because the code currently chooses not to call it.
    expect(source).not.toContain("createApprovalGrant");
    // Spending is a different act and IS the executor's: it records that the
    // invocation a human already approved has happened.
    expect(source).toContain("consumeApprovalGrant");
  });

  it("step-approvals.ts is the only caller of createApprovalGrant in src/", async () => {
    const { readdir, readFile } = await import("node:fs/promises");
    const { join } = await import("node:path");

    async function walk(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const files = await Promise.all(
        entries.map(async (entry) => {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) return entry.name === "generated" ? [] : walk(full);
          return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
        })
      );
      return files.flat();
    }

    const callers: string[] = [];
    for (const file of await walk("src")) {
      const source = await readFile(file, "utf8");
      // The definition itself lives in approvals.ts; every other mention of the
      // call is a place that can turn something into an authorization.
      if (file.endsWith("policy/approvals.ts")) continue;
      if (source.includes("createApprovalGrant(")) callers.push(file);
    }

    expect(callers).toEqual(["src/lib/policy/step-approvals.ts"]);
  }, 30_000);
});
