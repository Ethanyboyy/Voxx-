/**
 * [P6-C] WHAT A DISCOVERY PASS IS ALLOWED TO PROPOSE.
 *
 * A leaf module: types, a schema and pure validation. No database, no model
 * call, no network.
 *
 * ---------------------------------------------------------------------------
 * THE DESIGN MOVE: THE UNSAFE THING IS UNREPRESENTABLE
 * ---------------------------------------------------------------------------
 *
 * `ProposedFigure` has a `figure`, a `value` and the model's `reasoning`. It
 * has NO `basis` and NO evidence field. Not an optional one, not one that is
 * validated and discarded — there is no property to set. So
 *
 *     { figure: "EXPECTED_PROFIT_CENTS", value: 50_000, basis: "MEASURED" }
 *
 * does not type-check, and the persister has nothing to read a basis FROM: it
 * writes `MODEL_SUGGESTED`, hardcoded, because that is the only value in scope.
 * "Discovery never produces a STATED, COMPARABLE or MEASURED figure" is
 * therefore a property of the types rather than a rule somebody has to follow.
 *
 * Same shape as the P5-E refusal that carries no value and the P6-B unknown arm
 * that carries no value: the way to stop a dangerous assignment is to delete the
 * field it would be assigned to.
 *
 * ---------------------------------------------------------------------------
 * AND THE SCHEMA IS STRICT, WHICH IS THE OTHER HALF
 * ---------------------------------------------------------------------------
 *
 * The types stop OUR code from claiming a basis. They do nothing about the
 * model, which will happily return `"basis": "MEASURED"` or
 * `"measurementId": "m-42"` if it decides that is what a good answer looks
 * like. A permissive parse would drop those keys silently, which is almost as
 * bad as honouring them: the pass would look like it had worked while the
 * model's actual claim went unrecorded.
 *
 * So `CLAIM_KEYS` is checked BEFORE parsing and a proposal carrying any of them
 * is REJECTED with that reason named. A model that tries to assert evidence
 * produces a visible rejection, not a quiet downgrade.
 */

import { z } from "zod";
import { createHash } from "node:crypto";
import { ECONOMIC_FIGURES, FIGURE_SPECS, figureValueColumns } from "@/lib/economic/figures";
import type { EconomicFigure } from "@/generated/prisma/enums";

/** The most candidates one pass may propose. An attention limit, not a capital one. */
export const MAX_CANDIDATES_PER_RUN = 8;

/** The most figures one candidate may carry — the registry is the real bound. */
export const MAX_FIGURES_PER_CANDIDATE = ECONOMIC_FIGURES.length;

/**
 * One economic figure a discovery pass proposes.
 *
 * NOTE WHAT IS ABSENT: no `basis`, no `measurementId`, no `experimentId`, no
 * `comparableId`, no `confidence`. See the module comment.
 */
export interface ProposedFigure {
  figure: EconomicFigure;
  /** Cents for money, a 0-1 fraction for a ratio, whole days for a duration. */
  value: number;
  /** Why the model proposed this number. Becomes the estimate's provenance text. */
  reasoning: string;
}

export interface ProposedOpportunity {
  title: string;
  /** Why this could make money. The candidate's whole argument, in prose. */
  thesis: string;
  /** Free text, open taxonomy: "dropshipping", "micro-saas", anything. */
  category?: string;
  rationale?: string;
  /** What the model says it does NOT know. Read by nothing that decides. */
  uncertainty?: string;
  figures: ProposedFigure[];
}

/**
 * Keys a proposal may not carry, at either level.
 *
 * Every one of these is a way of claiming evidence or standing. `confidence`
 * and `certainty` are in the list even though nothing would read them, because
 * a column that exists is a column a future gate can be tempted by — and the
 * brief is explicit that model confidence is not provenance.
 */
export const CLAIM_KEYS: readonly string[] = Object.freeze([
  "basis",
  "evidenceBasis",
  "provenance",
  "evidence",
  "measurementId",
  "experimentId",
  "comparableId",
  "researchItemId",
  "establishedAt",
  "confidence",
  "certainty",
  "verified",
  "measured",
  "capitalEligible",
  "source",
]);

const figureSchema = z
  .object({
    figure: z.enum(ECONOMIC_FIGURES as [EconomicFigure, ...EconomicFigure[]]),
    value: z.number(),
    reasoning: z.string().min(1).max(1000),
  })
  .strict();

const candidateSchema = z
  .object({
    title: z.string().min(3).max(200),
    thesis: z.string().min(10).max(4000),
    category: z.string().min(1).max(80).optional(),
    rationale: z.string().min(1).max(4000).optional(),
    uncertainty: z.string().min(1).max(4000).optional(),
    figures: z.array(figureSchema).min(1).max(MAX_FIGURES_PER_CANDIDATE),
  })
  .strict();

export const proposalSchema = z
  .object({ candidates: z.array(candidateSchema).max(MAX_CANDIDATES_PER_RUN) })
  .strict();

export type CandidateRejection =
  /** The shape is not a candidate: missing title, thesis, or figures. */
  | "MALFORMED"
  /**
   * THE ADVERSARIAL CASE. The proposal tried to assert a basis, an evidence
   * reference, a confidence, a source or an establishment date.
   */
  | "CLAIMS_EVIDENCE_OR_BASIS"
  /** A figure's value is not storable for its kind — see `figureValueColumns()`. */
  | "INVALID_FIGURE_VALUE"
  /** The same figure proposed twice. One figure has one current value. */
  | "DUPLICATE_FIGURE"
  /** An identical proposal already produced an opportunity for this user. */
  | "DUPLICATE_OF_EXISTING"
  /** The persistence of one of its figures was refused. */
  | "FIGURE_NOT_RECORDED";

export type CandidateValidation =
  | { valid: true; candidate: ProposedOpportunity }
  | { valid: false; reason: CandidateRejection; detail: string };

/** Every key present anywhere in a nested value. Depth-limited; proposals are shallow. */
function keysIn(value: unknown, depth = 0): string[] {
  if (depth > 4 || value === null || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item) => keysIn(item, depth + 1));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
    key,
    ...keysIn(child, depth + 1),
  ]);
}

/**
 * Validates one raw proposal.
 *
 * ORDER MATTERS. The claim check runs FIRST, so a proposal that both asserts a
 * measured basis and carries a malformed number is reported as the claim it
 * was, not as a typo. The claim is the thing somebody needs to see.
 */
export function validateCandidate(raw: unknown): CandidateValidation {
  const claimed = keysIn(raw).filter((key) => CLAIM_KEYS.includes(key));
  if (claimed.length > 0) {
    return {
      valid: false,
      reason: "CLAIMS_EVIDENCE_OR_BASIS",
      detail: `The proposal carried ${[...new Set(claimed)].sort().join(", ")}. A discovery pass states values and reasoning; it does not state what supports them. Every figure it produces is recorded as a model's proposal, and only explicit corroborating evidence can change that.`,
    };
  }

  const parsed = candidateSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      valid: false,
      reason: "MALFORMED",
      detail: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; "),
    };
  }

  const seen = new Set<EconomicFigure>();
  for (const figure of parsed.data.figures) {
    if (seen.has(figure.figure)) {
      return {
        valid: false,
        reason: "DUPLICATE_FIGURE",
        detail: `${FIGURE_SPECS[figure.figure].label} was proposed twice. A figure has one current value.`,
      };
    }
    seen.add(figure.figure);

    const columns = figureValueColumns(figure.figure, figure.value);
    if (!columns.valid) {
      return {
        valid: false,
        reason: "INVALID_FIGURE_VALUE",
        detail: `${FIGURE_SPECS[figure.figure].label}: ${columns.error}. Values are cents for money, a 0-1 fraction for a ratio, and whole days for a duration.`,
      };
    }
  }

  return { valid: true, candidate: parsed.data };
}

/**
 * A stable digest of a proposal.
 *
 * Over the title and the figure values only — not the prose. Two passes that
 * reword the same thesis around the same numbers are the same proposal, and
 * treating them as different is how repeated discovery would quietly
 * accumulate duplicate opportunities (each with its own estimates, each
 * looking like independent support for the same idea).
 */
export function proposalDigest(candidate: ProposedOpportunity): string {
  const canonical = [
    candidate.title.trim().toLowerCase(),
    ...[...candidate.figures]
      .sort((a, b) => a.figure.localeCompare(b.figure))
      .map((f) => `${f.figure}=${f.value}`),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}
