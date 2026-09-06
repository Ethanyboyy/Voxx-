/**
 * [P4-F] THE FIVE PERSISTENT VOLARA AGENTS.
 *
 * They are rows, not prompts. `ensureVolaraRoster()` creates five `Agent`
 * records — the SAME model every other agent in VOX uses — with a role, a
 * persona, a runtime state and a capability allowlist. After that they exist
 * whether or not anything is running: restart the process and they are still
 * there, still in whatever state their last cycle left them.
 *
 * CONFIGURABLE, NOT HARDCODED. The seed below is a default the user can edit
 * afterwards through the ordinary agent surfaces. Nothing in the runtime
 * branches on an agent's NAME, and nothing branches on its role for
 * authorization — `runStage()` dispatches on role to decide what an agent
 * LOOKS AT, and the governor, the policy gate and the executor never see the
 * role at all. Two agents with different roles and identical
 * `allowedCapabilities` can perform identical actions.
 *
 * THE SEEDED CAPABILITIES ARE THE INERT ONES. Read-level keys only, and
 * `maxRequestCents: 0`, which means a freshly seeded agent may request no
 * capital whatsoever. Raising either is a human act through the existing
 * permissions and agent surfaces. Seeding an agent that could already spend
 * would make "capital cannot be self-granted" true only until someone ran the
 * seeder.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { deepFreeze } from "@/lib/policy/classification";
import { VOLARA_EVENTS } from "@/lib/volara/events";
import type { Agent } from "@/generated/prisma/client";
import type { AgentRole } from "@/generated/prisma/enums";

export interface VolaraSeed {
  name: string;
  role: AgentRole;
  description: string;
  instructions: string;
  /** Identity/personality configuration. Never read by anything that decides. */
  persona: Record<string, unknown>;
  /** Capability keys. Read-level only — see the module note. */
  allowedCapabilities: string[];
  /** Tool names, narrower than the capabilities above. Never wider. */
  allowedTools: string[];
}

/**
 * The default society.
 *
 * The roles divide ATTENTION, which is the thing worth dividing: five agents
 * that all look at the same rows in the same order would produce five copies of
 * one opinion, and the collective-intelligence mechanisms in §12 depend on them
 * genuinely disagreeing about real data.
 */
export const VOLARA_ROSTER: readonly VolaraSeed[] = deepFreeze([
  {
    name: "Volara-1",
    role: "SCOUT",
    description: "Surfaces unexamined rows in the shared Opportunity Ledger.",
    instructions:
      "Find opportunities the society has not yet looked at. Report what is recorded; never invent an opportunity that has no basis in the ledger.",
    persona: { focus: "breadth", bias: "reports unknowns rather than filling them in" },
    allowedCapabilities: ["memory.read", "project.read"],
    allowedTools: ["memory.search"],
  },
  {
    name: "Volara-2",
    role: "ANALYST",
    description: "Challenges recorded economics that are incomplete or self-inconsistent.",
    instructions:
      "Check the arithmetic and the provenance of every economic claim on an opportunity. An unknown stays unknown — never supply a missing number.",
    persona: { focus: "rigour", bias: "assumes an unstated downside is unbounded" },
    allowedCapabilities: ["memory.read", "project.read"],
    allowedTools: ["memory.search"],
  },
  {
    name: "Volara-3",
    role: "STRATEGIST",
    description: "Drafts strategies against opportunities with recorded evidence.",
    instructions:
      "Turn well-evidenced opportunities into strategy drafts with an explicit hypothesis, mechanism and stated assumptions. A draft is a proposal; you never activate one.",
    persona: { focus: "synthesis", bias: "states assumptions separately so they can be attacked" },
    allowedCapabilities: ["memory.read", "project.read"],
    allowedTools: ["memory.search"],
  },
  {
    name: "Volara-4",
    role: "OPERATOR",
    description: "Requests capital for opportunities an active strategy admits.",
    instructions:
      "Where an ACTIVE strategy admits an opportunity, put a bounded capital request to a human with a stated rationale. You request; you never allocate.",
    persona: { focus: "execution", bias: "prefers the smallest test that would settle the question" },
    allowedCapabilities: ["memory.read", "project.read"],
    allowedTools: ["memory.search"],
  },
  {
    name: "Volara-5",
    role: "AUDITOR",
    description: "Re-derives treasury conservation and reports what does not reconcile.",
    instructions:
      "Independently recompute the economic position and the legality of every live allocation. Report discrepancies to the society; you fix nothing yourself.",
    persona: { focus: "conservation", bias: "trusts the ledger over any agent's account of it" },
    allowedCapabilities: ["memory.read", "project.read"],
    allowedTools: ["memory.search"],
  },
] as const);

/**
 * Creates any of the five that do not exist yet, and returns all five.
 *
 * IDEMPOTENT, and matched on `(userId, name)` — running it twice creates
 * nothing the second time, and it never overwrites an existing agent. That
 * second half matters: a user who narrowed Volara-4's capabilities must not
 * have that quietly undone by a re-seed, so an existing row is returned
 * untouched rather than reconciled against the default.
 */
export async function ensureVolaraRoster(userId: string): Promise<Agent[]> {
  const existing = await db.agent.findMany({
    where: { userId, name: { in: VOLARA_ROSTER.map((seed) => seed.name) } },
  });
  const byName = new Map(existing.map((agent) => [agent.name, agent]));

  const roster: Agent[] = [];
  for (const seed of VOLARA_ROSTER) {
    const already = byName.get(seed.name);
    if (already) {
      roster.push(already);
      continue;
    }
    const agent = await db.agent.create({
      data: {
        userId,
        name: seed.name,
        description: seed.description,
        instructions: seed.instructions,
        status: "READY",
        role: seed.role,
        persona: JSON.stringify(seed.persona),
        runtimeState: "IDLE",
        health: "UNKNOWN",
        autonomyMode: "SUPERVISED",
        allowedCapabilities: JSON.stringify(seed.allowedCapabilities),
        allowedTools: JSON.stringify(seed.allowedTools),
        // Zero. A seeded agent may request no capital until a human says so.
        maxRequestCents: 0,
      },
    });
    await recordEvent({
      userId,
      type: VOLARA_EVENTS.AGENT_CREATED,
      subjectType: "Agent",
      subjectId: agent.id,
      consequential: true,
      payload: { name: agent.name, role: agent.role, autonomyMode: agent.autonomyMode },
    });
    roster.push(agent);
  }

  return roster.sort((a, b) => a.name.localeCompare(b.name));
}

/** The society, as it currently stands. Read-only. */
export async function listVolaraAgents(userId: string): Promise<Agent[]> {
  return db.agent.findMany({
    where: { userId, role: { not: null } },
    orderBy: { name: "asc" },
  });
}

/**
 * Which agents are due for a cycle right now.
 *
 * The filter is the whole scheduling policy, and every clause is a safety
 * property rather than an optimisation:
 *
 *   - `role: { not: null }`    only Volara agents; ordinary user agents are
 *                              never swept into an autonomous loop.
 *   - not SUSPENDED / PAUSED   a stopped agent stays stopped (§21: a failed
 *                              agent must not consume resources forever).
 *   - not MANUAL               MANUAL means "only when a human asks", so it is
 *                              excluded from the automatic sweep and remains
 *                              reachable by an explicit single-agent call.
 *   - `nextWakeAt` respected   this is the backoff. An agent that just failed
 *                              is not eligible again until its delay elapses.
 */
export async function listSchedulableAgents(userId: string, now: Date = new Date()): Promise<Agent[]> {
  return db.agent.findMany({
    where: {
      userId,
      role: { not: null },
      status: { not: "ARCHIVED" },
      runtimeState: { notIn: ["SUSPENDED", "PAUSED"] },
      autonomyMode: { not: "MANUAL" },
      OR: [{ nextWakeAt: null }, { nextWakeAt: { lte: now } }],
    },
    orderBy: { name: "asc" },
  });
}
