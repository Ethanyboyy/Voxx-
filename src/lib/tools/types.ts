import type { z } from "zod";
import type { CapabilityLevel } from "@/generated/prisma/enums";

/**
 * General tool interface for the agent engine (Phase 4) — the discoverable
 * counterpart to the Proposal engine's closed ACTION_HANDLERS registry
 * (src/lib/cognition/proposals.ts). Both are permission-gated the same way;
 * this one exists so a planner can enumerate "what can I use" instead of a
 * human hardcoding one actionType string per call site.
 */
export interface ToolResult {
  /** Machine-readable result, stored as AgentStep.output (JSON). */
  output: unknown;
  /** Human-readable one-line summary, shown in the UI and fed back to the planner. */
  summary: string;
}

/**
 * Where an execution came from — what the run was actually FOR. Threaded by
 * the executor into every tool call so work a supervised run performs in
 * pursuit of an objective retains that objective, exactly as work a human
 * scopes by hand does. Without this, agent-run research produced evidence
 * that fell back to "merely recent" instead of "gathered for this goal",
 * while the identical query through the API kept its origin.
 *
 * Optional and additive: tools that don't care ignore it, and direct callers
 * (tests, future non-agent invokers) may omit it entirely.
 */
export interface ToolExecutionContext {
  /** The Objective behind the SupervisorRun that spawned this AgentRun, when there is one. */
  objectiveId?: string;
}

export interface ToolDefinition<TInput = unknown> {
  /** Stable key, e.g. "memory.search" — referenced by AgentStep.toolName. */
  name: string;
  description: string;
  category: "memory" | "project" | "knowledge" | "research" | "connection" | "external" | "workspace";
  /** Permission capability key checked before execution — never bypassed. */
  capability: string;
  requiredLevel: CapabilityLevel;
  inputSchema: z.ZodType<TInput>;
  /** True for tools that reach an external service — governs how the planner should treat failures (see stub tools). */
  isExternal?: boolean;
  execute: (userId: string, input: TInput, context?: ToolExecutionContext) => Promise<ToolResult>;
}

export type AnyToolDefinition = ToolDefinition<never>;
