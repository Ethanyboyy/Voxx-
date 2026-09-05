import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { getPendingStepApproval, approveAgentStep } from "@/lib/policy/step-approvals";
import { executeRun } from "@/lib/agents/executor";

export async function createTestUser(email = `test-${randomUUID()}@example.com`) {
  const passwordHash = await hashPassword("correcthorsebattery1");
  return db.user.create({ data: { email, passwordHash } });
}

/**
 * [P4-C3] Plays the human through an enforced run: approve the parked step,
 * resume, repeat until the run stops waiting.
 *
 * Since P4-C3 a HOLD action does not execute without a matching human approval,
 * so a fixture whose subject is something OTHER than the policy gate — the
 * budget ceiling, the refinement loop, the orchestrator's plan — has to supply
 * that approval or it measures the gate instead of what it was written for.
 *
 * IT USES THE REAL PATH, deliberately: `getPendingStepApproval()` for the
 * canonical hash and `approveAgentStep()` to mint the grant, exactly as the API
 * route does. There is no test-only bypass here, and there must not be — a
 * helper that forged grants would let every one of these suites pass while the
 * enforcement it is standing in for was broken.
 *
 * `maxApprovals` bounds the loop so a step that parks forever fails the test
 * rather than hanging it.
 */
export async function approveAndResume(userId: string, runId: string, maxApprovals = 12) {
  let run = await db.agentRun.findFirstOrThrow({
    where: { id: runId, userId },
    include: { steps: { orderBy: { order: "asc" } } },
  });

  const approved = new Set<string>();
  for (let i = 0; i < maxApprovals && run.status === "WAITING_FOR_PERMISSION"; i++) {
    const parked = run.steps.find((s) => s.status === "WAITING_FOR_PERMISSION");
    if (!parked) break;
    // Already approved and still parked means the block is not approval — a
    // missing capability, most often. Spinning would hide that; stopping lets
    // the caller assert on the real state.
    if (approved.has(parked.id)) break;
    approved.add(parked.id);

    const pending = await getPendingStepApproval(userId, runId, parked.id);
    if (!pending.found) break;

    await approveAgentStep({
      userId,
      runId,
      stepId: parked.id,
      argumentsHash: pending.pending.argumentsHash,
    });
    run = await executeRun(userId, runId);
  }

  return run;
}

/**
 * Writes a ledger row directly, with `amountCents` correct.
 *
 * Tests need this because some fixtures must produce rows the service layer
 * deliberately refuses to create — a REALIZED row above all (invariant I1: no
 * ordinary write path may assert external confirmation). Going through
 * `db.economicRevenue.create` by hand is how those fixtures silently ended up
 * with `amountCents: 0` and measured as nothing; this helper keeps the two
 * representations in step the same way the service does.
 */
export async function seedLedgerEntry(
  side: "revenue" | "expense",
  input: {
    assetId: string;
    amountUsd: number;
    occurredAt: Date;
    provenance?: "REALIZED" | "USER_RECORDED" | "SIMULATED";
    source?: string;
    category?: string;
  }
) {
  const data = {
    assetId: input.assetId,
    amountUsd: input.amountUsd,
    amountCents: Math.round(input.amountUsd * 100),
    provenance: input.provenance ?? ("USER_RECORDED" as const),
    occurredAt: input.occurredAt,
  };
  return side === "revenue"
    ? db.economicRevenue.create({ data: { ...data, source: input.source } })
    : db.economicExpense.create({ data: { ...data, category: input.category } });
}
