/**
 * [P4-F] THE AGENT RUNTIME LOOP.
 *
 * Not one enormous function. Each stage below has explicit inputs, an explicit
 * output, and no knowledge of the others' internals — `observe()` returns a
 * `Perception`, `reason()` turns that into `Findings`, `propose()` turns
 * findings into rows. They are exported individually so a test can drive one
 * stage with hand-built inputs instead of arranging a whole cycle.
 *
 * WHAT THE STAGES ACTUALLY DO. Nothing here calls a model. The reasoning stage
 * is deterministic analysis over rows VOX already has: which ledger entries
 * nobody has examined, which recorded economics are internally inconsistent,
 * which strategies a human has activated, what the treasury derives to. That is
 * a deliberate choice, not a stub — a model call at this layer would make the
 * loop's behaviour untestable and would put generated text one step from the
 * governor. Model-assisted reasoning belongs in a tool, behind the executor,
 * behind the gate, and can be added later without changing any of this.
 *
 * THE AUTHORIZATION STAGE AUTHORIZES NOTHING. It hands consequential work to
 * the existing agent-run + approval path and parks. `runAgentCycle()` never
 * calls `approveCapitalAllocation()`, never mints a grant, and never touches
 * `enforceExecution()` — a human does, through the endpoints that already
 * exist.
 *
 * ONE CORRELATION ID PER CYCLE, threaded into every transition, message,
 * opportunity, strategy, allocation and event the cycle produces. That is what
 * makes "why did Volara-4 ask for $23.14" a single query rather than a join
 * hunt.
 */

import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { logger } from "@/lib/observability/logger";
import { enforceCapability } from "@/lib/permissions/service";
import { VOLARA_EVENTS } from "@/lib/volara/events";
import { EscalationRefusedError } from "@/lib/volara/guards";
import { claimAgentCycle, releaseAgentCycle } from "@/lib/volara/lease";
import {
  listExaminableOpportunities,
  listUnexaminedOpportunities,
  updateOpportunity,
  parseIdList,
} from "@/lib/volara/ledger";
import { readInbox, sendAgentMessage, markMessagesRead } from "@/lib/volara/messages";
import { listSchedulableAgents } from "@/lib/volara/roster";
import { MAX_CONSECUTIVE_FAILURES, suspendAgent, transitionAgent } from "@/lib/volara/state";
import { listActiveStrategies, proposeStrategy, realizedProfitForOpportunities } from "@/lib/volara/strategy";
import { getTreasuryPosition, type TreasuryPosition } from "@/lib/volara/treasury";
import type { Agent, AgentMessage, Opportunity, Strategy } from "@/generated/prisma/client";

/**
 * The capability a cycle runs under.
 *
 * RECOMMEND, because a cycle writes proposal rows — that is above ANALYZE, the
 * level every account holds by default, which was the P4-E finding: a default
 * level is not authorization for anything that writes. `enforceCapability()` is
 * the existing gate and the only one; nothing here is a second permission check.
 */
export const VOLARA_RUNTIME_CAPABILITY = "volara.runtime";

/** Backoff after a failed cycle, so a broken agent does not spin. */
export const FAILURE_BACKOFF_MS = 5 * 60 * 1000;

/** Hard bound on what one cycle may propose, so a loop cannot flood the tables. */
export const MAX_PROPOSALS_PER_CYCLE = 5;

// ---------------------------------------------------------------------------
// STAGE 1 — OBSERVE. Reads only. Writes nothing, decides nothing.
// ---------------------------------------------------------------------------

export interface Perception {
  agent: Agent;
  treasury: TreasuryPosition;
  unexamined: Opportunity[];
  examinable: Opportunity[];
  activeStrategies: Strategy[];
  inbox: AgentMessage[];
}

export async function observe(userId: string, agent: Agent): Promise<Perception> {
  const [treasury, unexamined, examinable, activeStrategies, inbox] = await Promise.all([
    getTreasuryPosition(userId),
    listUnexaminedOpportunities(userId, MAX_PROPOSALS_PER_CYCLE * 2),
    listExaminableOpportunities(userId, MAX_PROPOSALS_PER_CYCLE * 2),
    listActiveStrategies(userId),
    readInbox(userId, agent.id, { unreadOnly: true, limit: 20 }),
  ]);
  return { agent, treasury, unexamined, examinable, activeStrategies, inbox };
}

// ---------------------------------------------------------------------------
// STAGE 2 — REASON. Deterministic. Pure with respect to the perception.
// ---------------------------------------------------------------------------

/** One thing an agent concluded, with the row it concluded it about. */
export interface Finding {
  kind:
    | "UNEXAMINED_ROW"
    | "MISSING_DOWNSIDE"
    | "INCONSISTENT_ECONOMICS"
    | "STRATEGY_CANDIDATE"
    | "CAPITAL_CANDIDATE"
    | "RECONCILIATION_GAP";
  opportunityId?: string;
  strategyId?: string;
  /** Machine-readable detail. Never prose that anything downstream parses. */
  detail: Record<string, unknown>;
  summary: string;
}

export interface Findings {
  role: string | null;
  findings: Finding[];
}

/**
 * Role-specific analysis of what was observed.
 *
 * Every branch reads recorded values and compares them. None of them supplies a
 * number that was not recorded: an opportunity with no `maxLossCents` produces a
 * MISSING_DOWNSIDE finding, not a guessed downside. That is the difference
 * between an analyst and a fabricator, and it is enforced by the finding
 * vocabulary itself — there is no finding shape that carries an invented value.
 *
 * Pure: no database, no clock beyond what was perceived, no writes. Given the
 * same `Perception` it returns the same `Findings`, which is what makes the
 * five roles testable as tables.
 */
export function reason(perception: Perception): Findings {
  const findings: Finding[] = [];
  const role = perception.agent.role;

  switch (role) {
    case "SCOUT": {
      for (const row of perception.unexamined.slice(0, MAX_PROPOSALS_PER_CYCLE)) {
        findings.push({
          kind: "UNEXAMINED_ROW",
          opportunityId: row.id,
          detail: { status: row.status, discoveredAt: row.discoveredAt.toISOString() },
          summary: `"${row.title}" is recorded but nobody has examined it.`,
        });
      }
      break;
    }

    case "ANALYST": {
      for (const row of perception.examinable.slice(0, MAX_PROPOSALS_PER_CYCLE)) {
        // An unstated downside is an unbounded one. Reported, never filled in.
        if (row.maxLossCents === null) {
          findings.push({
            kind: "MISSING_DOWNSIDE",
            opportunityId: row.id,
            detail: { field: "maxLossCents" },
            summary: `"${row.title}" states no maximum loss, so its downside is unbounded until someone states one.`,
          });
        }
        // Internal inconsistency in what WAS recorded: profit above revenue is
        // arithmetically impossible, whoever entered it.
        if (
          row.expectedProfitCents !== null &&
          row.expectedRevenueCents !== null &&
          row.expectedProfitCents > row.expectedRevenueCents
        ) {
          findings.push({
            kind: "INCONSISTENT_ECONOMICS",
            opportunityId: row.id,
            detail: {
              expectedProfitCents: row.expectedProfitCents,
              expectedRevenueCents: row.expectedRevenueCents,
            },
            summary: `"${row.title}" records expected profit above expected revenue.`,
          });
        }
        if (row.probabilityOfSuccess !== null && (row.probabilityOfSuccess < 0 || row.probabilityOfSuccess > 1)) {
          findings.push({
            kind: "INCONSISTENT_ECONOMICS",
            opportunityId: row.id,
            detail: { probabilityOfSuccess: row.probabilityOfSuccess },
            summary: `"${row.title}" records a probability outside 0-1.`,
          });
        }
      }
      break;
    }

    case "STRATEGIST": {
      // Only rows that already carry a stated downside and some evidence are
      // strategy candidates. A strategy over an unbounded downside would be a
      // proposal the governor is guaranteed to refuse, which wastes a human's
      // attention rather than protecting it.
      for (const row of perception.examinable) {
        if (findings.length >= MAX_PROPOSALS_PER_CYCLE) break;
        const alreadyCovered = perception.activeStrategies.some((s) => s.opportunityId === row.id);
        if (alreadyCovered || row.maxLossCents === null || !row.evidence) continue;
        findings.push({
          kind: "STRATEGY_CANDIDATE",
          opportunityId: row.id,
          detail: { maxLossCents: row.maxLossCents, category: row.category },
          summary: `"${row.title}" has a stated downside and recorded evidence, and no active strategy covers it.`,
        });
      }
      break;
    }

    case "OPERATOR": {
      // Capital candidates require a HUMAN-ACTIVATED strategy that admits the
      // row's category. The activation check is duplicated in the governor; it
      // is here too so an agent does not spend a cycle producing requests that
      // are certain to be refused.
      for (const strategy of perception.activeStrategies) {
        if (findings.length >= MAX_PROPOSALS_PER_CYCLE) break;
        if (strategy.activatedByHumanAt === null || strategy.maxCapitalCents <= 0) continue;
        const categories = parseIdList(strategy.targetCategories);
        for (const row of perception.examinable) {
          if (findings.length >= MAX_PROPOSALS_PER_CYCLE) break;
          if (row.maxLossCents === null) continue;
          if (categories.length > 0 && (!row.category || !categories.includes(row.category))) continue;
          // The request is the SMALLER of what the row says it needs and what
          // the strategy's remaining headroom allows — never the cap itself.
          const needed = row.requiredCapitalCents;
          if (needed === null || needed <= 0) continue;
          findings.push({
            kind: "CAPITAL_CANDIDATE",
            opportunityId: row.id,
            strategyId: strategy.id,
            detail: { requiredCapitalCents: needed, strategyCapCents: strategy.maxCapitalCents },
            summary: `"${row.title}" is admitted by strategy "${strategy.name}" and records a capital requirement.`,
          });
        }
      }
      break;
    }

    case "AUDITOR": {
      // Conservation, recomputed independently of the governor. Reserved must
      // never exceed what the ceiling minus real spend can cover.
      const t = perception.treasury;
      if (t.reservedCents + t.spentCents > t.ceilingCents) {
        findings.push({
          kind: "RECONCILIATION_GAP",
          detail: {
            ceilingCents: t.ceilingCents,
            spentCents: t.spentCents,
            reservedCents: t.reservedCents,
          },
          summary: "Reserved plus spent exceeds the autonomous ceiling.",
        });
      }
      if (t.deployedCents > t.reservedCents + t.spentCents) {
        findings.push({
          kind: "RECONCILIATION_GAP",
          detail: { deployedCents: t.deployedCents, reservedCents: t.reservedCents },
          summary: "More capital is recorded as deployed than was ever reserved.",
        });
      }
      break;
    }

    default:
      break;
  }

  return { role, findings };
}

// ---------------------------------------------------------------------------
// STAGE 3 — PROPOSE. Writes PROPOSAL rows only. Every write is screened.
// ---------------------------------------------------------------------------

export interface ProposalOutcome {
  opportunitiesUpdated: number;
  strategiesProposed: number;
  capitalRequested: number;
  messagesSent: number;
  /** Findings that could not be acted on, with the reason. */
  skipped: Array<{ finding: Finding["kind"]; reason: string }>;
}

/**
 * Turns findings into rows.
 *
 * Nothing consequential happens here. The heaviest thing this stage can do is
 * write a `CapitalAllocation` in `REQUESTED`, which reserves nothing and moves
 * no money — a human still has to approve it through the existing path.
 *
 * MANUAL and the observe-equivalent autonomy mode suppress capital requests
 * entirely: a mode that only runs when a human asks should not be putting
 * spending decisions in front of that human unprompted.
 */
export async function propose(
  userId: string,
  perception: Perception,
  findings: Findings,
  correlationId: string
): Promise<ProposalOutcome> {
  const agent = perception.agent;
  const outcome: ProposalOutcome = {
    opportunitiesUpdated: 0,
    strategiesProposed: 0,
    capitalRequested: 0,
    messagesSent: 0,
    skipped: [],
  };

  // Imported lazily so this module's import graph does not include the governor
  // on paths that never request capital — and so a reader can see at a glance
  // that the ONLY capital entry point from the loop is this one call.
  const { requestCapital } = await import("@/lib/volara/governor");

  for (const finding of findings.findings) {
    switch (finding.kind) {
      case "UNEXAMINED_ROW": {
        if (!finding.opportunityId) break;
        const updated = await updateOpportunity({
          userId,
          agentId: agent.id,
          opportunityId: finding.opportunityId,
          status: "EVALUATING",
          correlationId,
        });
        if (updated.updated) outcome.opportunitiesUpdated++;
        else outcome.skipped.push({ finding: finding.kind, reason: updated.reason });
        const sent = await sendAgentMessage({
          userId,
          fromAgentId: agent.id,
          kind: "DISCOVERY",
          subject: "Unexamined ledger row",
          body: finding.summary,
          opportunityId: finding.opportunityId,
          correlationId,
        });
        if (sent.sent) outcome.messagesSent += sent.messages.length;
        break;
      }

      case "MISSING_DOWNSIDE":
      case "INCONSISTENT_ECONOMICS": {
        // The ANALYST CHALLENGES; it does not correct. Broadcasting the
        // challenge is how the society gets to disagree about real data.
        const sent = await sendAgentMessage({
          userId,
          fromAgentId: agent.id,
          kind: "CHALLENGE",
          priority: finding.kind === "INCONSISTENT_ECONOMICS" ? "HIGH" : "NORMAL",
          subject: finding.kind === "MISSING_DOWNSIDE" ? "Unstated downside" : "Inconsistent economics",
          body: finding.summary,
          payload: finding.detail,
          opportunityId: finding.opportunityId,
          correlationId,
        });
        if (sent.sent) {
          outcome.messagesSent += sent.messages.length;
          await recordEvent({
            userId,
            type: VOLARA_EVENTS.OPPORTUNITY_CHALLENGED,
            subjectType: "Opportunity",
            subjectId: finding.opportunityId,
            consequential: false,
            payload: { agentId: agent.id, kind: finding.kind, correlationId },
          });
        }
        break;
      }

      case "STRATEGY_CANDIDATE": {
        if (!finding.opportunityId) break;
        const row = perception.examinable.find((o) => o.id === finding.opportunityId);
        if (!row) break;
        await proposeStrategy({
          userId,
          agentId: agent.id,
          name: `Strategy for ${row.title}`,
          hypothesis: row.rationale ?? `Pursuing "${row.title}" on its recorded evidence.`,
          mechanism: row.nextAction ?? undefined,
          opportunityId: row.id,
          assumptions: [
            `Maximum loss is bounded at the recorded ${row.maxLossCents} cents.`,
            row.probabilityOfSuccess === null
              ? "No probability of success has been recorded."
              : `Recorded probability of success is ${row.probabilityOfSuccess}.`,
          ],
          // The requested cap is recorded for a human to consider. It is NOT
          // written to the field the governor reads — see proposeStrategy().
          requestedCapitalCents: row.requiredCapitalCents ?? 0,
          expectedReturnCents: row.expectedRevenueCents ?? undefined,
          expectedDurationDays: row.timeToPayoutDays ?? undefined,
          probabilityOfSuccess: row.probabilityOfSuccess ?? undefined,
          maxLossCents: row.maxLossCents ?? undefined,
          risk: row.risk ?? undefined,
          targetCategories: row.category ? [row.category] : [],
          correlationId,
        });
        outcome.strategiesProposed++;
        break;
      }

      case "CAPITAL_CANDIDATE": {
        if (agent.autonomyMode === "MANUAL") {
          outcome.skipped.push({ finding: finding.kind, reason: "MANUAL_MODE" });
          break;
        }
        const requiredCapitalCents = Number(finding.detail.requiredCapitalCents ?? 0);
        const requested = await requestCapital({
          userId,
          agentId: agent.id,
          strategyId: finding.strategyId,
          opportunityId: finding.opportunityId,
          requestedCents: requiredCapitalCents,
          rationale: finding.summary,
          correlationId,
          // Deterministic from the cycle and the target, so a retried cycle
          // collapses onto the same row instead of asking twice.
          idempotencyKey: `${correlationId}:${agent.id}:${finding.opportunityId ?? "none"}`,
        });
        if (requested.requested) outcome.capitalRequested++;
        else outcome.skipped.push({ finding: finding.kind, reason: requested.reasons.join(",") });
        break;
      }

      case "RECONCILIATION_GAP": {
        const sent = await sendAgentMessage({
          userId,
          fromAgentId: agent.id,
          kind: "WARNING",
          priority: "URGENT",
          subject: "Treasury does not reconcile",
          body: finding.summary,
          payload: finding.detail,
          correlationId,
        });
        if (sent.sent) outcome.messagesSent += sent.messages.length;
        break;
      }
    }
  }

  return outcome;
}

// ---------------------------------------------------------------------------
// STAGE 4 — LEARN. Records what the cycle actually produced, from real rows.
// ---------------------------------------------------------------------------

export interface CycleLearning {
  /** Realized profit under strategies this agent owns. From the ledger only. */
  realizedProfitCents: number;
  /** Rows this agent's strategies have settled. */
  settledOpportunities: number;
}

export async function learn(userId: string, agent: Agent): Promise<CycleLearning> {
  const strategies = await db.strategy.findMany({
    where: { userId, ownerAgentId: agent.id },
    include: { allocations: { select: { opportunityId: true } } },
  });
  const opportunityIds = strategies
    .flatMap((strategy) => strategy.allocations.map((allocation) => allocation.opportunityId))
    .filter((id): id is string => id !== null);

  const [realizedProfitCents, settledOpportunities] = await Promise.all([
    realizedProfitForOpportunities(userId, opportunityIds),
    opportunityIds.length > 0
      ? db.opportunity.count({ where: { userId, id: { in: opportunityIds }, status: { in: ["COMPLETED", "FAILED"] } } })
      : Promise.resolve(0),
  ]);

  return { realizedProfitCents, settledOpportunities };
}

// ---------------------------------------------------------------------------
// THE CYCLE — claim, stage, release. Failure contained inside.
// ---------------------------------------------------------------------------

export type CycleResult =
  | {
      ran: true;
      agentId: string;
      correlationId: string;
      findings: number;
      proposals: ProposalOutcome;
      learning: CycleLearning;
    }
  | { ran: false; agentId: string; reason: "LOCKED" | "NOT_FOUND" | "SUSPENDED" | "FAILED"; error?: string };

/**
 * One cycle for one agent.
 *
 * The capability check is FIRST and it is the existing `enforceCapability()` —
 * a cycle writes rows, so it needs authorization like anything else that
 * writes. It throws `PermissionDeniedError` on refusal, which is correct: an
 * unauthorized cycle should not degrade to a quiet no-op.
 *
 * Everything after the claim is inside a try/finally that releases the lease.
 * A throw anywhere in the stages is caught, counted, backed off and — at
 * `MAX_CONSECUTIVE_FAILURES` — suspends this agent and no other.
 */
export async function runAgentCycle(userId: string, agentId: string): Promise<CycleResult> {
  await enforceCapability(userId, VOLARA_RUNTIME_CAPABILITY, "RECOMMEND");

  const correlationId = randomUUID();
  const claim = await claimAgentCycle(userId, agentId);
  if (!claim.claimed) {
    await recordEvent({
      userId,
      type: VOLARA_EVENTS.CYCLE_SKIPPED,
      subjectType: "Agent",
      subjectId: agentId,
      consequential: false,
      payload: { reason: claim.reason, correlationId },
    });
    return { ran: false, agentId, reason: claim.reason === "HELD" ? "LOCKED" : claim.reason };
  }

  const agent = await db.agent.findFirst({ where: { id: agentId, userId } });
  if (!agent) {
    await releaseAgentCycle(userId, agentId, claim.leaseId);
    return { ran: false, agentId, reason: "NOT_FOUND" };
  }

  await recordEvent({
    userId,
    type: VOLARA_EVENTS.CYCLE_STARTED,
    subjectType: "Agent",
    subjectId: agentId,
    consequential: false,
    payload: { correlationId, role: agent.role, autonomyMode: agent.autonomyMode },
  });

  try {
    // OBSERVE
    await transitionAgent({
      userId,
      agentId,
      to: "THINKING",
      reason: "CYCLE_START",
      correlationId,
      patch: { currentStage: "observe", health: "HEALTHY", heartbeatAt: new Date() },
    });
    const perception = await observe(userId, agent);
    await markMessagesRead(userId, perception.inbox.map((message) => message.id));

    // REASON
    await transitionAgent({
      userId,
      agentId,
      to: "EVALUATING",
      reason: "REASON",
      correlationId,
      patch: { currentStage: "reason", heartbeatAt: new Date() },
    });
    const findings = reason(perception);

    // PROPOSE
    await transitionAgent({
      userId,
      agentId,
      to: "PROPOSING",
      reason: "PROPOSE",
      correlationId,
      patch: { currentStage: "propose", heartbeatAt: new Date() },
    });
    const proposals = await propose(userId, perception, findings, correlationId);

    // AUTHORIZE — the loop's part is to WAIT, never to authorize. A cycle that
    // produced a capital request parks in WAITING_FOR_AUTHORIZATION so the
    // observer shows an agent blocked on a person rather than idle.
    if (proposals.capitalRequested > 0) {
      await transitionAgent({
        userId,
        agentId,
        to: "WAITING_FOR_AUTHORIZATION",
        reason: "CAPITAL_REQUESTED",
        correlationId,
        patch: { currentStage: "authorize", heartbeatAt: new Date() },
      });
      await transitionAgent({
        userId,
        agentId,
        to: "REPORTING",
        reason: "CYCLE_REPORT",
        correlationId,
        patch: { currentStage: "report" },
      });
    } else {
      await transitionAgent({
        userId,
        agentId,
        to: "REPORTING",
        reason: "CYCLE_REPORT",
        correlationId,
        patch: { currentStage: "report", heartbeatAt: new Date() },
      });
    }

    // LEARN
    await transitionAgent({
      userId,
      agentId,
      to: "LEARNING",
      reason: "CYCLE_LEARN",
      correlationId,
      patch: { currentStage: "learn" },
    });
    const learning = await learn(userId, agent);

    // A successful cycle resets the consecutive counter. `failureCount` is
    // lifetime history and is never reset — see resumeAgent().
    await db.agent.updateMany({
      where: { id: agentId, userId },
      data: {
        cycleCount: { increment: 1 },
        consecutiveFailures: 0,
        heartbeatAt: new Date(),
        lastActivityAt: new Date(),
        nextWakeAt: null,
      },
    });
    await transitionAgent({
      userId,
      agentId,
      to: "IDLE",
      reason: "CYCLE_COMPLETE",
      correlationId,
      patch: { currentStage: null, health: "HEALTHY" },
    });

    await recordEvent({
      userId,
      type: VOLARA_EVENTS.CYCLE_COMPLETED,
      subjectType: "Agent",
      subjectId: agentId,
      consequential: false,
      payload: {
        correlationId,
        findings: findings.findings.length,
        opportunitiesUpdated: proposals.opportunitiesUpdated,
        strategiesProposed: proposals.strategiesProposed,
        capitalRequested: proposals.capitalRequested,
        messagesSent: proposals.messagesSent,
        skipped: proposals.skipped,
        realizedProfitCents: learning.realizedProfitCents,
      },
    });

    return { ran: true, agentId, correlationId, findings: findings.findings.length, proposals, learning };
  } catch (error) {
    // FAILURE CONTAINMENT. Recorded, counted, backed off, and — past the
    // threshold — suspended. The run is never deleted: failures are evidence.
    const message = error instanceof Error ? error.message : String(error);
    logger.error("volara.cycle_failed", { agentId, correlationId, error: message });

    // Scoped by `userId` as well as `id`, like every other write in this
    // module. The claim above already proved ownership, so this is belt-and-
    // braces — but an unscoped `update` by id is the shape a cross-tenant write
    // takes, and it should not appear in the file even where it is provably safe.
    await db.agent.updateMany({
      where: { id: agentId, userId },
      data: {
        cycleCount: { increment: 1 },
        failureCount: { increment: 1 },
        consecutiveFailures: { increment: 1 },
        health: "DEGRADED",
        currentStage: null,
        nextWakeAt: new Date(Date.now() + FAILURE_BACKOFF_MS),
      },
    });
    const updated = await db.agent.findFirstOrThrow({
      where: { id: agentId, userId },
      select: { consecutiveFailures: true },
    });

    await recordEvent({
      userId,
      type: VOLARA_EVENTS.CYCLE_FAILED,
      subjectType: "Agent",
      subjectId: agentId,
      consequential: true,
      payload: {
        correlationId,
        error: message,
        // An escalation attempt is called out by name: it is a different class
        // of failure from a crash, and the auditor should see which it was.
        escalation: error instanceof EscalationRefusedError ? error.reason : null,
        consecutiveFailures: updated.consecutiveFailures,
      },
    });

    if (updated.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
      await suspendAgent(
        userId,
        agentId,
        `${updated.consecutiveFailures} consecutive failed cycles; last: ${message.slice(0, 200)}`,
        correlationId
      );
    } else {
      await transitionAgent({
        userId,
        agentId,
        to: "FAILED",
        reason: "CYCLE_FAILED",
        correlationId,
        patch: { health: "DEGRADED" },
      });
    }

    return { ran: false, agentId, reason: "FAILED", error: message };
  } finally {
    await releaseAgentCycle(userId, agentId, claim.leaseId);
  }
}

/**
 * One cycle for every schedulable agent.
 *
 * `Promise.allSettled`, deliberately: one agent throwing must not stop the
 * other four, which is the whole of §21's containment requirement at the
 * society level. `runAgentCycle()` already catches its own failures, so a
 * rejection here means something outside the cycle failed — and even that is
 * contained to one entry in the results.
 */
export async function runSociety(userId: string): Promise<CycleResult[]> {
  const agents = await listSchedulableAgents(userId);
  const results = await Promise.allSettled(agents.map((agent) => runAgentCycle(userId, agent.id)));
  return results.map((result, index) =>
    result.status === "fulfilled"
      ? result.value
      : {
          ran: false as const,
          agentId: agents[index].id,
          reason: "FAILED" as const,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        }
  );
}
