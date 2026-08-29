import { z } from "zod";
import { getAIProvider } from "@/lib/ai";
import { modelForJob } from "@/lib/ai/routing";
import type { AgentRun, AgentStep, Objective } from "@/generated/prisma/client";
import type { Confidence, VerificationStatus } from "@/generated/prisma/enums";

/**
 * Did the OBJECTIVE actually succeed?
 *
 * The supervisor already knows whether execution completed — every tool
 * returned without throwing. That is a much weaker claim than "the thing the
 * user wanted has happened", and conflating the two is how a system starts
 * reporting successes it cannot substantiate.
 *
 * This module answers the stronger question, and is built so that the
 * failure mode is always honesty rather than optimism:
 *
 * - No success criteria defined  -> UNVERIFIED (nothing to check against)
 * - Execution failed             -> FAILED (no evidence of success exists)
 * - Evidence insufficient        -> UNVERIFIED
 * - Model unavailable/unparseable-> UNVERIFIED
 *
 * ACHIEVED is only ever returned when every criterion was positively
 * demonstrated against real recorded evidence. There is no code path that
 * derives ACHIEVED from execution merely finishing.
 */

/** One success criterion, judged on its own. */
export interface CriterionAssessment {
  criterion: string;
  /** true = demonstrated, false = demonstrably not met, null = undeterminable
   * from the available evidence. null is a first-class answer, not a bug. */
  met: boolean | null;
  /** Why — must refer to the evidence, and says so plainly when there is none. */
  reasoning: string;
}

export interface EvidenceItem {
  /** Where this came from, e.g. "step:memory.create" or "objective.targetValue". */
  type: string;
  text: string;
}

export interface VerificationResult {
  status: VerificationStatus;
  assessments: CriterionAssessment[];
  evidence: EvidenceItem[];
  /** One-line human summary, safe to store on the Outcome. */
  summary: string;
  confidence: Confidence;
}

const assessmentResponseSchema = z.object({
  assessments: z.array(
    z.object({
      criterion: z.string(),
      // The model must be able to say "I can't tell" — that is what keeps
      // UNVERIFIED reachable instead of forcing a true/false guess.
      met: z.union([z.boolean(), z.null()]),
      reasoning: z.string().max(1000),
    })
  ),
});

export function parseSuccessCriteria(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((c): c is string => typeof c === "string" && c.trim().length > 0);
  } catch {
    return [];
  }
}

/**
 * Real, recorded facts about what the run did — the only material any
 * judgement is allowed to rest on. Nothing here is inferred: every item is
 * read back from persisted step rows or the objective's own numbers.
 */
export function collectEvidence(objective: Objective, agentRun: AgentRun & { steps: AgentStep[] }): EvidenceItem[] {
  const evidence: EvidenceItem[] = [];

  for (const step of agentRun.steps) {
    if (step.status === "COMPLETED" && step.toolName) {
      evidence.push({
        type: `step:${step.toolName}`,
        text: `Step ${step.order} ("${step.description}") ran ${step.toolName} and returned: ${step.output ?? "no output"}`,
      });
    } else if (step.status === "FAILED") {
      evidence.push({
        type: `step-failed:${step.toolName ?? "none"}`,
        text: `Step ${step.order} ("${step.description}") FAILED: ${step.error ?? "no error recorded"}`,
      });
    }
  }

  // A numeric target is the one thing that can be checked without judgement —
  // but only when a real currentValue exists. currentValue is never inferred
  // (see Objective.currentValue in schema.prisma), so a null here genuinely
  // means "nobody has reported progress", not "no progress".
  if (objective.targetValue != null) {
    evidence.push({
      type: "objective.target",
      text:
        objective.currentValue != null
          ? `Target is ${objective.targetValue}${objective.targetUnit ? ` ${objective.targetUnit}` : ""}; last reported actual is ${objective.currentValue}.`
          : `Target is ${objective.targetValue}${objective.targetUnit ? ` ${objective.targetUnit}` : ""}, but no actual value has been reported.`,
    });
  }

  return evidence;
}

/**
 * Aggregates per-criterion judgements into one status. Deliberately
 * conservative: a single undeterminable criterion is enough to prevent
 * ACHIEVED, and "nothing was met but some criteria could not be checked"
 * reports UNVERIFIED rather than FAILED — claiming failure would assert
 * knowledge the evidence does not support either.
 */
export function aggregateStatus(assessments: CriterionAssessment[]): VerificationStatus {
  if (assessments.length === 0) return "UNVERIFIED";

  const met = assessments.filter((a) => a.met === true).length;
  const undetermined = assessments.filter((a) => a.met === null).length;

  if (met === assessments.length) return "ACHIEVED";
  if (met > 0) return "PARTIALLY_ACHIEVED";
  if (undetermined > 0) return "UNVERIFIED";
  return "FAILED";
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("No JSON object in verifier output.");
  return JSON.parse(candidate.slice(start, end + 1));
}

function unverified(criteria: string[], evidence: EvidenceItem[], reason: string): VerificationResult {
  return {
    status: "UNVERIFIED",
    assessments: criteria.map((criterion) => ({ criterion, met: null, reasoning: reason })),
    evidence,
    summary: `Could not verify whether the objective was achieved: ${reason}`,
    confidence: "LOW",
  };
}

/**
 * Verifies an objective against its own success criteria using only the
 * evidence its run actually produced.
 *
 * The model is used strictly as a judge over supplied evidence — it is given
 * no tools, cannot fetch anything, and is instructed that inability to tell
 * is a valid answer. Anything that goes wrong with it (unavailable, mock
 * provider, malformed output) resolves to UNVERIFIED, never to a guess.
 */
export async function verifyObjective(
  objective: Objective,
  agentRun: AgentRun & { steps: AgentStep[] }
): Promise<VerificationResult> {
  const criteria = parseSuccessCriteria(objective.successCriteria);
  const evidence = collectEvidence(objective, agentRun);

  if (criteria.length === 0) {
    return {
      status: "UNVERIFIED",
      assessments: [],
      evidence,
      summary:
        "No success criteria were defined for this objective, so whether it was achieved cannot be checked. Execution status is recorded separately.",
      confidence: "LOW",
    };
  }

  // A failed run cannot have achieved anything; say so from the real record
  // rather than spending a model call to reach the same conclusion.
  if (agentRun.status === "FAILED") {
    return {
      status: "FAILED",
      assessments: criteria.map((criterion) => ({
        criterion,
        met: false,
        reasoning: `The run failed before this could be satisfied: ${agentRun.error ?? "no error recorded"}`,
      })),
      evidence,
      summary: `The objective was not achieved — execution failed: ${agentRun.error ?? "no error recorded"}`,
      confidence: "HIGH",
    };
  }

  if (evidence.length === 0) {
    return unverified(criteria, evidence, "the run produced no recorded evidence to judge against");
  }

  const system = `You are VOX's verification engine. Decide, for EACH success criterion, whether the evidence below PROVES it was met.

Rules you must follow:
- Judge ONLY from the evidence provided. You have no other knowledge of this system and no ability to look anything up.
- Use met: true only when the evidence positively demonstrates the criterion was satisfied.
- Use met: false only when the evidence positively shows it was NOT satisfied.
- Use met: null when the evidence is silent, ambiguous, or insufficient. This is expected and correct — do not guess.
- A tool running successfully is NOT proof that a real-world outcome occurred. Creating a record about doing something is not the same as having done it.

Respond with ONLY a JSON object, no prose, no markdown fences:
{"assessments": [{"criterion": "<copied exactly>", "met": true | false | null, "reasoning": "<one or two sentences citing the evidence>"}]}`;

  const user = `Success criteria:
${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}

Evidence recorded during execution:
${evidence.map((e) => `- [${e.type}] ${e.text}`).join("\n")}`;

  let raw: string;
  try {
    const result = await getAIProvider().generate({
      model: modelForJob("REASONING"),
      system,
      messages: [{ role: "user", content: user }],
      maxTokens: 1500,
    });
    raw = result.content;
  } catch {
    return unverified(criteria, evidence, "the verification model was unavailable");
  }

  let assessments: CriterionAssessment[];
  try {
    const parsed = assessmentResponseSchema.parse(extractJson(raw));
    // Judge only the criteria we asked about — a model echoing back something
    // else must not silently become the verdict.
    const byCriterion = new Map(parsed.assessments.map((a) => [a.criterion.trim(), a]));
    assessments = criteria.map((criterion) => {
      const match = byCriterion.get(criterion.trim());
      if (!match) return { criterion, met: null, reasoning: "The verifier did not return a judgement for this criterion." };
      return { criterion, met: match.met, reasoning: match.reasoning };
    });
  } catch {
    // Includes the mock provider, which returns prose rather than JSON.
    return unverified(criteria, evidence, "the verification model did not return a usable judgement");
  }

  const status = aggregateStatus(assessments);
  const metCount = assessments.filter((a) => a.met === true).length;

  return {
    status,
    assessments,
    evidence,
    summary: summarize(status, metCount, criteria.length),
    // A judgement over real evidence, but still a judgement — never CONFIRMED,
    // which is reserved for facts VOX can demonstrate outright.
    confidence: status === "UNVERIFIED" ? "LOW" : "MEDIUM",
  };
}

function summarize(status: VerificationStatus, met: number, total: number): string {
  switch (status) {
    case "ACHIEVED":
      return `Objective achieved — all ${total} success criteria were demonstrated by the recorded evidence.`;
    case "PARTIALLY_ACHIEVED":
      return `Objective partially achieved — ${met} of ${total} success criteria were demonstrated by the recorded evidence.`;
    case "FAILED":
      return `Objective not achieved — none of the ${total} success criteria were met.`;
    case "UNVERIFIED":
      return `Objective could not be verified — the evidence was insufficient to judge ${total === 1 ? "the criterion" : "the criteria"}.`;
  }
}
