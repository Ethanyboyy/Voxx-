// VOX Orchestrator — a cross-domain snapshot, not a routing layer. See
// VOX_2.0_ARCHITECTURE.md's "Orchestrator" section for why this is scoped
// narrower than the original "route everything through one context
// resolver" plan: chat's memory-retrieval context assembly and the Lab AI
// Engineer's regex-intent-routed structured grounding are genuinely
// different shapes of work, not the same pattern in two places. What both
// (and future callers — Field Mode, an Economic advisor) genuinely need in
// common is a compact "what's happening across VOX right now" picture,
// which is what this module provides.
import { getBrainState, type BrainState } from "@/lib/brain/graph";
import { listProposals } from "@/lib/cognition/proposals";
import { getLabDashboard } from "@/lib/lab/dashboard";
import { getActiveObjective, getNextBestAction } from "@/lib/objectives/service";

export interface CrossDomainSnapshot {
  brainState: { state: BrainState; detail: string | null };
  pendingProposalCount: number;
  lab: {
    suits: number;
    experiments: number;
    activeExperiments: number;
    mostRecentSuitCodename: string | null;
  };
  activeObjective: { title: string; nextAction: string | null } | null;
}

/** One call, real data from four subsystems that otherwise have zero
 * visibility into each other. Every field traces to an existing service
 * function — nothing here is computed or guessed. */
export async function getCrossDomainSnapshot(userId: string): Promise<CrossDomainSnapshot> {
  const [brain, proposals, labDashboard, activeObjective, nextBestAction] = await Promise.all([
    getBrainState(userId),
    listProposals(userId, "PROPOSED"),
    getLabDashboard(userId),
    getActiveObjective(userId),
    getNextBestAction(userId),
  ]);

  return {
    brainState: brain,
    pendingProposalCount: proposals.length,
    lab: {
      suits: labDashboard.counts.suits,
      experiments: labDashboard.counts.experiments,
      activeExperiments: labDashboard.counts.activeExperiments,
      mostRecentSuitCodename: labDashboard.recentSuits[0]?.codename ?? null,
    },
    activeObjective: activeObjective ? { title: activeObjective.title, nextAction: nextBestAction?.action ?? null } : null,
  };
}

/** Renders a snapshot into a short, prompt-injectable line — empty string
 * when there's genuinely nothing worth surfacing, so callers don't have to
 * special-case "no signal" themselves. */
export function summarizeCrossDomainSnapshot(snapshot: CrossDomainSnapshot): string {
  const parts: string[] = [];
  if (snapshot.pendingProposalCount > 0) {
    parts.push(`${snapshot.pendingProposalCount} proposal(s) awaiting the user's approval`);
  }
  if (snapshot.lab.activeExperiments > 0) {
    parts.push(`${snapshot.lab.activeExperiments} Lab experiment(s) currently running`);
  }
  if (snapshot.brainState.state === "error") {
    parts.push(`an agent run failed${snapshot.brainState.detail ? `: ${snapshot.brainState.detail}` : ""}`);
  }
  if (parts.length === 0) return "";
  return `\n\nSystem snapshot (do not restate this unprompted, only use it if relevant): ${parts.join("; ")}.`;
}
