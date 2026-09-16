/**
 * [P5-G] EXECUTING ONE AUTHORIZED COMMERCIAL ACTION.
 *
 * The service between the tool and the write provider. Nothing here executes
 * itself: it is called BY a registered tool, which is called by the executor,
 * which has already run `checkCapability()` and `enforceExecution()` and spent
 * a single-use `ApprovalGrant` bound to these exact arguments. There is no path
 * into this module that skips any of that.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER OF OPERATIONS IS THE SAFETY PROPERTY
 * ---------------------------------------------------------------------------
 *
 *   1. load the action, scoped by userId
 *   2. refuse unless it is PLANNED        <- blocks every re-run
 *   3. re-derive the digest, refuse on drift
 *   4. resolve the credential, check the scope matches the declared store
 *   5. COMPARE-AND-SET PLANNED -> SUBMITTED, committing `submittedAt`
 *   6. call the provider
 *   7. record APPLIED / FAILED / UNKNOWN
 *
 * STEP 5 IS THE POINT OF NO RETURN AND IT HAPPENS BEFORE STEP 6. That ordering
 * is the whole design. If the process dies anywhere inside step 6 — a crash, a
 * container reclaim, a lost connection — the row is already SUBMITTED, and step
 * 2 refuses every subsequent attempt. The write may or may not have landed; what
 * cannot happen is VOX quietly doing it a second time to find out.
 *
 * Writing `submittedAt` AFTER the call would be the natural shape and would be
 * wrong: the window between the request leaving and the response arriving is
 * exactly the window in which a crash is most likely, and it is exactly the
 * window in which the external state may already exist.
 *
 * ---------------------------------------------------------------------------
 * HOW AN UNKNOWN IS RESOLVED
 * ---------------------------------------------------------------------------
 *
 * By ASKING THE STORE. `observeCommercialAction()` reads the discount back by
 * code, and only the store's own answer may move a SUBMITTED or UNKNOWN action
 * to SUCCEEDED or FAILED. There is no timeout that promotes it, no retry that
 * resolves it, and no code path that assumes.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { resolveConnectionCredential } from "@/lib/integrations/economic";
import {
  getCommercialWriteProvider,
  type VerificationOutcome,
  type WriteFailure,
} from "@/lib/integrations/commerce";
import { SHOPIFY_DISCOUNT_READ_SCOPE, SHOPIFY_WRITE_SCOPE } from "@/lib/integrations/shopifyCommerce";
import {
  commercialContractDigestOf,
  describeDiscountAction,
  parseStoredParameters,
  validateDiscountParameters,
  type ContractViolation,
  type DiscountCodeParameters,
} from "@/lib/commerce/contract";
import type { CommercialAction, CommercialActionStatus } from "@/generated/prisma/client";

const PROVIDER_ID = "shopify";

/** The tool that performs this action. One kind, one tool. */
export const CREATE_DISCOUNT_TOOL = "commerce.create_discount_code";

// ---------------------------------------------------------------------------
// Declaring
// ---------------------------------------------------------------------------

export type DeclareActionRefusal =
  | "EXPERIMENT_NOT_FOUND"
  | "ALREADY_DECLARED"
  /** The experiment already has an execution. Declaring now is drafting after the fact. */
  | "EXPERIMENT_DISPATCHED"
  | "INVALID_PARAMETERS"
  | "SCOPE_INVALID";

export type DeclareActionResult =
  | { declared: true; action: CommercialAction; digest: string; description: string }
  | { declared: false; reason: DeclareActionRefusal; violations?: ContractViolation[] };

export interface DeclareActionInput {
  userId: string;
  experimentId: string;
  externalScope: string;
  parameters: Record<string, unknown>;
}

/**
 * Declares and freezes the action. Creates nothing externally.
 *
 * Refuses once the experiment carries an execution identity, for the same reason
 * the observation contract does: an intervention declared after the experiment
 * has run is not an intervention, it is a description of what already happened.
 */
export async function declareCommercialAction(input: DeclareActionInput): Promise<DeclareActionResult> {
  const { userId, experimentId } = input;

  const validation = validateDiscountParameters(input.parameters);
  if (!validation.valid) {
    return { declared: false, reason: "INVALID_PARAMETERS", violations: validation.violations };
  }
  if (input.externalScope.trim().length === 0) return { declared: false, reason: "SCOPE_INVALID" };

  const experiment = await db.experiment.findFirst({
    where: { id: experimentId, userId },
    include: { commercialAction: true },
  });
  if (!experiment) return { declared: false, reason: "EXPERIMENT_NOT_FOUND" };
  if (experiment.commercialAction) return { declared: false, reason: "ALREADY_DECLARED" };
  if (experiment.executionRunId !== null) return { declared: false, reason: "EXPERIMENT_DISPATCHED" };

  const parameters = validation.parameters;
  const digest = commercialContractDigestOf({
    kind: "DISCOUNT_CODE",
    externalScope: input.externalScope,
    parameters,
  });

  let action: CommercialAction;
  try {
    action = await db.commercialAction.create({
      data: {
        userId,
        experimentId,
        kind: "DISCOUNT_CODE",
        externalScope: input.externalScope,
        parameters: JSON.stringify({
          code: parameters.code,
          title: parameters.title,
          percentageFraction: parameters.percentageFraction,
          startsAt: parameters.startsAt.toISOString(),
          endsAt: parameters.endsAt.toISOString(),
          usageLimit: parameters.usageLimit,
          appliesOncePerCustomer: parameters.appliesOncePerCustomer,
        }),
        contractDigest: digest,
        status: "PLANNED",
      },
    });
  } catch {
    // The unique constraint on experimentId is the real guard against two
    // actions being declared for one experiment.
    return { declared: false, reason: "ALREADY_DECLARED" };
  }

  const description = describeDiscountAction(parameters, input.externalScope);

  await recordEvent({
    userId,
    type: "commerce.action.declared",
    subjectType: "CommercialAction",
    subjectId: action.id,
    consequential: true,
    payload: {
      kind: "DISCOUNT_CODE",
      experimentId,
      externalScope: input.externalScope,
      contractDigest: digest,
      description,
    },
  });

  return { declared: true, action, digest, description };
}

// ---------------------------------------------------------------------------
// Executing
// ---------------------------------------------------------------------------

export type ExecuteRefusal =
  | "NOT_FOUND"
  /** The action is not PLANNED. Covers already-run, in-flight and unknown. */
  | "NOT_PLANNABLE"
  /** The digest in the arguments is not the digest of the stored parameters. */
  | "CONTRACT_ALTERED"
  /** Stored parameters no longer validate. Refuse rather than send them. */
  | "PARAMETERS_INVALID"
  | "NOT_CONFIGURED"
  | "NOT_AUTHORIZED"
  | "CREDENTIAL_INVALID"
  | "STORE_MISMATCH"
  /** Another execution claimed this action first. */
  | "EXECUTION_RACE_LOST"
  | "NO_PROVIDER";

export type ExecuteResult =
  | { executed: true; status: "SUCCEEDED"; externalId: string; action: CommercialAction }
  | { executed: false; status: "FAILED" | "UNKNOWN"; failure: WriteFailure; detail: string }
  | { executed: false; status: "REFUSED"; reason: ExecuteRefusal; detail: string };

export interface ExecuteActionInput {
  userId: string;
  actionId: string;
  /**
   * The digest of the parameters, as it stood when the approval was given.
   *
   * Travels in the tool's arguments so the `ApprovalGrant` binds it. Compared
   * here against a digest re-derived from the row, so an edit between approval
   * and execution breaks both the grant match and this check.
   */
  contractDigest: string;
  /** The run and step performing this. Bound to the action, uniquely. */
  runId?: string;
  stepId?: string;
}

export async function executeCommercialAction(input: ExecuteActionInput): Promise<ExecuteResult> {
  const { userId, actionId } = input;

  const action = await db.commercialAction.findFirst({ where: { id: actionId, userId } });
  if (!action) {
    return { executed: false, status: "REFUSED", reason: "NOT_FOUND", detail: "No such commercial action." };
  }

  // ---- THE RE-RUN GUARD --------------------------------------------------
  //
  // Everything except PLANNED is refused here, and the three interesting cases
  // are SUBMITTED, UNKNOWN and SUCCEEDED. Re-running a SUCCEEDED action would
  // create a second discount; re-running a SUBMITTED or UNKNOWN one might. All
  // three are the same refusal because the reasoning is the same: VOX does not
  // know that nothing exists, so it must not act as though nothing does.
  if (action.status !== "PLANNED") {
    return {
      executed: false,
      status: "REFUSED",
      reason: "NOT_PLANNABLE",
      detail: refusalForStatus(action.status),
    };
  }

  const parameters = parseStoredParameters(action.parameters);
  if (!parameters) {
    return {
      executed: false,
      status: "REFUSED",
      reason: "PARAMETERS_INVALID",
      detail: "The stored parameters for this action no longer validate. Nothing was sent.",
    };
  }

  // ---- THE FREEZE, CHECKED -----------------------------------------------
  const currentDigest = commercialContractDigestOf({
    kind: action.kind,
    externalScope: action.externalScope,
    parameters,
  });
  if (currentDigest !== action.contractDigest || currentDigest !== input.contractDigest) {
    return {
      executed: false,
      status: "REFUSED",
      reason: "CONTRACT_ALTERED",
      detail:
        "The action's parameters changed after it was authorized. What would be sent is not what was approved, so nothing was sent.",
    };
  }

  const resolution = await resolveConnectionCredential(userId, "SHOPIFY");
  if (!resolution.resolved) {
    return {
      executed: false,
      status: "REFUSED",
      reason: resolution.failure === "NOT_AUTHORIZED" ? "NOT_AUTHORIZED" : "NOT_CONFIGURED",
      detail: resolution.detail,
    };
  }
  if (resolution.credential.scope !== action.externalScope) {
    return {
      executed: false,
      status: "REFUSED",
      reason: "STORE_MISMATCH",
      detail: "The connected store is not the store this action declared. Nothing was sent.",
    };
  }
  // The credential must carry the WRITE scope specifically. The read scope that
  // P5-E established is not authorization to change anything.
  if (!resolution.credential.grantedScope.includes(SHOPIFY_WRITE_SCOPE)) {
    return {
      executed: false,
      status: "REFUSED",
      reason: "CREDENTIAL_INVALID",
      detail: `The stored credential does not carry the ${SHOPIFY_WRITE_SCOPE} scope. Nothing was sent.`,
    };
  }

  const provider = getCommercialWriteProvider(PROVIDER_ID);
  if (!provider) {
    return { executed: false, status: "REFUSED", reason: "NO_PROVIDER", detail: "No commercial write provider is registered." };
  }

  // ---- THE POINT OF NO RETURN, COMMITTED BEFORE THE CALL ------------------
  //
  // A conditional update from PLANNED, so two concurrent executions cannot both
  // proceed: the database decides, exactly once. The loser holds nothing and
  // sends nothing.
  //
  // `submittedAt` lands here rather than after the provider answers. From this
  // moment the honest description of this action is "may have happened", and it
  // stays that way until the store is asked.
  const claimed = await db.commercialAction.updateMany({
    where: { id: actionId, userId, status: "PLANNED" },
    data: {
      status: "SUBMITTED",
      submittedAt: new Date(),
      executionRunId: input.runId ?? null,
      executionStepId: input.stepId ?? null,
    },
  });
  if (claimed.count === 0) {
    return {
      executed: false,
      status: "REFUSED",
      reason: "EXECUTION_RACE_LOST",
      detail: "Another execution claimed this action first. Nothing was sent twice.",
    };
  }

  await recordEvent({
    userId,
    type: "commerce.action.submitted",
    subjectType: "CommercialAction",
    subjectId: actionId,
    consequential: true,
    payload: {
      kind: action.kind,
      externalScope: action.externalScope,
      contractDigest: action.contractDigest,
      code: parameters.code,
      runId: input.runId ?? null,
      stepId: input.stepId ?? null,
      // Recorded plainly so the audit log does not read as a success.
      note: "Handed to the provider. The outcome is not yet known.",
    },
  });

  const outcome = await provider.createDiscountCode({
    scope: resolution.credential.scope,
    accessToken: resolution.credential.accessToken,
    parameters,
  });

  if (outcome.outcome === "APPLIED") {
    const updated = await db.commercialAction.update({
      where: { id: actionId },
      data: {
        status: "SUCCEEDED",
        externalId: outcome.externalId,
        responseDigest: outcome.responseDigest,
        failureCode: null,
        failureDetail: null,
      },
    });
    await recordEvent({
      userId,
      type: "commerce.action.applied",
      subjectType: "CommercialAction",
      subjectId: actionId,
      consequential: true,
      payload: {
        externalId: outcome.externalId,
        responseDigest: outcome.responseDigest,
        code: parameters.code,
        externalScope: action.externalScope,
        // Said explicitly, in the audit record itself, because this is exactly
        // the row someone will later read as proof that VOX made money.
        note: "A discount code now exists. No money moved, nothing was sold, and no revenue was created.",
      },
    });
    return { executed: true, status: "SUCCEEDED", externalId: outcome.externalId, action: updated };
  }

  // REFUSED and UNKNOWN are persisted differently, and the difference is the
  // whole point: FAILED asserts nothing was created, UNKNOWN asserts nothing at
  // all. Only the provider's own explicit decline produces FAILED.
  const status: CommercialActionStatus = outcome.outcome === "REFUSED" ? "FAILED" : "UNKNOWN";
  await db.commercialAction.update({
    where: { id: actionId },
    data: { status, failureCode: outcome.failure, failureDetail: outcome.detail },
  });
  await recordEvent({
    userId,
    type: status === "FAILED" ? "commerce.action.failed" : "commerce.action.unknown",
    subjectType: "CommercialAction",
    subjectId: actionId,
    consequential: true,
    payload: {
      failure: outcome.failure,
      detail: outcome.detail,
      code: parameters.code,
      note:
        status === "FAILED"
          ? "The provider explicitly declined. Nothing was created."
          : "The request was submitted and the outcome is unknown. It will not be retried; the store must be asked.",
    },
  });

  return { executed: false, status, failure: outcome.failure, detail: outcome.detail };
}

function refusalForStatus(status: CommercialActionStatus): string {
  switch (status) {
    case "SUCCEEDED":
      return "This action has already been performed. Running it again would create a second discount in the store.";
    case "SUBMITTED":
      return "This action was already handed to the provider and its outcome was never recorded. It may have happened. Ask the store rather than sending it again.";
    case "UNKNOWN":
      return "This action's outcome is unknown. Re-sending it could create a duplicate, so it is refused until the store has been asked.";
    case "FAILED":
      return "This action already failed. Declare a new action rather than re-running a spent one.";
    case "PLANNED":
      return "This action is ready.";
  }
}

// ---------------------------------------------------------------------------
// Observing — the only way out of an unknown
// ---------------------------------------------------------------------------

export type ObserveActionResult =
  | {
      observed: true;
      exists: boolean;
      matches: boolean;
      /** Redemption COUNT. Never money. Null when the store did not say. */
      redemptions: number | null;
      /** What the action's status is now, after the store answered. */
      status: CommercialActionStatus;
      /** True when this observation moved a SUBMITTED/UNKNOWN action to a terminal state. */
      resolved: boolean;
      detail: string;
    }
  | { observed: false; failure: WriteFailure | ExecuteRefusal; detail: string };

/**
 * Asks the store whether the authorized discount exists, and records the answer.
 *
 * THE RESOLUTION RULES, and each one is a refusal to guess:
 *
 *   exists + matches    -> SUCCEEDED. The store holds exactly what was approved.
 *   does not exist      -> FAILED. The store was asked directly and said no.
 *   exists, mismatched  -> stays UNKNOWN. Something is there that nobody
 *                          authorized in that shape; a person has to look.
 *   could not be asked  -> nothing changes. A failed check is not an answer.
 *
 * Note the third rule especially. It would be easy to call a mismatched discount
 * a success on the grounds that the write clearly landed. It is not a success:
 * what landed is not what was authorized, and recording it as SUCCEEDED would
 * make the approval a record of something that did not happen.
 */
export async function observeCommercialAction(userId: string, actionId: string): Promise<ObserveActionResult> {
  const action = await db.commercialAction.findFirst({ where: { id: actionId, userId } });
  if (!action) return { observed: false, failure: "NOT_FOUND", detail: "No such commercial action." };

  const parameters = parseStoredParameters(action.parameters);
  if (!parameters) {
    return { observed: false, failure: "PARAMETERS_INVALID", detail: "The stored parameters could not be read." };
  }

  const resolution = await resolveConnectionCredential(userId, "SHOPIFY");
  if (!resolution.resolved) {
    return { observed: false, failure: resolution.failure as WriteFailure, detail: resolution.detail };
  }
  if (resolution.credential.scope !== action.externalScope) {
    return {
      observed: false,
      failure: "STORE_MISMATCH",
      detail: "The connected store is not the store this action was performed against.",
    };
  }
  if (!resolution.credential.grantedScope.includes(SHOPIFY_DISCOUNT_READ_SCOPE)) {
    return {
      observed: false,
      failure: "CREDENTIAL_INVALID",
      detail: `The stored credential does not carry the ${SHOPIFY_DISCOUNT_READ_SCOPE} scope.`,
    };
  }

  const provider = getCommercialWriteProvider(PROVIDER_ID);
  if (!provider) return { observed: false, failure: "NOT_CONFIGURED", detail: "No commercial provider is registered." };

  const verification: VerificationOutcome = await provider.verifyDiscountCode({
    scope: resolution.credential.scope,
    accessToken: resolution.credential.accessToken,
    parameters,
  });

  if (!verification.verified) {
    // A check that could not be made changes nothing. It is emphatically not
    // evidence that the discount is absent.
    await db.commercialAction.update({
      where: { id: actionId },
      data: { verifiedAt: new Date(), verifiedDetail: verification.detail },
    });
    return { observed: false, failure: verification.failure, detail: verification.detail };
  }

  const wasUnresolved = action.status === "SUBMITTED" || action.status === "UNKNOWN";
  let nextStatus: CommercialActionStatus = action.status;
  if (wasUnresolved) {
    if (verification.exists && verification.matches) nextStatus = "SUCCEEDED";
    else if (!verification.exists) nextStatus = "FAILED";
    // exists && !matches -> deliberately unchanged. See the doc comment.
  }

  await db.commercialAction.update({
    where: { id: actionId },
    data: {
      status: nextStatus,
      verifiedAt: verification.checkedAt,
      verifiedExists: verification.exists,
      verifiedMatches: verification.matches,
      verifiedDetail: verification.detail,
      // Only ever adopt an external id for a discount that IS the authorized
      // one. Recording the id of a mismatched discount would make the action
      // point at something it did not authorize.
      ...(verification.exists && verification.matches && verification.externalId
        ? { externalId: verification.externalId }
        : {}),
    },
  });

  await recordEvent({
    userId,
    type: "commerce.action.verified",
    subjectType: "CommercialAction",
    subjectId: actionId,
    consequential: true,
    payload: {
      exists: verification.exists,
      matches: verification.matches,
      redemptions: verification.redemptions,
      previousStatus: action.status,
      status: nextStatus,
      responseDigest: verification.responseDigest,
      note: "Redemptions are a count of uses. They are not revenue and not an amount.",
    },
  });

  return {
    observed: true,
    exists: verification.exists,
    matches: verification.matches,
    redemptions: verification.redemptions,
    status: nextStatus,
    resolved: wasUnresolved && nextStatus !== action.status,
    detail: verification.detail,
  };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export interface CommercialActionView {
  id: string;
  kind: CommercialAction["kind"];
  status: CommercialActionStatus;
  externalScope: string;
  experimentId: string | null;
  contractDigest: string;
  parameters: DiscountCodeParameters | null;
  description: string | null;
  externalId: string | null;
  submittedAt: Date | null;
  failureCode: string | null;
  failureDetail: string | null;
  verifiedAt: Date | null;
  verifiedExists: boolean | null;
  verifiedMatches: boolean | null;
  verifiedDetail: string | null;
  /** True while the outcome is genuinely not known. Derived, never stored. */
  outcomeUnresolved: boolean;
  executionRunId: string | null;
  executionStepId: string | null;
}

function project(action: CommercialAction): CommercialActionView {
  const parameters = parseStoredParameters(action.parameters);
  return {
    id: action.id,
    kind: action.kind,
    status: action.status,
    externalScope: action.externalScope,
    experimentId: action.experimentId,
    contractDigest: action.contractDigest,
    parameters,
    description: parameters ? describeDiscountAction(parameters, action.externalScope) : null,
    externalId: action.externalId,
    submittedAt: action.submittedAt,
    failureCode: action.failureCode,
    failureDetail: action.failureDetail,
    verifiedAt: action.verifiedAt,
    verifiedExists: action.verifiedExists,
    verifiedMatches: action.verifiedMatches,
    verifiedDetail: action.verifiedDetail,
    outcomeUnresolved: action.status === "SUBMITTED" || action.status === "UNKNOWN",
    executionRunId: action.executionRunId,
    executionStepId: action.executionStepId,
  };
}

export async function getCommercialAction(userId: string, actionId: string): Promise<CommercialActionView | null> {
  const action = await db.commercialAction.findFirst({ where: { id: actionId, userId } });
  return action ? project(action) : null;
}

export async function listCommercialActions(userId: string, limit = 50): Promise<CommercialActionView[]> {
  const actions = await db.commercialAction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return actions.map(project);
}
