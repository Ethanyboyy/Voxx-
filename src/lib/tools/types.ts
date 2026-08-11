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

export interface ToolDefinition<TInput = unknown> {
  /** Stable key, e.g. "memory.search" — referenced by AgentStep.toolName. */
  name: string;
  description: string;
  category: "memory" | "project" | "knowledge" | "research" | "connection" | "external";
  /** Permission capability key checked before execution — never bypassed. */
  capability: string;
  requiredLevel: CapabilityLevel;
  inputSchema: z.ZodType<TInput>;
  /** True for tools that reach an external service — governs how the planner should treat failures (see stub tools). */
  isExternal?: boolean;
  execute: (userId: string, input: TInput) => Promise<ToolResult>;
}

export type AnyToolDefinition = ToolDefinition<never>;
