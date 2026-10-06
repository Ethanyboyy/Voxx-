/**
 * [P6-C] DISCOVERY, UNDER THE P6-B PROVENANCE BOUNDARY.
 *
 * VOX proposes opportunities it was not given. That is the point of the phase,
 * and it is also the exact capability P6-A and P6-B were built to make safe:
 * before per-figure provenance existed, a discovery pass that wrote its numbers
 * into `Opportunity`'s own columns would have had them read as `STATED` — the
 * capital minimum — because the compatibility heuristic reads a row's discovery
 * source and a row with no source reads as human.
 *
 * ---------------------------------------------------------------------------
 * THE THREE THINGS THIS MODULE REFUSES TO DO
 * ---------------------------------------------------------------------------
 *
 * IT NEVER WRITES AN ECONOMIC COLUMN. `assertNoLegacyEconomicColumns()` runs
 *   over the `Opportunity` create input before it reaches the database, against
 *   `LEGACY_ECONOMIC_COLUMNS` — derived from the figure registry, so a column
 *   the compatibility path reads cannot be missing from the list. Every number
 *   goes through `recordEstimate()`, one figure at a time.
 *
 * IT NEVER CLAIMS A HUMAN SOURCE. `DISCOVERY_SOURCE` is asserted against
 *   `isHumanSource()` — the single definition in `opportunityModel.ts`, not a
 *   copy — at module load. A copied list drifts, and the drift would be silent.
 *
 * IT NEVER INVENTS A CANDIDATE. A provider that cannot return structured output
 *   produces `PROVIDER_NOT_STRUCTURED` and zero candidates. The mock provider
 *   is that case, which means discovery produces nothing in this repository and
 *   in any deployment without a key — and the run row says so, rather than the
 *   surface showing an empty list as a considered judgement about the market.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CAPABILITY CHECK IS IN BOTH EXPORTS
 * ---------------------------------------------------------------------------
 *
 * `runDiscovery()` is the whole pass. `recordCandidates()` is its persistence
 * half, exported because a person reviewing a proposal and a future provider
 * that returns proposals some other way both need the same door. Both call the
 * SAME `enforceCapability()` at the SAME level, so the second export is a second
 * caller of one gate rather than a way around it.
 */

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { getAIProvider } from "@/lib/ai";
import { enforceCapability } from "@/lib/permissions/service";
import { recordEvent } from "@/lib/observability/events";
import { LEGACY_ECONOMIC_COLUMNS, FIGURE_SPECS } from "@/lib/economic/figures";
import { isHumanSource } from "@/lib/economic/opportunityModel";
import { recordEstimate } from "@/lib/economic/provenance";
import {
  MAX_CANDIDATES_PER_RUN,
  proposalDigest,
  proposalSchema,
  validateCandidate,
  type CandidateRejection,
} from "@/lib/discovery/contract";
import type { CapabilityLevel, DiscoveryRefusal } from "@/generated/prisma/enums";
import type { DiscoveryCandidate, DiscoveryRun } from "@/generated/prisma/client";

/**
 * The `Opportunity.source` every discovered row carries.
 *
 * Namespaced so it is obviously machine-generated at a glance in the database,
 * and asserted below against the human-source list.
 */
export const DISCOVERY_SOURCE = "vox.discovery";

export const DISCOVERY_CAPABILITY = "economic.discover";

/**
 * `RECOMMEND`, matching `research.run`.
 *
 * The same reasoning applies: the pass spends a model call and writes rows that
 * the economic layer then reads and ranks. CLAUDE.md rule 4 puts the
 * consequential threshold at RECOMMEND, and `DEFAULT_GRANTED_LEVEL` is below
 * it, so discovery is off until somebody grants it.
 */
export const DISCOVERY_LEVEL: CapabilityLevel = "RECOMMEND";

/**
 * Checked once, at module load, against the real predicate.
 *
 * If somebody renames `DISCOVERY_SOURCE` to something that reads as human, the
 * application fails to start rather than quietly promoting every figure on
 * every discovered row to a capital-eligible basis.
 */
if (isHumanSource(DISCOVERY_SOURCE)) {
  throw new Error(
    `DISCOVERY_SOURCE ("${DISCOVERY_SOURCE}") reads as a human source. Every legacy-read figure on a discovered opportunity would be STATED, which is capital-eligible.`
  );
}

/**
 * Throws if an `Opportunity` write carries any column the compatibility path
 * reads.
 *
 * A RUNTIME ASSERTION RATHER THAN A CONVENTION, because the failure it prevents
 * is invisible: the row would look ordinary, the numbers would look recorded,
 * and the only symptom would be a model's invention clearing the capital gate.
 */
export function assertNoLegacyEconomicColumns(data: Record<string, unknown>): void {
  const present = LEGACY_ECONOMIC_COLUMNS.filter((column) => data[column] !== undefined);
  if (present.length > 0) {
    throw new Error(
      `Discovery may not write economic columns on Opportunity (${present.join(", ")}). ` +
        `Those columns route through legacyColumnBasis(), which can read an uncorroborated number as STATED — a capital-eligible basis. Use recordEstimate() per figure instead.`
    );
  }
}

// ---------------------------------------------------------------------------
// Proposing
// ---------------------------------------------------------------------------

/**
 * What the model is told.
 *
 * It says plainly that the pass cannot assert evidence, because a model that
 * believes it is supposed to produce confident citations will produce them, and
 * every one of those proposals is then rejected with `CLAIMS_EVIDENCE_OR_BASIS`
 * — a correct outcome and a wasted pass.
 */
export const DISCOVERY_SYSTEM_PROMPT = `You propose candidate income opportunities for evaluation.

Return ONLY a JSON object of this exact shape:

{"candidates":[{"title":"...","thesis":"...","category":"...","rationale":"...","uncertainty":"...","figures":[{"figure":"EXPECTED_PROFIT_CENTS","value":50000,"reasoning":"..."}]}]}

Rules you must follow:
- "figure" must be one of: ${Object.keys(FIGURE_SPECS).join(", ")}.
- Money figures are INTEGER CENTS. Ratio figures (PROBABILITY_OF_SUCCESS, MARGIN_FRACTION) are decimals between 0 and 1. TIME_TO_PAYOUT_DAYS is a whole number of days, at least 1.
- "reasoning" explains how you arrived at the number.
- Do NOT include a basis, a confidence, a source, a date, or any evidence identifier. You are proposing hypotheses, and they will be recorded as hypotheses. Any proposal that claims evidence is discarded.
- Say what you do not know in "uncertainty". A candidate that names its own gaps is more useful than one that sounds certain.
- Propose at most ${MAX_CANDIDATES_PER_RUN}. Propose none rather than padding the list.`;

/** Mirrors `agents/planner.ts#extractJson` — one convention for model JSON. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("No JSON object in discovery output.");
  return JSON.parse(candidate.slice(start, end + 1));
}

export type ProposalOutcome =
  | { proposed: true; raw: unknown[]; provider: string; model: string }
  | { proposed: false; reason: DiscoveryRefusal; detail: string; provider: string; model: string };

/**
 * Asks the model for candidates.
 *
 * Returns the RAW objects, unvalidated, so the validation refusals are recorded
 * per candidate rather than collapsing a partly-good answer into one failure.
 */
export async function proposeCandidates(brief: string, focus?: string): Promise<ProposalOutcome> {
  const provider = getAIProvider();
  const model = provider.defaultModel;

  const result = await provider.generate({
    system: DISCOVERY_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: focus ? `${brief}\n\nFocus on: ${focus}` : brief,
      },
    ],
    maxTokens: 4000,
    temperature: 1,
  });

  try {
    const parsed = proposalSchema.partial().safeParse(extractJson(result.content));
    if (!parsed.success || !parsed.data.candidates) throw new Error("not a candidate list");
    return { proposed: true, raw: parsed.data.candidates, provider: result.provider, model: result.model };
  } catch {
    // The honest distinction. The mock provider cannot return structured
    // output at all — reporting that as "the model gave a bad answer" would
    // suggest trying again, when what is actually true is that no model capable
    // of answering is configured.
    const isMock = provider.id === "mock";
    return {
      proposed: false,
      reason: isMock ? "PROVIDER_NOT_STRUCTURED" : "UNPARSEABLE_OUTPUT",
      detail: isMock
        ? "The active AI provider is the mock, which cannot return structured proposals. No candidates were invented to fill the gap."
        : "The model's answer was not a list of candidates. Nothing was recorded.",
      provider: provider.id,
      model,
    };
  }
}

// ---------------------------------------------------------------------------
// Persisting
// ---------------------------------------------------------------------------

export interface RecordCandidatesInput {
  userId: string;
  runId: string;
  /** Raw proposals, exactly as the model produced them. Validated here. */
  raw: readonly unknown[];
}

export interface CandidateOutcome {
  candidateId: string;
  status: "ACCEPTED" | "REJECTED";
  opportunityId: string | null;
  reason: CandidateRejection | null;
  detail: string | null;
  /** The figures actually recorded, all at MODEL_SUGGESTED. */
  figuresRecorded: number;
}

/**
 * Turns validated proposals into opportunities and MODEL_SUGGESTED estimates.
 *
 * Gated at the same capability and level as `runDiscovery()`.
 */
export async function recordCandidates(input: RecordCandidatesInput): Promise<CandidateOutcome[]> {
  await enforceCapability(input.userId, DISCOVERY_CAPABILITY, DISCOVERY_LEVEL);

  const run = await db.discoveryRun.findFirst({
    where: { id: input.runId, userId: input.userId },
  });
  if (!run) throw new Error("No such discovery run for this user.");

  const outcomes: CandidateOutcome[] = [];
  for (const raw of input.raw.slice(0, MAX_CANDIDATES_PER_RUN)) {
    outcomes.push(await recordOne(input.userId, run, raw));
  }

  const accepted = outcomes.filter((o) => o.status === "ACCEPTED").length;
  await db.discoveryRun.update({
    where: { id: run.id },
    data: {
      status: "COMPLETED",
      proposedCount: { increment: outcomes.length },
      acceptedCount: { increment: accepted },
      rejectedCount: { increment: outcomes.length - accepted },
      finishedAt: new Date(),
    },
  });

  return outcomes;
}

async function recordOne(
  userId: string,
  run: DiscoveryRun,
  raw: unknown
): Promise<CandidateOutcome> {
  const rawProposal = safeStringify(raw);

  const validation = validateCandidate(raw);
  if (!validation.valid) {
    const candidate = await createCandidateRow({
      userId,
      run,
      rawProposal,
      // A rejected proposal may be malformed enough to have no usable title, so
      // the row records what it can rather than refusing to record the rejection.
      title: readString(raw, "title") ?? "(untitled proposal)",
      thesis: readString(raw, "thesis") ?? "(no thesis)",
      category: readString(raw, "category"),
      rationale: readString(raw, "rationale"),
      uncertainty: readString(raw, "uncertainty"),
      digest: createHash("sha256").update(rawProposal).digest("hex"),
      status: "REJECTED",
      rejectionReason: `${validation.reason}: ${validation.detail}`,
      opportunityId: null,
    });
    return {
      candidateId: candidate.id,
      status: "REJECTED",
      opportunityId: null,
      reason: validation.reason,
      detail: validation.detail,
      figuresRecorded: 0,
    };
  }

  const proposal = validation.candidate;
  const digest = proposalDigest(proposal);

  // ---- REPEATED DISCOVERY DOES NOT ACCUMULATE -------------------------
  //
  // The same numbers under the same title, proposed again, is the same
  // hypothesis proposed again. Creating a second opportunity for it would give
  // the idea two sets of MODEL_SUGGESTED estimates, which reads as two
  // independent candidates agreeing — and model consensus is not evidence.
  const existing = await db.discoveryCandidate.findFirst({
    where: { userId, proposalDigest: digest, status: "ACCEPTED" },
    select: { id: true, opportunityId: true },
  });
  if (existing) {
    const candidate = await createCandidateRow({
      userId,
      run,
      rawProposal,
      title: proposal.title,
      thesis: proposal.thesis,
      category: proposal.category ?? null,
      rationale: proposal.rationale ?? null,
      uncertainty: proposal.uncertainty ?? null,
      digest,
      status: "REJECTED",
      rejectionReason: `DUPLICATE_OF_EXISTING: an identical proposal was already accepted as opportunity ${existing.opportunityId}. Proposing it again is not corroboration of it.`,
      opportunityId: null,
    });
    return {
      candidateId: candidate.id,
      status: "REJECTED",
      opportunityId: null,
      reason: "DUPLICATE_OF_EXISTING",
      detail: `Already accepted as opportunity ${existing.opportunityId}.`,
      figuresRecorded: 0,
    };
  }

  // ---- THE OPPORTUNITY, WITH NO ECONOMIC COLUMNS ----------------------
  const opportunityData = {
    userId,
    objectiveId: run.objectiveId,
    title: proposal.title,
    description: proposal.thesis,
    category: proposal.category ?? null,
    rationale: proposal.rationale ?? null,
    source: DISCOVERY_SOURCE,
    discoveredAt: new Date(),
    status: "IDEA" as const,
  };
  // The assertion runs on the real object that is about to be written, not on a
  // copy or a type — so adding a field to the literal above without thinking
  // fails loudly here.
  assertNoLegacyEconomicColumns(opportunityData);

  if (!run.objectiveId) {
    const candidate = await createCandidateRow({
      userId,
      run,
      rawProposal,
      title: proposal.title,
      thesis: proposal.thesis,
      category: proposal.category ?? null,
      rationale: proposal.rationale ?? null,
      uncertainty: proposal.uncertainty ?? null,
      digest,
      status: "REJECTED",
      rejectionReason: "NO_OBJECTIVE: the run has no objective, so there is nothing for this opportunity to serve.",
      opportunityId: null,
    });
    return {
      candidateId: candidate.id,
      status: "REJECTED",
      opportunityId: null,
      reason: "MALFORMED",
      detail: "The run has no objective to attach an opportunity to.",
      figuresRecorded: 0,
    };
  }

  const opportunity = await db.opportunity.create({
    data: { ...opportunityData, objectiveId: run.objectiveId },
  });

  // ---- THE FIGURES, ONE AT A TIME, THROUGH THE PROVENANCE LAYER --------
  let recorded = 0;
  const failures: string[] = [];
  for (const figure of proposal.figures) {
    const result = await recordEstimate({
      userId,
      opportunityId: opportunity.id,
      figure: figure.figure,
      value: figure.value,
      // HARDCODED. There is no basis on a `ProposedFigure` to read, which is
      // the structural half of this guarantee; this literal is the other half.
      basis: "MODEL_SUGGESTED",
      provenance: `${figure.reasoning.trim()} — proposed by discovery run ${run.id} (${run.provider}/${run.model}). A model's hypothesis, uncorroborated.`,
      // NOW, never backdated. An `establishedAt` in the past would read as a
      // figure established by something historical, which is exactly the
      // impression a model-proposed number must not give.
      establishedAt: new Date(),
      // NO EVIDENCE REFERENCES. A discovery pass has none: the model's own
      // output is not a research result, a measurement or a comparable, and
      // citing one that does not exist is refused by `recordEstimate()` anyway.
    });
    if (result.recorded) recorded += 1;
    else failures.push(`${figure.figure}: ${result.reason}`);
  }

  if (recorded === 0) {
    // Nothing was recorded, so the opportunity has no figures at all and would
    // sit in the list as an unrankable row nobody proposed. Deleting a row this
    // call created moments ago, before anything could reference it, is the
    // conservative choice; leaving it would be inventing a candidate.
    await db.opportunity.delete({ where: { id: opportunity.id } });
    const candidate = await createCandidateRow({
      userId,
      run,
      rawProposal,
      title: proposal.title,
      thesis: proposal.thesis,
      category: proposal.category ?? null,
      rationale: proposal.rationale ?? null,
      uncertainty: proposal.uncertainty ?? null,
      digest,
      status: "REJECTED",
      rejectionReason: `FIGURE_NOT_RECORDED: ${failures.join("; ")}`,
      opportunityId: null,
    });
    return {
      candidateId: candidate.id,
      status: "REJECTED",
      opportunityId: null,
      reason: "FIGURE_NOT_RECORDED",
      detail: failures.join("; "),
      figuresRecorded: 0,
    };
  }

  const candidate = await createCandidateRow({
    userId,
    run,
    rawProposal,
    title: proposal.title,
    thesis: proposal.thesis,
    category: proposal.category ?? null,
    rationale: proposal.rationale ?? null,
    uncertainty: proposal.uncertainty ?? null,
    digest,
    status: "ACCEPTED",
    // A partial record is reported rather than smoothed over: the opportunity
    // exists with fewer figures, which makes it LESS fundable, not more.
    rejectionReason: failures.length > 0 ? `PARTIAL: ${failures.join("; ")}` : null,
    opportunityId: opportunity.id,
  });

  await recordEvent({
    userId,
    type: "discovery.candidate.accepted",
    subjectType: "Opportunity",
    subjectId: opportunity.id,
    consequential: true,
    payload: {
      runId: run.id,
      candidateId: candidate.id,
      figuresRecorded: recorded,
      basis: "MODEL_SUGGESTED",
      source: DISCOVERY_SOURCE,
      note: "Every figure is a model's hypothesis. None can reserve capital until it is corroborated figure by figure.",
    },
  });

  return {
    candidateId: candidate.id,
    status: "ACCEPTED",
    opportunityId: opportunity.id,
    reason: null,
    detail: failures.length > 0 ? failures.join("; ") : null,
    figuresRecorded: recorded,
  };
}

async function createCandidateRow(input: {
  userId: string;
  run: DiscoveryRun;
  rawProposal: string;
  title: string;
  thesis: string;
  category: string | null;
  rationale: string | null;
  uncertainty: string | null;
  digest: string;
  status: "ACCEPTED" | "REJECTED";
  rejectionReason: string | null;
  opportunityId: string | null;
}): Promise<DiscoveryCandidate> {
  return db.discoveryCandidate.create({
    data: {
      userId: input.userId,
      runId: input.run.id,
      title: input.title.slice(0, 200),
      thesis: input.thesis.slice(0, 4000),
      category: input.category,
      rationale: input.rationale,
      uncertainty: input.uncertainty,
      status: input.status,
      rejectionReason: input.rejectionReason,
      proposalDigest: input.digest,
      rawProposal: input.rawProposal,
      opportunityId: input.opportunityId,
    },
  });
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "null";
  } catch {
    return "(unserializable proposal)";
  }
}

function readString(value: unknown, key: string): string | null {
  if (value === null || typeof value !== "object") return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

// ---------------------------------------------------------------------------
// The whole pass
// ---------------------------------------------------------------------------

export interface RunDiscoveryInput {
  userId: string;
  objectiveId: string;
  brief: string;
  focus?: string;
}

export interface DiscoveryResult {
  run: DiscoveryRun;
  outcomes: CandidateOutcome[];
  refused: boolean;
}

/**
 * One discovery pass, end to end.
 */
export async function runDiscovery(input: RunDiscoveryInput): Promise<DiscoveryResult> {
  await enforceCapability(input.userId, DISCOVERY_CAPABILITY, DISCOVERY_LEVEL);

  const objective = await db.objective.findFirst({
    where: { id: input.objectiveId, userId: input.userId },
    select: { id: true },
  });

  const provider = getAIProvider();
  let run = await db.discoveryRun.create({
    data: {
      userId: input.userId,
      objectiveId: objective?.id ?? null,
      brief: input.brief,
      focus: input.focus ?? null,
      provider: provider.id,
      model: provider.defaultModel,
      status: "RUNNING",
    },
  });

  if (!objective) {
    run = await finishRefused(run, "NO_OBJECTIVE", "No such objective for this user. Discovery serves a goal the user set; it does not invent its own.");
    return { run, outcomes: [], refused: true };
  }

  const proposal = await proposeCandidates(input.brief, input.focus);
  if (!proposal.proposed) {
    run = await finishRefused(run, proposal.reason, proposal.detail);
    await recordEvent({
      userId: input.userId,
      type: "discovery.run.refused",
      subjectType: "Objective",
      subjectId: objective.id,
      consequential: true,
      payload: { runId: run.id, reason: proposal.reason, detail: proposal.detail, provider: proposal.provider },
    });
    return { run, outcomes: [], refused: true };
  }

  // The provider and model the answer actually came from, which can differ from
  // the defaults recorded when the run opened.
  run = await db.discoveryRun.update({
    where: { id: run.id },
    data: { provider: proposal.provider, model: proposal.model },
  });

  const outcomes = await recordCandidates({ userId: input.userId, runId: run.id, raw: proposal.raw });

  if (outcomes.length > 0 && outcomes.every((o) => o.status === "REJECTED")) {
    run = await db.discoveryRun.update({
      where: { id: run.id },
      data: {
        // Still COMPLETED, not REFUSED: the pass ran and judged. The reason is
        // recorded alongside so the surface can say which it was.
        refusalReason: "ALL_CANDIDATES_INVALID",
        refusalDetail: outcomes.map((o) => `${o.reason}: ${o.detail ?? ""}`).join(" | ").slice(0, 2000),
      },
    });
  } else {
    run = await db.discoveryRun.findFirstOrThrow({ where: { id: run.id } });
  }

  return { run, outcomes, refused: false };
}

async function finishRefused(
  run: DiscoveryRun,
  reason: DiscoveryRefusal,
  detail: string
): Promise<DiscoveryRun> {
  return db.discoveryRun.update({
    where: { id: run.id },
    data: { status: "REFUSED", refusalReason: reason, refusalDetail: detail, finishedAt: new Date() },
  });
}

/** Recent passes with their candidates, newest first. A read. */
export async function listDiscoveryRuns(userId: string, limit = 10) {
  return db.discoveryRun.findMany({
    where: { userId },
    orderBy: { startedAt: "desc" },
    take: limit,
    include: { candidates: { orderBy: { createdAt: "asc" } } },
  });
}
