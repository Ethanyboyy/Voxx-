// The economic experiment contract.
//
// An experiment contract is the artifact that lets an autonomous scheduler run
// an economic experiment without a model in the loop. It is written once, by a
// human or by VOX with a human approving it, and from then on the loop reads
// numbers rather than re-reading intent.
//
// IT EXTENDS THE EXISTING CHAIN. Opportunity -> Objective already exists;
// Experiment already exists with `hypothesis` and `method` — the first two
// terms of any contract. This module adds the economic terms to that model
// rather than standing up a second experiment subsystem beside it, so an
// economic experiment is the same row a research experiment is, with more of
// its fields filled in.
//
// READINESS IS NOT A JUDGMENT CALL. `validateContract()` returns the list of
// terms that are missing. A contract with a blank in it is never completed by
// assuming a default: there is no safe default for "how much may this lose",
// and inventing one is how an experiment ends up with no downside limit at all.
import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import type { DecisionContract } from "@/lib/economic/decide";
import type { Experiment } from "@/generated/prisma/client";
import type { ExperimentExecutionStatus, ExperimentOutcome } from "@/generated/prisma/enums";

/**
 * The terms a contract must state before it may be evaluated autonomously.
 *
 * Each one gates a decision in decide.ts. Nothing is here for completeness'
 * sake: drop any one of them and the decision layer loses a rule.
 */
export const REQUIRED_CONTRACT_TERMS = [
  "requiredCapitalUsd",
  "maxLossUsd",
  "successMetric",
  "failureMetric",
  "deadlineAt",
  "scaleCriteria",
  "scaleAtNetUsd",
  "killCriteria",
  "killAtNetUsd",
  "expectedReturnUsd",
  "expectedNetProfitUsd",
  "requiredCapabilities",
] as const;

export type ContractTerm = (typeof REQUIRED_CONTRACT_TERMS)[number];

export interface ContractValidation {
  /** True only when every required term is stated AND internally coherent. */
  executable: boolean;
  /** Terms left blank. A blank is "not yet stated", never zero. */
  missing: ContractTerm[];
  /**
   * Terms that are present but contradict each other or are nonsensical.
   * Separate from `missing` because an incoherent contract is a different
   * problem from an incomplete one — one needs correcting, the other finishing.
   */
  incoherent: string[];
}

export interface ExperimentContractDTO {
  id: string;
  userId: string;
  hypothesis: string;
  method: string | null;
  opportunityId: string | null;
  economicAssetId: string | null;
  requiredCapitalUsd: number | null;
  maxLossUsd: number | null;
  successMetric: string | null;
  failureMetric: string | null;
  deadlineAt: Date | null;
  scaleCriteria: string | null;
  scaleAtNetUsd: number | null;
  killCriteria: string | null;
  killAtNetUsd: number | null;
  expectedReturnUsd: number | null;
  expectedNetProfitUsd: number | null;
  requiredCapabilities: string[];
  executionStatus: ExperimentExecutionStatus;
  outcome: ExperimentOutcome;
  lastDecision: string | null;
  lastDecisionReason: string | null;
  lastDecisionAt: Date | null;
  validation: ContractValidation;
}

function parseCapabilities(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Checks a contract for completeness and internal coherence.
 *
 * Coherence matters as much as completeness. "Kill at -$50, but the maximum
 * loss is $20" is a fully-populated contract that cannot be satisfied — the
 * loss cap fires first and the kill threshold is dead text. Catching that here
 * means the numbers a human reads are the numbers the machine will act on.
 */
export function validateContract(e: Experiment): ContractValidation {
  const missing: ContractTerm[] = [];
  for (const term of REQUIRED_CONTRACT_TERMS) {
    const value = e[term as keyof Experiment];
    if (value === null || value === undefined || value === "") missing.push(term);
  }
  if (!missing.includes("requiredCapabilities") && parseCapabilities(e.requiredCapabilities).length === 0) {
    // An empty array is a real statement ("needs nothing"), but only when it
    // parses. A malformed blob reads as empty and would silently pass.
    try {
      const parsed: unknown = JSON.parse(e.requiredCapabilities ?? "null");
      if (!Array.isArray(parsed)) missing.push("requiredCapabilities");
    } catch {
      missing.push("requiredCapabilities");
    }
  }

  const incoherent: string[] = [];
  if (e.maxLossUsd !== null && e.maxLossUsd <= 0) {
    incoherent.push("maxLossUsd must be greater than 0 — an experiment with no authorized downside cannot be run.");
  }
  if (e.requiredCapitalUsd !== null && e.requiredCapitalUsd < 0) {
    incoherent.push("requiredCapitalUsd cannot be negative.");
  }
  if (e.killAtNetUsd !== null && e.maxLossUsd !== null && -e.killAtNetUsd >= e.maxLossUsd) {
    incoherent.push(
      `killAtNetUsd (${e.killAtNetUsd}) is at or beyond maxLossUsd (${e.maxLossUsd}); the loss cap would always fire first, making the kill threshold unreachable.`
    );
  }
  if (e.scaleAtNetUsd !== null && e.killAtNetUsd !== null && e.scaleAtNetUsd <= e.killAtNetUsd) {
    incoherent.push("scaleAtNetUsd must be above killAtNetUsd, or the contract both scales and kills at the same net.");
  }

  return { executable: missing.length === 0 && incoherent.length === 0, missing, incoherent };
}

export function toContractDTO(e: Experiment): ExperimentContractDTO {
  return {
    id: e.id,
    userId: e.userId,
    hypothesis: e.hypothesis,
    method: e.method,
    opportunityId: e.opportunityId,
    economicAssetId: e.economicAssetId,
    requiredCapitalUsd: e.requiredCapitalUsd,
    maxLossUsd: e.maxLossUsd,
    successMetric: e.successMetric,
    failureMetric: e.failureMetric,
    deadlineAt: e.deadlineAt,
    scaleCriteria: e.scaleCriteria,
    scaleAtNetUsd: e.scaleAtNetUsd,
    killCriteria: e.killCriteria,
    killAtNetUsd: e.killAtNetUsd,
    expectedReturnUsd: e.expectedReturnUsd,
    expectedNetProfitUsd: e.expectedNetProfitUsd,
    requiredCapabilities: parseCapabilities(e.requiredCapabilities),
    executionStatus: e.executionStatus,
    outcome: e.outcome,
    lastDecision: e.lastDecision,
    lastDecisionReason: e.lastDecisionReason,
    lastDecisionAt: e.lastDecisionAt,
    validation: validateContract(e),
  };
}

/**
 * The ONLY bridge from a stored contract to the decision layer.
 *
 * Returns null for an incomplete or incoherent contract rather than filling
 * the gap. decide()'s input type has no nullable gating terms precisely so
 * that this function has to make that choice explicitly, in one place, where
 * it is reviewable — instead of a default silently appearing at the call site.
 */
export function toDecisionContract(e: Experiment): DecisionContract | null {
  if (!validateContract(e).executable) return null;
  return {
    experimentId: e.id,
    maxLossUsd: e.maxLossUsd!,
    requiredCapitalUsd: e.requiredCapitalUsd!,
    scaleAtNetUsd: e.scaleAtNetUsd!,
    killAtNetUsd: e.killAtNetUsd!,
    deadlineAt: e.deadlineAt!,
  };
}

export interface WriteContractInput {
  hypothesis?: string;
  method?: string;
  opportunityId?: string | null;
  economicAssetId?: string | null;
  requiredCapitalUsd?: number | null;
  maxLossUsd?: number | null;
  successMetric?: string | null;
  failureMetric?: string | null;
  deadlineAt?: Date | null;
  scaleCriteria?: string | null;
  scaleAtNetUsd?: number | null;
  killCriteria?: string | null;
  killAtNetUsd?: number | null;
  expectedReturnUsd?: number | null;
  expectedNetProfitUsd?: number | null;
  requiredCapabilities?: string[];
}

function toWriteData(input: WriteContractInput) {
  const { requiredCapabilities, ...rest } = input;
  return {
    ...rest,
    ...(requiredCapabilities !== undefined ? { requiredCapabilities: JSON.stringify(requiredCapabilities) } : {}),
  };
}

export interface CreateEconomicExperimentInput extends WriteContractInput {
  userId: string;
  hypothesis: string;
}

/**
 * Creates an economic experiment.
 *
 * It always starts DRAFT, even when the input happens to be complete.
 * `readyExperiment()` is a separate, deliberate step — writing a contract and
 * arming it for an autonomous loop are different decisions, and collapsing
 * them means a fully-specified contract created by an agent would go live the
 * instant it was written.
 */
export async function createEconomicExperiment(input: CreateEconomicExperimentInput): Promise<ExperimentContractDTO> {
  const { userId, ...contract } = input;
  const row = await db.experiment.create({
    data: { userId, ...toWriteData(contract), hypothesis: input.hypothesis, executionStatus: "DRAFT" },
  });

  await recordEvent({
    userId,
    type: "economic_experiment.created",
    subjectType: "Experiment",
    subjectId: row.id,
    payload: { hypothesis: row.hypothesis, maxLossUsd: row.maxLossUsd, requiredCapitalUsd: row.requiredCapitalUsd },
  });

  return toContractDTO(row);
}

export async function updateEconomicExperiment(
  userId: string,
  id: string,
  updates: WriteContractInput
): Promise<ExperimentContractDTO | null> {
  const existing = await db.experiment.findFirst({ where: { id, userId } });
  if (!existing) return null;

  // A terminal experiment's contract is history. Editing the loss cap of a
  // killed experiment would rewrite the record of why it died.
  if (existing.executionStatus === "KILLED" || existing.executionStatus === "COMPLETED") {
    throw new Error(`Experiment ${id} is ${existing.executionStatus}; its contract is closed and cannot be edited.`);
  }

  const row = await db.experiment.update({ where: { id }, data: toWriteData(updates) });
  return toContractDTO(row);
}

/**
 * Arms a contract for the scheduler.
 *
 * Refuses anything that is not executable, and says exactly what is missing —
 * this is the gate between "someone wrote down an idea" and "a loop will act
 * on this without asking again".
 */
export async function readyExperiment(userId: string, id: string): Promise<ExperimentContractDTO> {
  const existing = await db.experiment.findFirst({ where: { id, userId } });
  if (!existing) throw new Error(`Experiment ${id} not found.`);

  const validation = validateContract(existing);
  if (!validation.executable) {
    const problems = [...validation.missing, ...validation.incoherent];
    throw new Error(`Contract is not executable. Unresolved: ${problems.join("; ")}`);
  }

  const row = await db.experiment.update({
    where: { id },
    data: { executionStatus: "READY", status: existing.status === "PLANNED" ? "PLANNED" : existing.status },
  });

  await recordEvent({
    userId,
    type: "economic_experiment.ready",
    subjectType: "Experiment",
    subjectId: id,
    consequential: true,
    payload: { maxLossUsd: row.maxLossUsd, requiredCapitalUsd: row.requiredCapitalUsd, deadlineAt: row.deadlineAt },
  });

  return toContractDTO(row);
}

export async function getEconomicExperiment(userId: string, id: string): Promise<ExperimentContractDTO | null> {
  const row = await db.experiment.findFirst({ where: { id, userId } });
  return row ? toContractDTO(row) : null;
}

/**
 * Economic experiments only — the ones carrying a contract.
 *
 * A research experiment with no economic terms is a real Experiment row and
 * belongs to a different surface; filtering on `maxLossUsd` (the one term with
 * no meaning outside an economic contract) keeps the two from bleeding into
 * each other without needing a discriminator column.
 */
export async function listEconomicExperiments(userId: string): Promise<ExperimentContractDTO[]> {
  const rows = await db.experiment.findMany({
    where: { userId, maxLossUsd: { not: null } },
    orderBy: { updatedAt: "desc" },
  });
  return rows.map(toContractDTO);
}
