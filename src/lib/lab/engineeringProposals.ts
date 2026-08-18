// Structured engineering proposals — the Lab's link into the existing
// Proposal engine (src/lib/cognition/proposals.ts). Nothing new here executes
// anything: this only ever calls createProposal(), which starts PROPOSED.
// The only path to a real LabExperiment row is approveProposal(), which
// enforces the real capability gate and then runs the
// "lab.create_experiment" handler registered in proposals.ts.
import { createProposal } from "@/lib/cognition/proposals";
import { nextExperimentCode } from "@/lib/lab/experiments";
import type { LabConfidence } from "@/generated/prisma/enums";

// LabConfidence (VERIFIED/ESTIMATED/HYPOTHETICAL/UNKNOWN) is the vocabulary
// already used everywhere else in the Lab domain (LabMaterial,
// LabExperimentResult, LabComponent, etc.) — reused here rather than
// introducing a second, parallel confidence taxonomy for this one feature.
const LAB_TO_PROPOSAL_CONFIDENCE: Record<LabConfidence, "LOW" | "MEDIUM" | "HIGH" | "CONFIRMED"> = {
  VERIFIED: "HIGH",
  ESTIMATED: "MEDIUM",
  HYPOTHETICAL: "LOW",
  UNKNOWN: "LOW",
};

export interface ProposeExperimentInput {
  userId: string;
  /** What isn't working / the gap this experiment targets — the "why now". */
  bottleneck: string;
  /** What the experiment is meant to establish or move forward. */
  objective: string;
  /** The concrete experimental approach — becomes the LabExperiment's expectedOutcome. */
  approach: string;
  title: string;
  hypothesis: string;
  risk?: string;
  costEstimateUsd?: number;
  suitId?: string;
  componentId?: string;
  /** What real data grounds this proposal — a component's recorded stats, a
   * research item, prior experiment results. Never fabricated; the caller
   * supplies a short reference to what it actually read. */
  evidenceNote?: string;
  confidence?: LabConfidence;
  evidence?: { researchItemIds?: string[]; memoryIds?: string[] };
}

/**
 * Creates a real Proposal carrying a structured engineering-reasoning
 * narrative (bottleneck → objective → approach → risk/cost) plus a
 * "lab.create_experiment" action payload. Approving it (capability
 * "lab.experiment.write" at RECOMMEND) creates the actual LabExperiment row —
 * this function itself creates nothing beyond the Proposal.
 */
export async function proposeExperiment(input: ProposeExperimentInput) {
  const confidence = input.confidence ?? "HYPOTHETICAL";
  const code = await nextExperimentCode(input.userId);

  const costLine = input.costEstimateUsd != null ? ` Estimated cost: $${input.costEstimateUsd.toLocaleString()}.` : "";
  const riskLine = input.risk ? ` Risk: ${input.risk}.` : "";

  return createProposal({
    userId: input.userId,
    observation: input.bottleneck,
    connection: input.evidenceNote,
    implication: input.objective,
    suggestedAction: `Run experiment "${input.title}": ${input.approach}${riskLine}${costLine}`,
    actionType: "lab.create_experiment",
    actionPayload: {
      code,
      title: input.title,
      hypothesis: input.hypothesis,
      objective: input.objective,
      expectedOutcome: input.approach,
      suitId: input.suitId,
      componentId: input.componentId,
      confidence,
    },
    capability: "lab.experiment.write",
    requiredLevel: "RECOMMEND",
    confidence: LAB_TO_PROPOSAL_CONFIDENCE[confidence],
    evidence: input.evidence,
  });
}
