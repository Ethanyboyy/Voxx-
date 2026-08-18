"use client";

import { StateIndicator } from "@/components/ui/StateIndicator";
import type { BrainState } from "@/lib/brain/graph";

const STATE_COLOR: Record<BrainState, string> = {
  idle: "var(--muted-foreground)",
  thinking: "var(--core-thinking)",
  researching: "var(--core-executing)",
  executing: "var(--core-executing)",
  waiting: "var(--warning)",
  learning: "var(--core-listening)",
  error: "var(--danger)",
};

const STATE_LABEL: Record<BrainState, string> = {
  idle: "Idle",
  thinking: "Thinking",
  researching: "Researching",
  executing: "Executing",
  waiting: "Waiting for you",
  learning: "Learning",
  error: "Error",
};

export function BrainStateBadge({ state, detail }: { state: BrainState; detail: string | null }) {
  return (
    <StateIndicator color={STATE_COLOR[state]} label={STATE_LABEL[state]} detail={detail} pulse={state !== "idle"} />
  );
}
