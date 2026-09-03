/**
 * P2 — THE POLICY GATE, IN SHADOW MODE.
 *
 * WHAT IT ANSWERS. Not "may this user do this" — `checkCapability()` answers
 * that and keeps answering it, unchanged. This answers "given what this action
 * does and whether it can be taken back, should a person be looking at it?"
 *
 * WHAT IT IS. A lookup in a five-by-three table, plus one escalation rule.
 * That is the entire decision procedure. It is written as a table rather than a
 * chain of conditionals so that a future security review can answer "why did
 * VOX decide this?" by reading one grid instead of tracing branches — and so
 * that adding a case means adding a row somebody has to justify in a diff.
 *
 * WHAT IT IS NOT.
 *   - It never calls a model. There is no provider import in this file and no
 *     `async` in the decision path.
 *   - It cannot read prose. `evaluatePolicy()` accepts enums and booleans and
 *     nothing else, so "this is completely safe" is not merely ignored, it is
 *     unrepresentable. A model asserting an action is safe is not evidence; it
 *     is the thing a compromised or mistaken model would say.
 *   - It executes nothing, writes no memory, and touches no row. The only I/O
 *     in this module is the audit event, which is written after the decision and
 *     cannot influence it.
 *
 * SHADOW MODE. In this phase the gate observes and records. It does not block.
 * A HOLD is written to the event log and execution continues regardless — see
 * `recordShadowPolicyEvaluation()`, which returns `void` precisely so that no
 * caller can accidentally start branching on it before P4 makes enforcement
 * deliberate. The point of the shadow period is to learn the real HOLD rate
 * against real traffic before anything is allowed to stop.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { recordEvent } from "@/lib/observability/events";
import { logger } from "@/lib/observability/logger";
import {
  classifyAction,
  classifyTask,
  deepFreeze,
  type ActionClassification,
  type ActionRegistry,
  type Effect,
  type Reversibility,
} from "@/lib/policy/classification";

/**
 * What the policy says.
 *
 *   ALLOW — proceed.
 *   HOLD  — a person should authorize this before it happens.
 *   DENY  — policy refuses this categorically; no approval routes around it.
 *
 * In P2 all three continue execution. Only the record differs.
 */
export type PolicyDecision = "ALLOW" | "HOLD" | "DENY";

/**
 * Severity order, used for one purpose: making escalation the only possible
 * direction of travel. A gate that could compare decisions in both directions
 * could weaken one.
 */
const DECISION_SEVERITY: Record<PolicyDecision, number> = { ALLOW: 0, HOLD: 1, DENY: 2 };

/**
 * Returns whichever decision is stricter. Never the weaker one — this function
 * is the mechanical form of "the gate may add a HOLD and may never remove one".
 */
export function strictest(a: PolicyDecision, b: PolicyDecision): PolicyDecision {
  return DECISION_SEVERITY[a] >= DECISION_SEVERITY[b] ? a : b;
}

/**
 * THE POLICY MATRIX. Effect down, reversibility across.
 *
 *                      REVERSIBLE   PARTIALLY_REVERSIBLE   IRREVERSIBLE
 *   READ               ALLOW        ALLOW                  ALLOW
 *   ANALYZE            ALLOW        ALLOW                  ALLOW
 *   WRITE              ALLOW        HOLD                   HOLD
 *   ACT                HOLD         HOLD                   HOLD
 *   FINANCIAL          HOLD         HOLD                   HOLD
 *
 * THE MATRIX NO LONGER PRODUCES DENY AT ALL. That is [P4-A] and it is the
 * point: whether an action is refused categorically turns out not to be a
 * property of (effect x reversibility). See the note below the rows.
 *
 * The reasoning, cell by cell rather than in aggregate:
 *
 * READ and ANALYZE observe. There is no effect to reverse, so the reversibility
 * column is vacuous for them and every cell is ALLOW. The rows are kept total
 * anyway — a partial table is a table with a hole for someone to fall through.
 *
 * WRITE changes VOX's own state. Reversible writes (a row VOX created and can
 * delete) are ordinary work and should not need a human. A write that cannot be
 * cleanly undone is different in kind: `workspace.write` over an untracked file
 * destroys something git cannot return, and that is worth a person's attention.
 *
 * ACT reaches outside VOX. Even the reversible-looking cases are not really
 * reversible from the other party's point of view — deleting a calendar event
 * does not un-send the invitation — so the whole row holds.
 *
 * FINANCIAL moves the user's money. Held in every case, because money is never
 * ordinary work.
 *
 * [P4-A] WHY FINANCIAL/IRREVERSIBLE IS NO LONGER `DENY` HERE.
 *
 * P2 put DENY in that cell reasoning that an irreversible financial action is
 * "money leaving with no correcting entry". The P2.1 audit then found a real
 * tool in it — `economic.record_expense` — and that exposed the conflation.
 * Traced end to end (src/lib/economic/spend.ts#recordPolicySpend), that tool
 * reaches ONE SQL INSERT. There is no payment processor, no bank, no card
 * anywhere in VOX. It is irreversible, because the ledger is append-only, and
 * it is genuinely financial, because the row consumes a spend ceiling only a
 * human can raise. But no external record changes.
 *
 * DENY does not mean "risky", and it does not mean "irreversible". It means
 * THERE IS NO LEGITIMATE AUTHORIZATION PATH — nothing a human could approve
 * that would make it acceptable. A human raising the ceiling and approving an
 * expense is exactly such a path, so DENY was the wrong verdict; enforcing it
 * would have left VOX permanently unable to record its own spending.
 *
 * The discriminator is the third axis added in P4-A:
 * `ActionClassification.externalSystemOfRecord`, which mirrors the line
 * `prisma/schema.prisma` already draws in `LedgerProvenance` between REALIZED
 * ("confirmed against an external system of record") and USER_RECORDED. It is
 * applied as an escalation in `evaluatePolicy()` below, not as a matrix cell.
 *
 * Frozen at module load, rows included. `Readonly<>` is erased at compile time
 * and the audit flipped a cell in-process to prove it; the freeze is what makes
 * the table actually constant. See the note atop classification.ts.
 */
export const POLICY_MATRIX: Readonly<Record<Effect, Readonly<Record<Reversibility, PolicyDecision>>>> = deepFreeze({
  READ: { REVERSIBLE: "ALLOW", PARTIALLY_REVERSIBLE: "ALLOW", IRREVERSIBLE: "ALLOW" },
  ANALYZE: { REVERSIBLE: "ALLOW", PARTIALLY_REVERSIBLE: "ALLOW", IRREVERSIBLE: "ALLOW" },
  WRITE: { REVERSIBLE: "ALLOW", PARTIALLY_REVERSIBLE: "HOLD", IRREVERSIBLE: "HOLD" },
  ACT: { REVERSIBLE: "HOLD", PARTIALLY_REVERSIBLE: "HOLD", IRREVERSIBLE: "HOLD" },
  FINANCIAL: { REVERSIBLE: "HOLD", PARTIALLY_REVERSIBLE: "HOLD", IRREVERSIBLE: "HOLD" },
} as const);

/** Why the gate decided what it decided. Codes, not prose — see `notes` for the words. */
export type PolicyReasonCode =
  /** Straight out of the matrix. */
  | "MATRIX"
  /** The matrix said ALLOW but the action costs money, so it was escalated. */
  | "FINANCIAL_ESCALATION"
  /** [P4-A] An irreversible financial action against a system of record outside VOX. */
  | "EXTERNAL_SYSTEM_OF_RECORD"
  /** An upstream restriction was stricter than anything this gate produced. */
  | "UPSTREAM_RESTRICTION"
  /** No classification existed; the conservative default was used. */
  | "UNCLASSIFIED_ACTION"
  /** The input could not be evaluated at all. */
  | "MALFORMED_INPUT";

export interface PolicyEvaluationInput {
  /** What the action does. The ONLY thing that determines the outcome. */
  action: ActionClassification;
  /**
   * A restriction decided somewhere else that this gate must not weaken.
   *
   * The economic engine is the case this exists for. Its halt, its ceiling and
   * its `decide()` outcomes are the final authority over financial execution,
   * and nothing here may talk them down. Passing a prior HOLD guarantees at
   * least a HOLD comes back, because the result is `strictest(prior, own)` — the
   * gate has no expression available to it that lowers a decision.
   */
  prior?: PolicyDecision;
}

export interface PolicyEvaluation {
  decision: PolicyDecision;
  /** What the matrix alone said, before escalation or an upstream restriction. */
  matrixDecision: PolicyDecision;
  reasonCodes: PolicyReasonCode[];
  /** One short operational line per reason code. No hidden reasoning, no model text. */
  notes: string[];
}

/**
 * Evaluates the policy. Pure, synchronous, total.
 *
 * Total means every input produces a decision, including inputs that are not
 * valid classifications at all. Given `null`, a string, or an object with an
 * effect nobody has ever heard of, this returns a conservative HOLD with
 * MALFORMED_INPUT rather than throwing — because the caller is an execution
 * path, and a policy layer that can crash the thing it observes has made the
 * system less safe rather than more.
 *
 * That is not the same as swallowing the problem: the reason code and note say
 * exactly what went wrong, and both reach the event log.
 */
export function evaluatePolicy(input: PolicyEvaluationInput): PolicyEvaluation {
  const reasonCodes: PolicyReasonCode[] = [];
  const notes: string[] = [];

  const action = input?.action as ActionClassification | undefined;
  const row = action ? POLICY_MATRIX[action.effect] : undefined;
  const matrixDecision = row ? row[action!.reversibility] : undefined;

  if (!matrixDecision) {
    // Unrecognised effect or reversibility. Nothing about this input can be
    // trusted, so the safest thing that still lets P4 recover is a HOLD.
    const restricted = strictest("HOLD", normalizePrior(input?.prior));
    return {
      decision: restricted,
      matrixDecision: "HOLD",
      reasonCodes: ["MALFORMED_INPUT"],
      notes: [
        `Action classification was missing or outside the known vocabulary (effect=${describe(action?.effect)}, reversibility=${describe(action?.reversibility)}). Treated as HOLD.`,
      ],
    };
  }

  reasonCodes.push("MATRIX");
  notes.push(`${action!.effect} + ${action!.reversibility} maps to ${matrixDecision}.`);

  let decision = matrixDecision;

  // The financial flag can only ever raise. Every FINANCIAL-effect row is
  // already at least HOLD, so this rule exists for the other case: an ACT or
  // WRITE that bills as a side effect — `qa.visual_review` is ANALYZE and
  // charges a provider, and would otherwise sail through as an observation.
  if (action!.financial === true && decision === "ALLOW") {
    decision = "HOLD";
    reasonCodes.push("FINANCIAL_ESCALATION");
    notes.push("Action costs real money, so an otherwise-allowed decision is escalated to HOLD.");
  }

  // [P4-A] THE ONLY SOURCE OF DENY.
  //
  // Irreversible AND financial AND against a record outside VOX. All three, or
  // the rule does not fire. This is the one combination for which no authority
  // inside VOX can grant permission — there is no approval that un-sends a wire
  // — so it is refused categorically rather than held for a human.
  //
  // Written as an ESCALATION rather than as a matrix cell, deliberately. The
  // matrix is keyed on (effect x reversibility) and cannot see a third axis
  // without becoming a cube. More importantly, expressing it here keeps the
  // gate monotonic: every rule in this function may only ever RAISE a decision,
  // and a matrix cell that read DENY would have needed a downgrade to reach the
  // internal-ledger case, which is precisely the move `strictest()` exists to
  // make unrepresentable.
  if (
    action!.externalSystemOfRecord === true &&
    action!.effect === "FINANCIAL" &&
    action!.reversibility === "IRREVERSIBLE"
  ) {
    const denied = strictest(decision, "DENY");
    if (denied !== decision) {
      decision = denied;
      reasonCodes.push("EXTERNAL_SYSTEM_OF_RECORD");
      notes.push(
        "Irreversible and financial against a system of record outside VOX. No authorization path exists for this, so it is denied rather than held."
      );
    }
  }

  const prior = normalizePrior(input?.prior);
  const withPrior = strictest(decision, prior);
  if (withPrior !== decision) {
    reasonCodes.push("UPSTREAM_RESTRICTION");
    notes.push(`An upstream restriction of ${prior} is stricter than ${decision} and stands.`);
    decision = withPrior;
  }

  return { decision, matrixDecision, reasonCodes, notes };
}

/** An unrecognised or absent prior is worth nothing, never a weakening. */
function normalizePrior(prior: unknown): PolicyDecision {
  return prior === "HOLD" || prior === "DENY" || prior === "ALLOW" ? prior : "ALLOW";
}

function describe(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

/**
 * Marks that a policy boundary is already open for the operation in flight.
 *
 * WHY. A single real operation must produce a single shadow record, and after
 * the audit there are now two places that can evaluate the same one. The
 * executor evaluates every tool it is about to run; `runResearch()` evaluates
 * itself, so that `POST /api/research` — which never touches the executor — is
 * no longer invisible to the gate. When the `research.run` TOOL runs, both fire
 * for one piece of work.
 *
 * The rule that resolves it: THE OUTERMOST BOUNDARY RECORDS. An evaluation that
 * finds a boundary already open defers to it and writes nothing, because the
 * outer one has already described the operation the user actually asked for.
 * This generalises — any future service-level gate placed under the executor
 * behaves correctly without knowing the executor exists.
 *
 * AsyncLocalStorage rather than a module-level flag: concurrent runs share this
 * process, and a plain boolean would let one run's boundary suppress an
 * unrelated run's evaluation. The store is per-async-context, so two
 * simultaneous requests cannot see each other's.
 */
const policyBoundary = new AsyncLocalStorage<{ boundary: string }>();

/**
 * Runs `fn` inside an open policy boundary.
 *
 * Call this around the work an evaluation covers, NOT around the evaluation
 * itself: the outer `recordShadowPolicyEvaluation()` must run first, unsuppressed,
 * and only what follows is inside the scope.
 *
 * Purely an observability concern. It does not gate, block, or alter the work
 * in any way — `fn` runs exactly as it would without it, and its result and any
 * thrown error pass straight through.
 */
export function withPolicyBoundary<T>(boundary: string, fn: () => Promise<T>): Promise<T> {
  return policyBoundary.run({ boundary }, fn);
}

/** Whether an evaluation would be suppressed as nested. Exposed for tests. */
export function isInsidePolicyBoundary(): boolean {
  return policyBoundary.getStore() !== undefined;
}

export interface ShadowEvaluationInput {
  userId: string;
  /** "tool" for the executor's registry, "proposal" for the proposal handlers. */
  registry: ActionRegistry;
  /** Tool name or proposal actionType. Looked up; never parsed for meaning. */
  actionId: unknown;
  /** Where the gate was invoked from, e.g. "agents.executor". */
  boundary: string;
  /** An upstream restriction the gate must not weaken. */
  prior?: PolicyDecision;
  /** Descriptive-only reference for the audit trail, e.g. "AgentRun"/id. */
  subjectType?: string;
  subjectId?: string;
}

/**
 * Evaluates the policy for one action and records what it would have done.
 *
 * RETURNS VOID, DELIBERATELY. In P2 a HOLD must still execute, and the most
 * reliable way to guarantee that is to give the caller nothing to branch on.
 * The executor cannot accidentally start enforcing this because there is no
 * value in its hand to enforce with. When P4 makes enforcement deliberate it
 * will change this signature, and that change will be visible in a diff instead
 * of emerging from someone reading a boolean the wrong way round.
 *
 * NEVER THROWS. Every failure mode — a malformed classification, an event write
 * that fails, an unexpected error anywhere in here — is caught and logged. The
 * gate observing an execution must not be able to break it.
 *
 * WHAT IS RECORDED. Enum values, booleans, the action id, and the boundary
 * name. No prompt, no tool input, no tool output, no credential, no user
 * content of any kind — none of which the gate is even given.
 */
export async function recordShadowPolicyEvaluation(input: ShadowEvaluationInput): Promise<void> {
  try {
    // One operation, one record. An outer boundary has already described this
    // work — see `withPolicyBoundary`. Deferring is not a lost evaluation: the
    // outer record names the same action with the same classification, and only
    // its `boundary` field differs.
    const outer = policyBoundary.getStore();
    if (outer) {
      logger.info("policy.shadow_evaluation_nested", {
        outerBoundary: outer.boundary,
        innerBoundary: input.boundary,
        actionId: typeof input.actionId === "string" ? input.actionId : null,
      });
      return;
    }

    const { classification, known } = classifyAction(input.registry, input.actionId);
    const task = classifyTask(input.registry, input.actionId);
    const evaluation = evaluatePolicy({ action: classification, prior: input.prior });

    const reasonCodes = known ? evaluation.reasonCodes : [...evaluation.reasonCodes, "UNCLASSIFIED_ACTION" as const];
    const notes = known
      ? evaluation.notes
      : [
          ...evaluation.notes,
          `No classification is registered for "${describe(input.actionId)}" in the ${input.registry} registry; the conservative default was used.`,
        ];

    await recordEvent({
      userId: input.userId,
      type: "policy.shadow_evaluated",
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      // Not consequential: the gate observed, it did not act. Marking shadow
      // observations consequential would flood the audit view that exists to
      // show what VOX actually DID.
      consequential: false,
      payload: {
        boundary: input.boundary,
        registry: input.registry,
        actionId: typeof input.actionId === "string" ? input.actionId : null,
        classificationKnown: known,
        effect: classification.effect,
        reversibility: classification.reversibility,
        financial: classification.financial,
        // Recorded for P4's taint boundary. Plays no part in the decision above.
        untrustedOutput: classification.untrustedOutput,
        // [P4-A] The sole discriminator between HOLD and DENY on an irreversible
        // financial action. Recorded so an auditor can see WHY a decision landed
        // where it did, rather than having to re-derive it from the tables.
        externalSystemOfRecord: classification.externalSystemOfRecord,
        sensitivity: task.sensitivity,
        freshness: task.freshness,
        decision: evaluation.decision,
        matrixDecision: evaluation.matrixDecision,
        priorDecision: normalizePrior(input.prior),
        reasonCodes,
        notes,
        shadowMode: true,
        // The whole point of the phase, stated in the record itself: whatever
        // the decision was, the execution went ahead.
        executionContinued: true,
      },
    });
  } catch (error) {
    // Recorded, not swallowed. If the audit trail itself is failing, that is
    // worth knowing — but it is not worth stopping the user's work for.
    logger.error("policy.shadow_evaluation_failed", {
      boundary: input?.boundary,
      actionId: typeof input?.actionId === "string" ? input.actionId : null,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
