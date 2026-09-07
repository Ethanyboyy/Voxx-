/**
 * Seeds a second throwaway account for the Global Observer visual QA pass.
 *
 * The empty account (seed-finance-qa.ts) proves the truthful empty states. This
 * one proves the populated case: a full agent roster in mixed runtime states, a
 * pending capital request awaiting a human, agent-to-agent messages (the
 * InteractionGraph's 820px table), strategies, opportunities and events. Only a
 * populated screen can show a table overflowing its container on a phone.
 *
 * Usage: DATABASE_URL=file:./prisma/qa.db npx tsx tools/qa/seed-observer-qa.ts
 */
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { ensureVolaraRoster } from "@/lib/volara/roster";

const EMAIL = process.env.OBS_EMAIL ?? "qa-observer@vox.local";
const PASSWORD = process.env.OBS_PASSWORD ?? "correcthorsebattery1";

const CORRELATION = "qa-observer-cycle-0001";

async function main() {
  const passwordHash = await hashPassword(PASSWORD);
  const user = await db.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash, maxAutonomousSpendUsd: 500, economicHaltedAt: null, economicHaltReason: null },
    create: { email: EMAIL, passwordHash, name: "QA Observer", maxAutonomousSpendUsd: 500 },
  });

  await db.capitalAllocation.deleteMany({ where: { userId: user.id } });
  await db.agentMessage.deleteMany({ where: { userId: user.id } });
  await db.agentStateTransition.deleteMany({ where: { userId: user.id } });
  await db.strategy.deleteMany({ where: { userId: user.id } });
  await db.opportunity.deleteMany({ where: { userId: user.id } });
  await db.objective.deleteMany({ where: { userId: user.id } });

  const agents = await ensureVolaraRoster(user.id);
  console.log(`roster: ${agents.map((a) => a.name).join(", ")}`);

  const now = new Date();
  const ago = (min: number) => new Date(now.getTime() - min * 60_000);

  const objective = await db.objective.create({
    data: { userId: user.id, title: "Reach $5k/mo of recorded revenue", status: "ACTIVE" },
  });

  const opportunity = await db.opportunity.create({
    data: {
      userId: user.id,
      objectiveId: objective.id,
      title: "Newsletter sponsorship placements for niche B2B audience",
      description: "Broker three sponsor slots against an owned list.",
      category: "CONTENT",
      status: "EVALUATING",
      source: `volara:${agents[0].id}`,
      discoveredByAgentId: agents[0].id,
      participatingAgentIds: JSON.stringify([agents[0].id, agents[1].id]),
      requiredCapitalCents: 40_000,
      expectedRevenueCents: 180_000,
      expectedProfitCents: 140_000,
      probabilityOfSuccess: 0.35,
      maxLossCents: 40_000,
      correlationId: CORRELATION,
    },
  });

  const strategy = await db.strategy.create({
    data: {
      userId: user.id,
      ownerAgentId: agents[1].id,
      opportunityId: opportunity.id,
      name: "Sponsor-slot arbitrage",
      hypothesis: "Slots bought at list rate resell above cost when bundled with a case study.",
      mechanism: "Buy three slots, bundle, resell to two advertisers.",
      assumptions: JSON.stringify(["The list stays above 40% open rate", "Advertisers pay net-30"]),
      status: "ACTIVE",
      maxCapitalCents: 120_000,
      expectedReturnCents: 180_000,
      expectedDurationDays: 45,
      probabilityOfSuccess: 0.35,
      maxLossCents: 40_000,
      risk: "MEDIUM",
      targetCategories: JSON.stringify(["CONTENT"]),
      correlationId: CORRELATION,
    },
  });

  // A request awaiting a human. REQUESTED + no grant is the whole point of the
  // Approval Center: an agent asked, nobody has agreed.
  await db.capitalAllocation.create({
    data: {
      userId: user.id,
      agentId: agents[1].id,
      opportunityId: opportunity.id,
      strategyId: strategy.id,
      requestedCents: 40_000,
      status: "REQUESTED",
      rationale:
        "Three slots at list rate, resold bundled. Downside is capped at the slot cost because the slots are prepaid and non-refundable; there is no recurring commitment.",
      governorVerdict: "PASS",
      governorReasons: JSON.stringify(["WITHIN_AGENT_CAP", "WITHIN_STRATEGY_CEILING", "NO_ACTIVE_HALT"]),
      correlationId: CORRELATION,
      idempotencyKey: `${CORRELATION}:alloc:1`,
      requestedAt: ago(12),
      expiresAt: new Date(now.getTime() + 6 * 60 * 60 * 1000),
    },
  });

  // A second, already-decided one so the screen shows both a decision and a
  // pending ask side by side.
  await db.capitalAllocation.create({
    data: {
      userId: user.id,
      agentId: agents[2].id,
      strategyId: strategy.id,
      requestedCents: 25_000,
      approvedCents: 0,
      status: "REJECTED",
      rationale: "Second creative test on the same channel before the first has settled.",
      governorVerdict: "REFUSED_NO_EVIDENCE",
      governorReasons: JSON.stringify(["PRIOR_ALLOCATION_UNSETTLED"]),
      correlationId: CORRELATION,
      idempotencyKey: `${CORRELATION}:alloc:2`,
      requestedAt: ago(90),
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
      decidedAt: ago(80),
    },
  });

  const kinds = ["DISCOVERY", "CHALLENGE", "WARNING", "REQUEST", "RESULT"] as const;
  for (let i = 0; i < 10; i++) {
    const from = agents[i % agents.length];
    const to = agents[(i + 2) % agents.length];
    await db.agentMessage.create({
      data: {
        userId: user.id,
        senderKind: "AGENT",
        fromAgentId: from.id,
        toAgentId: i === 4 ? null : to.id,
        kind: kinds[i % kinds.length],
        priority: i % 4 === 0 ? "HIGH" : "NORMAL",
        subject: `Sponsor-slot arbitrage: ${kinds[i % kinds.length].toLowerCase()} ${i + 1}`,
        body: "The assumption under dispute is the 40% open rate; the last two sends were 31% and 29%.",
        opportunityId: opportunity.id,
        strategyId: strategy.id,
        correlationId: CORRELATION,
        createdAt: ago(120 - i * 8),
      },
    });
  }

  const states = ["THINKING", "RESEARCHING", "EVALUATING", "PROPOSING", "WAITING_FOR_AUTHORIZATION"] as const;
  for (let i = 0; i < agents.length; i++) {
    const to = states[i % states.length];
    await db.agent.update({
      where: { id: agents[i].id },
      data: {
        runtimeState: to,
        lastActivityAt: ago(3 + i),
        heartbeatAt: ago(1 + i),
        confidence: 0.4 + i * 0.1,
      },
    });
    await db.agentStateTransition.create({
      data: {
        userId: user.id,
        agentId: agents[i].id,
        fromState: "IDLE",
        toState: to,
        reason: "QA fixture cycle start",
        correlationId: CORRELATION,
        createdAt: ago(10 - i),
      },
    });
  }

  const eventTypes = [
    "volara.agent.transitioned",
    "volara.opportunity.discovered",
    "volara.message.sent",
    "volara.capital.requested",
    "volara.capital.rejected",
  ];
  for (let i = 0; i < 25; i++) {
    await db.event.create({
      data: {
        userId: user.id,
        type: eventTypes[i % eventTypes.length],
        subjectType: "Agent",
        subjectId: agents[i % agents.length].id,
        consequential: i % 5 === 3,
        payload: JSON.stringify({ correlationId: CORRELATION, agentId: agents[i % agents.length].id }),
        createdAt: ago(200 - i * 5),
      },
    });
  }

  console.log(`Seeded ${EMAIL} (user ${user.id}), correlation ${CORRELATION}.`);
}

main().finally(() => db.$disconnect());
