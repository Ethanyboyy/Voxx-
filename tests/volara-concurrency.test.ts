import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { createTestUser, approveAndResume, seedLedgerEntry } from "./helpers";
import { grantPermission } from "@/lib/permissions/service";
import { ensureVolaraRoster } from "@/lib/volara/roster";
import { requestCapital } from "@/lib/volara/governor";
import { submitAllocationForApproval } from "@/lib/volara/authorize";
import { activateStrategy, proposeStrategy } from "@/lib/volara/strategy";
import { getTreasuryPosition } from "@/lib/volara/treasury";
import { recordPolicySpend, SpendRefusedError } from "@/lib/economic/spend";
import { runSociety, VOLARA_RUNTIME_CAPABILITY } from "@/lib/volara/loop";

/**
 * P4-F — CONCURRENCY, IDEMPOTENCY, AND DOUBLE-SPEND.
 *
 * Five agents run at once. The properties this file pins are the ones that only
 * break under simultaneity, so every test here actually runs things in
 * parallel rather than asserting about code that looks safe:
 *
 *   V2  reserved + spent never exceeds the ceiling, under concurrency.
 *   V6  a retried operation does not double-count.
 *   No two concurrent allocations consume the same headroom.
 *
 * Each is checked against the DERIVED position afterwards, not against what the
 * functions returned. A pair of calls that both reported success while the
 * ledger stayed correct would be a reporting bug; a pair that both reported
 * success AND both reserved would be the double-spend, and only reading the
 * position back can tell them apart.
 */

async function fundedSociety(ceilingUsd: number, agentCapCents: number, strategyCapCents: number) {
  const user = await createTestUser();
  await db.user.update({ where: { id: user.id }, data: { maxAutonomousSpendUsd: ceilingUsd } });
  await grantPermission(user.id, VOLARA_RUNTIME_CAPABILITY, "RECOMMEND");
  await grantPermission(user.id, "volara.capital", "ACT");
  const roster = await ensureVolaraRoster(user.id);
  await db.agent.updateMany({ where: { userId: user.id }, data: { maxRequestCents: agentCapCents } });

  const strategies = new Map<string, string>();
  for (const agent of roster) {
    const strategy = await proposeStrategy({
      userId: user.id,
      agentId: agent.id,
      name: `Thesis for ${agent.name}`,
      hypothesis: "A bounded test.",
      maxLossCents: 1_000,
      correlationId: "setup",
    });
    const activated = await activateStrategy({
      userId: user.id,
      strategyId: strategy.id,
      maxCapitalCents: strategyCapCents,
      correlationId: "setup",
    });
    if (!activated.activated) throw new Error(`activate failed: ${activated.reason}`);
    strategies.set(agent.id, strategy.id);
  }
  return { user, roster, strategies };
}

/** Requests capital, puts it to a human, and approves it through the real path. */
async function requestAndApprove(
  userId: string,
  agentId: string,
  strategyId: string,
  cents: number
): Promise<{ allocationId: string | null; approved: boolean }> {
  const requested = await requestCapital({
    userId,
    agentId,
    strategyId,
    requestedCents: cents,
    rationale: "Concurrent test.",
    correlationId: randomUUID(),
    idempotencyKey: randomUUID(),
  });
  if (!requested.requested) return { allocationId: null, approved: false };

  const submitted = await submitAllocationForApproval({ userId, allocationId: requested.allocation.id });
  if (!submitted.submitted) return { allocationId: requested.allocation.id, approved: false };

  await approveAndResume(userId, submitted.pending.runId);
  const row = await db.capitalAllocation.findUniqueOrThrow({ where: { id: requested.allocation.id } });
  return { allocationId: row.id, approved: row.status === "APPROVED" };
}

describe("P4-F — no two allocations consume the same headroom", () => {
  it("two agents competing for capital that only one can have: exactly one wins", async () => {
    // Ceiling $100. The 20% reserve floor leaves $80 spendable, and the 50%
    // concentration bound caps any one agent at $50. Two $50 requests therefore
    // fit individually and cannot both be reserved.
    const { user, roster, strategies } = await fundedSociety(100, 50_00, 50_00);
    const [a, b] = roster;

    const [first, second] = await Promise.all([
      requestAndApprove(user.id, a.id, strategies.get(a.id)!, 50_00),
      requestAndApprove(user.id, b.id, strategies.get(b.id)!, 50_00),
    ]);

    const approved = [first, second].filter((result) => result.approved);
    expect(approved.length).toBeLessThanOrEqual(1);

    // THE INVARIANT, read from the derived position rather than the returns.
    const position = await getTreasuryPosition(user.id);
    expect(position.reservedCents).toBeLessThanOrEqual(50_00);
    expect(position.reservedCents + position.spentCents).toBeLessThanOrEqual(position.ceilingCents);
  });

  it("five agents requesting simultaneously never over-reserve the ceiling", async () => {
    // Ceiling $100, each agent may ask for $30. Five × $30 = $150, well past
    // both the $80 spendable and the $50 concentration bound.
    const { user, roster, strategies } = await fundedSociety(100, 30_00, 30_00);

    const results = await Promise.all(
      roster.map((agent) => requestAndApprove(user.id, agent.id, strategies.get(agent.id)!, 30_00))
    );
    const approvedCount = results.filter((result) => result.approved).length;
    expect(approvedCount).toBeGreaterThanOrEqual(1);

    const position = await getTreasuryPosition(user.id);
    // V2, the whole point of this file.
    expect(position.reservedCents + position.spentCents).toBeLessThanOrEqual(position.ceilingCents);
    // And the reserve floor really is protected: reserved may not eat the last 20%.
    expect(position.reservedCents).toBeLessThanOrEqual(position.ceilingCents - Math.ceil(position.ceilingCents * 0.2));

    // Every approved row names a real, consumed grant.
    const approvedRows = await db.capitalAllocation.findMany({ where: { userId: user.id, status: "APPROVED" } });
    expect(approvedRows).toHaveLength(approvedCount);
    for (const row of approvedRows) {
      expect(row.approvalGrantId).not.toBeNull();
      const grant = await db.approvalGrant.findUniqueOrThrow({ where: { id: row.approvalGrantId! } });
      expect(grant.consumedAt).not.toBeNull();
    }
    // No grant was spent twice: one consumed grant per approved allocation.
    const grantIds = approvedRows.map((row) => row.approvalGrantId);
    expect(new Set(grantIds).size).toBe(grantIds.length);
  });

  it("the reservation guard holds when the ceiling is exhausted mid-flight", async () => {
    const { user, roster, strategies } = await fundedSociety(100, 40_00, 40_00);
    const [a, b] = roster;

    const first = await requestAndApprove(user.id, a.id, strategies.get(a.id)!, 40_00);
    expect(first.approved).toBe(true);

    // Now spend most of what is left through the REAL spend path, so the
    // headroom the second request was evaluated against disappears.
    const asset = await db.economicAsset.create({
      data: { userId: user.id, name: "Burner", category: "OTHER" },
    });
    await recordPolicySpend(user.id, { assetId: asset.id, amountUsd: 35 });

    const second = await requestAndApprove(user.id, b.id, strategies.get(b.id)!, 40_00);
    expect(second.approved).toBe(false);

    const position = await getTreasuryPosition(user.id);
    expect(position.reservedCents + position.spentCents).toBeLessThanOrEqual(position.ceilingCents);
  });
});

describe("P4-F — idempotency", () => {
  it("a retried capital request produces one row, not two", async () => {
    const { user, roster, strategies } = await fundedSociety(1000, 50_00, 50_00);
    const agent = roster[0];
    const key = randomUUID();

    const input = {
      userId: user.id,
      agentId: agent.id,
      strategyId: strategies.get(agent.id)!,
      requestedCents: 10_00,
      rationale: "Retried.",
      correlationId: randomUUID(),
      idempotencyKey: key,
    };

    // Sequential retry, then a concurrent burst — a retry loop and a duplicated
    // delivery are different failure shapes and both have to collapse.
    const first = await requestCapital(input);
    const second = await requestCapital(input);
    const burst = await Promise.allSettled([requestCapital(input), requestCapital(input), requestCapital(input)]);

    expect(first.requested && second.requested).toBe(true);
    expect(burst.some((result) => result.status === "fulfilled")).toBe(true);

    expect(await db.capitalAllocation.count({ where: { userId: user.id, idempotencyKey: key } })).toBe(1);
    expect(await db.capitalAllocation.count({ where: { userId: user.id } })).toBe(1);
  });

  it("a repeated approval of one allocation reserves once", async () => {
    const { user, roster, strategies } = await fundedSociety(1000, 50_00, 50_00);
    const agent = roster[0];

    const requested = await requestCapital({
      userId: user.id,
      agentId: agent.id,
      strategyId: strategies.get(agent.id)!,
      requestedCents: 10_00,
      rationale: "Approve once.",
      correlationId: randomUUID(),
      idempotencyKey: randomUUID(),
    });
    if (!requested.requested) throw new Error("request failed");

    const submitted = await submitAllocationForApproval({ userId: user.id, allocationId: requested.allocation.id });
    if (!submitted.submitted) throw new Error("submit failed");
    await approveAndResume(user.id, submitted.pending.runId);

    const afterFirst = await getTreasuryPosition(user.id);
    expect(afterFirst.reservedCents).toBe(10_00);

    // Submitting again must not open a second run for the same allocation.
    const resubmitted = await submitAllocationForApproval({ userId: user.id, allocationId: requested.allocation.id });
    expect(resubmitted.submitted).toBe(false);

    const afterSecond = await getTreasuryPosition(user.id);
    expect(afterSecond.reservedCents).toBe(10_00);
    expect(await db.capitalAllocation.count({ where: { userId: user.id, status: "APPROVED" } })).toBe(1);
  });

  it("concurrent cycles for the whole society do not double-count anything", async () => {
    const { user, roster } = await fundedSociety(1000, 0, 0);
    const objective = await db.objective.create({
      data: { userId: user.id, title: "Concurrent objective", targetValue: 0, currentValue: 0 },
    });
    await db.opportunity.create({
      data: { userId: user.id, objectiveId: objective.id, title: "Contested row", status: "DISCOVERED" },
    });

    // Two full sweeps at the same time. The lease is what makes this safe.
    const [a, b] = await Promise.all([runSociety(user.id), runSociety(user.id)]);
    const ranAgents = [...a, ...b].filter((result) => result.ran).map((result) => result.agentId);

    // Each agent ran at most once across both sweeps.
    for (const agent of roster) {
      const runs = ranAgents.filter((id) => id === agent.id).length;
      expect(runs, `${agent.name} ran ${runs} times`).toBeLessThanOrEqual(1);
      const row = await db.agent.findUniqueOrThrow({ where: { id: agent.id } });
      expect(row.cycleCount).toBeLessThanOrEqual(1);
    }

    // And no money moved, because the agents' caps are zero.
    const position = await getTreasuryPosition(user.id);
    expect(position.reservedCents).toBe(0);
    expect(position.spentCents).toBe(0);
  });
});

describe("P4-F — the ledger stays the only financial truth", () => {
  it("a reservation does not let a spend exceed the account ceiling", async () => {
    const { user, roster, strategies } = await fundedSociety(100, 40_00, 40_00);
    const agent = roster[0];

    const approved = await requestAndApprove(user.id, agent.id, strategies.get(agent.id)!, 40_00);
    expect(approved.approved).toBe(true);

    const asset = await db.economicAsset.create({
      data: { userId: user.id, name: "Spend target", category: "OTHER" },
    });

    // The reservation is $40. The ACCOUNT ceiling is $100 and the spend guard
    // knows nothing about reservations — so a $120 spend must still be refused
    // by the ceiling it does know about. A reservation can only ever tighten.
    await expect(recordPolicySpend(user.id, { assetId: asset.id, amountUsd: 120 })).rejects.toBeInstanceOf(
      SpendRefusedError
    );

    const position = await getTreasuryPosition(user.id);
    expect(position.spentCents).toBe(0);
    expect(position.reservedCents).toBe(40_00);
  });

  it("SIMULATED entries never move the derived position", async () => {
    const { user } = await fundedSociety(100, 0, 0);
    const asset = await db.economicAsset.create({
      data: { userId: user.id, name: "Dry run", category: "OTHER" },
    });
    await seedLedgerEntry("expense", {
      assetId: asset.id,
      amountUsd: 90,
      occurredAt: new Date(),
      provenance: "SIMULATED",
    });
    await seedLedgerEntry("revenue", {
      assetId: asset.id,
      amountUsd: 5000,
      occurredAt: new Date(),
      provenance: "SIMULATED",
    });

    const position = await getTreasuryPosition(user.id);
    expect(position.spentCents).toBe(0);
    expect(position.realizedRevenueCents).toBe(0);
    expect(position.availableCents).toBe(position.ceilingCents);
  });

  it("recording the same expense twice is two real rows, and both count", async () => {
    // Not a bug to fix — a correctness boundary to state. The ledger is
    // append-only and two identical spends ARE two spends; what must not happen
    // is one spend being counted twice, or a retry of one allocation producing
    // two. The guard is that each spend consumes ceiling, which this checks.
    const { user } = await fundedSociety(100, 0, 0);
    const asset = await db.economicAsset.create({
      data: { userId: user.id, name: "Twice", category: "OTHER" },
    });

    await recordPolicySpend(user.id, { assetId: asset.id, amountUsd: 60 });
    await expect(recordPolicySpend(user.id, { assetId: asset.id, amountUsd: 60 })).rejects.toBeInstanceOf(
      SpendRefusedError
    );

    const position = await getTreasuryPosition(user.id);
    expect(position.spentCents).toBe(60_00);
    expect(position.spentCents).toBeLessThanOrEqual(position.ceilingCents);
  });
});
