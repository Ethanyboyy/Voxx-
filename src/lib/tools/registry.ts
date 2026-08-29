import { z } from "zod";
import { createMemory, getSemanticMemories } from "@/lib/memory/service";
import { createProject, createTask, createIdea, createDecision } from "@/lib/projects/service";
import { runResearch } from "@/lib/research/service";
import { proposeConnection } from "@/lib/connections/service";
import { getCatalogEntry } from "@/lib/integrations/catalog";
import { getConnectionProvider } from "@/lib/integrations/stub";
import { createRequirement, nextRequirementCode } from "@/lib/lab/requirements";
import { createQuestion } from "@/lib/lab/questions";
import { recordOpportunitySpend } from "@/lib/economic/service";
import { evaluateSpendPolicy } from "@/lib/economic/policy";
import type { ToolDefinition } from "@/lib/tools/types";

/**
 * The general Tool Registry — a discoverable counterpart to the Proposal
 * engine's closed ACTION_HANDLERS map (src/lib/cognition/proposals.ts).
 * Every tool wraps an *existing* service function (never duplicates logic)
 * and is gated by the same enforceCapability() used everywhere in VOX — the
 * executor (src/lib/agents/executor.ts) is the only caller, and it checks
 * capability before every single tool.execute(), no exceptions.
 *
 * Real external tools (calendar.*) resolve through the exact same
 * StubConnectionProvider used by the Connections Hub — they report a clear
 * "not configured" error rather than faking a result, until real vendor
 * credentials exist. This is the "build the architecture, not a fake
 * connection" instruction from the Phase 3/4 directive, applied at the tool
 * layer instead of just the Connections Hub layer.
 */
const REGISTRY: Record<string, ToolDefinition<never>> = {};

function register<TInput>(tool: ToolDefinition<TInput>) {
  REGISTRY[tool.name] = tool as unknown as ToolDefinition<never>;
}

register({
  name: "memory.search",
  description: "Search VOX's memory of the user by meaning (semantic similarity), returning the most relevant memories.",
  category: "memory",
  capability: "memory.read",
  requiredLevel: "OBSERVE",
  inputSchema: z.object({ query: z.string().min(1).max(2000), limit: z.number().int().min(1).max(20).optional() }),
  execute: async (userId, input) => {
    const results = await getSemanticMemories(userId, input.query, input.limit ?? 8);
    return {
      output: results.map((m) => ({ id: m.id, content: m.content, category: m.category, confidence: m.confidence })),
      summary: `Found ${results.length} relevant ${results.length === 1 ? "memory" : "memories"}.`,
    };
  },
});

register({
  name: "memory.create",
  description: "Record a new memory about the user.",
  category: "memory",
  capability: "memory.write",
  requiredLevel: "ANALYZE",
  inputSchema: z.object({
    content: z.string().min(1).max(10_000),
    category: z.enum(["FACT", "PREFERENCE", "GOAL", "PROJECT", "EXPERIENCE", "IDEA", "OBSERVATION", "HYPOTHESIS", "INFERENCE", "TEMPORARY_CONTEXT"]),
    confidence: z.enum(["LOW", "MEDIUM", "HIGH", "CONFIRMED"]).optional(),
  }),
  execute: async (userId, input) => {
    const memory = await createMemory({ userId, content: input.content, category: input.category, confidence: input.confidence });
    return { output: { id: memory.id }, summary: `Remembered: "${input.content.slice(0, 80)}${input.content.length > 80 ? "..." : ""}"` };
  },
});

register({
  name: "task.create",
  description: "Create a task, optionally attached to a project.",
  category: "project",
  capability: "project.write",
  requiredLevel: "RECOMMEND",
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    projectId: z.string().optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  }),
  execute: async (userId, input) => {
    const task = await createTask({ userId, title: input.title, description: input.description, projectId: input.projectId, priority: input.priority });
    return { output: { id: task.id }, summary: `Created task "${task.title}".` };
  },
});

register({
  name: "project.create",
  description: "Create a new project.",
  category: "project",
  capability: "project.write",
  requiredLevel: "RECOMMEND",
  inputSchema: z.object({ name: z.string().min(1).max(200), description: z.string().max(5000).optional() }),
  execute: async (userId, input) => {
    const project = await createProject({ userId, name: input.name, description: input.description });
    return { output: { id: project.id }, summary: `Created project "${project.name}".` };
  },
});

register({
  name: "idea.create",
  description: "Capture an idea, optionally attached to a project.",
  category: "project",
  capability: "project.write",
  requiredLevel: "RECOMMEND",
  inputSchema: z.object({ title: z.string().min(1).max(200), description: z.string().max(5000).optional(), projectId: z.string().optional() }),
  execute: async (userId, input) => {
    const idea = await createIdea({ userId, title: input.title, description: input.description, projectId: input.projectId });
    return { output: { id: idea.id }, summary: `Captured idea "${idea.title}".` };
  },
});

register({
  name: "decision.create",
  description: "Record a decision and the reasoning behind it, optionally attached to a project.",
  category: "project",
  capability: "project.write",
  requiredLevel: "RECOMMEND",
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    chosenOption: z.string().max(500).optional(),
    projectId: z.string().optional(),
  }),
  execute: async (userId, input) => {
    const decision = await createDecision({ userId, title: input.title, description: input.description, chosenOption: input.chosenOption, projectId: input.projectId, status: input.chosenOption ? "DECIDED" : "PENDING" });
    return { output: { id: decision.id }, summary: `Recorded decision "${decision.title}".` };
  },
});

register({
  name: "research.run",
  description: "Run a web research query and return grounded results with sources.",
  category: "research",
  capability: "research.web",
  requiredLevel: "ANALYZE",
  inputSchema: z.object({ query: z.string().min(1).max(500) }),
  execute: async (userId, input, context) => {
    // A supervised run researching in pursuit of an objective keeps that
    // objective on the findings, so the next planning pass for the same goal
    // retrieves them as its own evidence rather than as recent noise.
    const items = await runResearch(userId, input.query, { objectiveId: context?.objectiveId });
    return {
      output: items.map((i) => ({ title: i.title, sourceUrl: i.sourceUrl, summary: i.summary })),
      summary: `Found ${items.length} research ${items.length === 1 ? "result" : "results"} for "${input.query}".`,
    };
  },
});

register({
  name: "connection.suggest",
  description: "Suggest connecting an external service to VOX (never connects it directly — always requires the user's explicit approval).",
  category: "connection",
  capability: "connection.suggest",
  requiredLevel: "RECOMMEND",
  inputSchema: z.object({
    service: z.enum(["GOOGLE_CALENDAR", "GOOGLE_GMAIL", "NOTION", "TODOIST", "CRAFT", "QUICKBOOKS", "PLAID", "APPLE_HEALTH", "GOOGLE_FIT", "GOOGLE_MAPS", "AMAZON_ORDERS", "ETSY", "PRINTFUL", "PRINTIFY"]),
    reason: z.string().max(2000).optional(),
  }),
  execute: async (userId, input) => {
    const connection = await proposeConnection(userId, input.service, input.reason);
    return { output: { service: input.service, status: connection.status }, summary: `Suggested connecting ${connection.displayName} in the Connections Hub.` };
  },
});

register({
  name: "lab.create_requirement",
  description: "Record an engineering requirement in the Spider-Man Laboratory, optionally attached to a suit.",
  category: "project",
  capability: "lab.write",
  requiredLevel: "RECOMMEND",
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    suitId: z.string().optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  }),
  execute: async (userId, input) => {
    const code = await nextRequirementCode(userId);
    const requirement = await createRequirement({
      userId,
      suitId: input.suitId,
      code,
      title: input.title,
      description: input.description,
      priority: input.priority,
    });
    return { output: { id: requirement.id, code: requirement.code }, summary: `Recorded requirement ${requirement.code}: "${requirement.title}".` };
  },
});

register({
  name: "lab.create_question",
  description: "Record an open engineering question in the Spider-Man Laboratory, optionally attached to a suit.",
  category: "project",
  capability: "lab.write",
  requiredLevel: "RECOMMEND",
  inputSchema: z.object({
    question: z.string().min(1).max(2000),
    suitId: z.string().optional(),
    importance: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
    currentHypothesis: z.string().max(2000).optional(),
  }),
  execute: async (userId, input) => {
    const question = await createQuestion({
      userId,
      suitId: input.suitId,
      question: input.question,
      importance: input.importance,
      currentHypothesis: input.currentHypothesis,
    });
    return { output: { id: question.id }, summary: `Recorded engineering question: "${question.question.slice(0, 80)}${question.question.length > 80 ? "..." : ""}"` };
  },
});

register({
  name: "economic.record_expense",
  description:
    "Record a real spend against an opportunity's economic ledger. Gated by the economic.spend capability at ACT level AND the user's own autonomous-spend ceiling — a granted capability alone is never sufficient to spend.",
  category: "external",
  capability: "economic.spend",
  requiredLevel: "ACT",
  isExternal: false,
  inputSchema: z.object({
    opportunityId: z.string().min(1),
    amountUsd: z.number().min(0.01).max(1_000_000),
    category: z.string().max(80).optional(),
    notes: z.string().max(2000).optional(),
  }),
  execute: async (userId, input) => {
    // Second, independent gate: even with economic.spend granted at ACT,
    // an amount above the user's configured autonomous ceiling is refused
    // here rather than executed — see src/lib/economic/policy.ts.
    const decision = await evaluateSpendPolicy(userId, input.amountUsd);
    if (!decision.allowed) {
      throw new Error(decision.reason);
    }
    const expense = await recordOpportunitySpend(userId, {
      opportunityId: input.opportunityId,
      amountUsd: input.amountUsd,
      category: input.category,
      notes: input.notes,
    });
    return {
      output: { id: expense.id, amountUsd: expense.amountUsd },
      summary: `Recorded a $${expense.amountUsd.toFixed(2)} expense (within the $${decision.thresholdUsd.toFixed(2)} autonomous limit).`,
    };
  },
});

// --- External tools: real architecture, stubbed execution until real vendor
// credentials exist (see src/lib/integrations/stub.ts). Never fake a result.

function requireConfiguredCalendar() {
  const entry = getCatalogEntry("GOOGLE_CALENDAR");
  const provider = getConnectionProvider("GOOGLE_CALENDAR");
  if (!provider.isConfigured) {
    throw new Error(
      `${entry?.displayName ?? "Google Calendar"} is not connected yet. Approve it in the Connections Hub and grant read/write access once real credentials are configured.`
    );
  }
  return provider;
}

register({
  name: "calendar.list_events",
  description: "List upcoming events from the user's connected Google Calendar.",
  category: "external",
  capability: "integration.google_calendar.read",
  requiredLevel: "RECOMMEND",
  isExternal: true,
  inputSchema: z.object({ rangeDays: z.number().int().min(1).max(30).optional() }),
  execute: async (_userId, _input) => {
    requireConfiguredCalendar();
    // Unreachable until a real Google OAuth client exists — the provider
    // guarantees isConfigured stays false until then (see stub.ts).
    throw new Error("Google Calendar integration is not implemented yet — no real OAuth client is registered.");
  },
});

register({
  name: "calendar.create_event",
  description: "Create an event on the user's connected Google Calendar.",
  category: "external",
  capability: "integration.google_calendar.write",
  requiredLevel: "ACT",
  isExternal: true,
  inputSchema: z.object({ title: z.string().min(1).max(200), startsAt: z.string(), endsAt: z.string() }),
  execute: async (_userId, _input) => {
    requireConfiguredCalendar();
    throw new Error("Google Calendar integration is not implemented yet — no real OAuth client is registered.");
  },
});

export function getTool(name: string): ToolDefinition<never> | undefined {
  return REGISTRY[name];
}

export function listTools(): ToolDefinition<never>[] {
  return Object.values(REGISTRY);
}
