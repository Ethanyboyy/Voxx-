import { z } from "zod";
import { getAIProvider } from "@/lib/ai";
import { modelForJob } from "@/lib/ai/routing";
import { renderPlanningContext, type PlanningContext } from "@/lib/agents/context";
import { listTools } from "@/lib/tools/registry";

const planStepSchema = z.object({
  description: z.string().min(1).max(500),
  toolName: z.string().nullable().optional(),
  input: z.record(z.string(), z.unknown()).optional(),
});

const planSchema = z.object({
  steps: z.array(planStepSchema).min(1).max(10),
});

export type PlanStep = z.infer<typeof planStepSchema>;

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("No JSON object found in planner output.");
  return JSON.parse(candidate.slice(start, end + 1));
}

/** Single no-tool step that just asks VOX to respond directly — the honest fallback when planning can't produce a real tool plan (e.g. the mock provider, or malformed output). */
function fallbackPlan(objective: string): PlanStep[] {
  return [{ description: objective, toolName: null }];
}

/**
 * Turns a free-text objective into an ordered list of steps, each optionally
 * bound to a tool from the registry. Uses the REASONING model job (§38) —
 * this is the one place in VOX that spends a model call purely on planning,
 * so it's worth the stronger model when one is configured.
 *
 * `context` carries what VOX actually knows and has already tried (see
 * buildPlanningContext). It is optional so that callers with no user scope
 * still work, but the supervised path always supplies it: planning without
 * it means re-deriving an approach that may have already been recorded as
 * failing.
 */
export async function planObjective(objective: string, context?: PlanningContext): Promise<PlanStep[]> {
  const tools = listTools();
  const toolCatalog = tools
    .map((t) => `- ${t.name} (${t.category}): ${t.description} — input: ${t.inputSchema.toString()}`)
    .join("\n");

  const contextSection = context ? renderPlanningContext(context) : "";

  const system = `You are VOX's planning engine. Break the user's objective into a short, ordered list of concrete steps.
Each step may optionally use exactly one tool from this list (use the exact tool name, or null for a step that's just reasoning/response, no tool call):
${toolCatalog}

Respond with ONLY a JSON object, no prose, no markdown fences, of the exact shape:
{"steps": [{"description": "...", "toolName": "memory.search" | null, "input": {...tool arguments matching that tool's schema, or omit if toolName is null}}]}
Keep it to the minimum steps that actually accomplish the objective — usually 1-5. Never invent a tool name that isn't in the list above.${contextSection}`;

  const provider = getAIProvider();
  let result;
  try {
    result = await provider.generate({
      model: modelForJob("REASONING"),
      system,
      messages: [{ role: "user", content: objective }],
      maxTokens: 1500,
    });
  } catch {
    return fallbackPlan(objective);
  }

  try {
    const parsed = planSchema.parse(extractJson(result.content));
    return parsed.steps;
  } catch {
    // Model didn't return valid structured output (or this is the mock
    // provider) — fall back honestly rather than guessing at a plan.
    return fallbackPlan(objective);
  }
}
