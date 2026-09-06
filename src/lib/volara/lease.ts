/**
 * [P4-F] THE CYCLE LEASE — one agent, one cycle at a time.
 *
 * Five agents run concurrently, and a heartbeat can fire twice. Without a lease
 * the same agent could be mid-cycle in two places, each reading the treasury,
 * each deciding a request was affordable, each writing one. The allocation
 * approval has its own atomic guard so no money would be double-reserved, but
 * duplicate proposals, duplicate messages and a corrupted `cycleCount` would
 * all still happen, and the state machine would see transitions from a state
 * neither writer believed the agent was in.
 *
 * SO A CYCLE IS CLAIMED, NOT ASSUMED. `claimAgentCycle()` is one conditional
 * UPDATE whose WHERE clause says "only if nobody holds a live lease". The loser
 * updates zero rows and is told it lost — it does not wait, retry, or proceed.
 * This is the same compare-and-swap shape `consumeApprovalGrant()` and
 * `src/lib/economic/scheduler.ts` use, for the same reason: a read-then-write
 * pair has a window, and a window is all a concurrent caller needs.
 *
 * THE LEASE EXPIRES. A process that dies mid-cycle would otherwise hold its
 * agent forever, and "a failed agent must not consume resources forever" would
 * be false in the most literal way. `LEASE_TTL_MS` bounds it; a stale lease is
 * reclaimable by the next caller without any cleanup step.
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";

/**
 * How long a lease is honoured. Two minutes: comfortably longer than a cycle,
 * which does only database work, and short enough that a crashed process does
 * not strand an agent for a noticeable time.
 */
export const LEASE_TTL_MS = 2 * 60 * 1000;

export type ClaimResult =
  | { claimed: true; leaseId: string; expiresAt: Date }
  | { claimed: false; reason: "HELD" | "NOT_FOUND" | "SUSPENDED" };

/**
 * Claims the right to run one cycle for one agent.
 *
 * The WHERE clause carries every condition: the agent must be this user's, must
 * not be suspended or paused, and must have no unexpired lease. A suspended
 * agent is excluded here as well as in the scheduler, so a direct call cannot
 * do what the sweep refuses to.
 */
export async function claimAgentCycle(
  userId: string,
  agentId: string,
  now: Date = new Date()
): Promise<ClaimResult> {
  const leaseId = randomUUID();
  const expiresAt = new Date(now.getTime() + LEASE_TTL_MS);

  const claimed = await db.agent.updateMany({
    where: {
      id: agentId,
      userId,
      runtimeState: { notIn: ["SUSPENDED", "PAUSED"] },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
    },
    data: { leaseId, leaseExpiresAt: expiresAt },
  });

  if (claimed.count === 1) return { claimed: true, leaseId, expiresAt };

  // Advisory re-read: says WHICH condition failed. The refusal already happened.
  const agent = await db.agent.findFirst({
    where: { id: agentId, userId },
    select: { runtimeState: true },
  });
  if (!agent) return { claimed: false, reason: "NOT_FOUND" };
  if (agent.runtimeState === "SUSPENDED" || agent.runtimeState === "PAUSED") {
    return { claimed: false, reason: "SUSPENDED" };
  }
  return { claimed: false, reason: "HELD" };
}

/**
 * Releases a lease this caller holds.
 *
 * `leaseId` is in the WHERE clause deliberately: a cycle whose lease already
 * expired and was reclaimed by another must not clear the NEW holder's lease on
 * its way out. Releasing someone else's lease is exactly how two cycles end up
 * running anyway, one lease-check later.
 */
export async function releaseAgentCycle(userId: string, agentId: string, leaseId: string): Promise<boolean> {
  const released = await db.agent.updateMany({
    where: { id: agentId, userId, leaseId },
    data: { leaseId: null, leaseExpiresAt: null },
  });
  return released.count === 1;
}

/** Whether this caller still holds the lease. Checked before consequential work. */
export async function holdsLease(userId: string, agentId: string, leaseId: string): Promise<boolean> {
  const agent = await db.agent.findFirst({
    where: { id: agentId, userId, leaseId, leaseExpiresAt: { gt: new Date() } },
    select: { id: true },
  });
  return agent !== null;
}
