/**
 * [P6-F] THE INTERVENTION'S EXTERNAL IDENTITY BECOMES THE OBSERVATION'S SUBJECT.
 *
 * This module is small on purpose, because most of P6-F already existed and the
 * honest thing is to say which part did not.
 *
 * ALREADY THERE, from P5-G: `declareCommercialAction()` takes an `experimentId`
 * and binds it; `CommercialAction.experimentId` is UNIQUE, so one experiment has
 * at most one intervention; the action is frozen by `contractDigest`; execution
 * goes through `executeCommercialAction()` behind the `commerce.create_discount_code`
 * tool at `integration.shopify.write` / ACT, which the policy gate HOLDs and
 * which therefore requires an argument-bound `ApprovalGrant`; `executionRunId`
 * and `executionStepId` are UNIQUE on the action; and the write port returns
 * an applied, a refused or an unknown outcome, with only the applied arm carrying an
 * `externalId`.
 *
 * NOT THERE: the `externalId` went nowhere. The observation contract named a
 * store and a window and no subject, so the declared window meant "every order
 * this store took in this period" — a measurement OF THE STORE. An experiment
 * could be credited with a week of ordinary trading it had nothing to do with,
 * and the discount code it created was decoration.
 *
 * ---------------------------------------------------------------------------
 * THE TWO HALVES OF THE SUBJECT, AND WHY THEY ARE SEPARATE
 * ---------------------------------------------------------------------------
 *
 * The binding has an ordering problem: a frozen contract must be declared
 * BEFORE the experiment runs (`declareObservationContract()` refuses once an
 * execution identity exists, because choosing the question with the answer in
 * view is the thing the freeze prevents) — but an `externalId` only exists
 * AFTER the intervention has run.
 *
 * It is resolved by noticing that the subject's IDENTITY and its EXISTENCE are
 * different facts:
 *
 *   THE CODE is chosen when the action is declared, is frozen inside that
 *     action's `contractDigest`, and goes into the observation contract's own
 *     digest before dispatch. It is what is being asked about.
 *   THE EXTERNAL ID comes back from the provider and is recorded here. It is
 *     not in the digest — it is unknowable at declare time, and it answers a
 *     different question: did the thing we are asking about actually get made.
 *
 * So the question stays frozen and the confirmation arrives late, which is the
 * correct shape. `openDeclaredWindow()` refuses a subject-naming window until
 * this function has run, and that single rule is what keeps an UNKNOWN write
 * unknown: an ambiguous execution returns no `externalId`, so nothing is bound,
 * so the store is never asked, so there is no measurement to mistake for a
 * result.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MODULE DOES NOT DO
 * ---------------------------------------------------------------------------
 *
 * It does not execute, approve, or declare anything. There is no second
 * execution path and no second authorization check, because a second one is
 * where the gate gets skipped. It imports neither `executeCommercialAction` nor
 * any grant function: it reads an action that has ALREADY been applied through
 * the existing gated path and copies one identifier onto the experiment that
 * action already names.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { parseStoredParameters } from "@/lib/commerce/contract";
import { observationContractDigestOf, resolveObservationWindow } from "@/lib/economic/observationContract";

export type BindSubjectRefusal =
  | "EXPERIMENT_NOT_FOUND"
  /** The experiment declares no commercial intervention. */
  | "NO_INTERVENTION"
  /**
   * The intervention has not succeeded.
   *
   * Covers PLANNED (never run), SUBMITTED (in flight), FAILED (the store said
   * no) and **UNKNOWN** (it may or may not have happened). Every one of them
   * means there is no confirmed external subject, and UNKNOWN is the one that
   * matters: resolving it here would be inventing the confirmation that the
   * whole three-outcome write port exists to withhold.
   */
  | "NOT_APPLIED"
  /** SUCCEEDED with no external identifier. Should be impossible; refused anyway. */
  | "NO_EXTERNAL_ID"
  /** No observation contract to attach a subject to. */
  | "NO_CONTRACT"
  /**
   * The contract's declared subject is not this intervention's code.
   *
   * The identity check. Without it, an applied action could confirm a subject
   * it did not create — including another experiment's code.
   */
  | "SUBJECT_MISMATCH"
  /** Already bound. One confirmation, and it is not revisable. */
  | "ALREADY_BOUND";

export type BindSubjectResult =
  | { bound: true; subject: string; externalId: string }
  | { bound: false; reason: BindSubjectRefusal; detail: string };

/**
 * Records that the subject the window names now exists externally.
 *
 * IDEMPOTENT BY REFUSAL, not by overwrite. A second call for the same
 * experiment is `ALREADY_BOUND` even when it would write the identical value,
 * because "the external identity of what we measured" is a fact established
 * once; a function that rewrites it is a function that can be made to point a
 * past measurement at a different subject.
 */
export async function bindObservationSubject(
  userId: string,
  experimentId: string
): Promise<BindSubjectResult> {
  const experiment = await db.experiment.findFirst({
    where: { id: experimentId, userId },
    include: { commercialAction: true },
  });
  if (!experiment) {
    return { bound: false, reason: "EXPERIMENT_NOT_FOUND", detail: "No such experiment." };
  }
  if (experiment.observationSubjectExternalId !== null) {
    return {
      bound: false,
      reason: "ALREADY_BOUND",
      detail: "This experiment's subject is already confirmed. The external identity of what was measured is established once.",
    };
  }

  const action = experiment.commercialAction;
  if (!action) {
    return {
      bound: false,
      reason: "NO_INTERVENTION",
      detail: "This experiment declares no commercial intervention, so there is no external subject it created.",
    };
  }
  if (action.status !== "SUCCEEDED") {
    return {
      bound: false,
      reason: "NOT_APPLIED",
      detail:
        action.status === "UNKNOWN"
          ? "The intervention's outcome is UNKNOWN — it may or may not have been created. Confirming a subject from an unknown outcome would invent exactly the certainty the write port refuses to supply. Ask the store whether the code exists (observeCommercialAction) first."
          : `The intervention is ${action.status}, so no external subject has been confirmed.`,
    };
  }
  if (!action.externalId) {
    return {
      bound: false,
      reason: "NO_EXTERNAL_ID",
      detail: "The intervention SUCCEEDED and carries no external identifier, so there is nothing to confirm.",
    };
  }

  // ---- THE CONTRACT HAS TO NAME THIS INTERVENTION'S CODE -----------------
  const window = resolveObservationWindow(experiment);
  if (!window || !experiment.observationRule || !experiment.externalScope || !experiment.observationContractDigest) {
    return {
      bound: false,
      reason: "NO_CONTRACT",
      detail: "This experiment has no complete observation contract to attach a subject to.",
    };
  }
  if (experiment.observationSubject === null) {
    return {
      bound: false,
      reason: "SUBJECT_MISMATCH",
      detail:
        "This experiment's window measures the whole store over its window and names no subject. Attributing it to a code now would narrow a question that was already frozen without one.",
    };
  }

  const code = parseStoredParameters(action.parameters)?.code ?? null;
  if (code === null || code.trim().toLowerCase() !== experiment.observationSubject.trim().toLowerCase()) {
    return {
      bound: false,
      reason: "SUBJECT_MISMATCH",
      detail: `The applied intervention created ${code === null ? "an unreadable code" : `"${code}"`} and the window attributes to "${experiment.observationSubject}". One intervention cannot confirm another's subject.`,
    };
  }

  // The freeze, re-checked before anything is written. The subject is already
  // inside the stored digest, so a window edited since declaration fails here
  // rather than being confirmed against terms nobody approved.
  const current = observationContractDigestOf({
    rule: experiment.observationRule,
    scope: experiment.externalScope,
    windowStart: window.start,
    windowMinutes: window.minutes,
    subject: experiment.observationSubject,
  });
  if (current !== experiment.observationContractDigest) {
    return {
      bound: false,
      reason: "NO_CONTRACT",
      detail: "The observation contract changed after it was declared. Confirming a subject against altered terms would attach it to a question nobody froze.",
    };
  }

  // A conditional update on the column being set, so two concurrent binds
  // cannot both succeed — the same compare-and-set shape P5-G uses for the
  // execution claim rather than a check-then-write.
  const claimed = await db.experiment.updateMany({
    where: { id: experimentId, userId, observationSubjectExternalId: null },
    data: { observationSubjectExternalId: action.externalId },
  });
  if (claimed.count === 0) {
    return {
      bound: false,
      reason: "ALREADY_BOUND",
      detail: "Another call confirmed this subject first.",
    };
  }

  await recordEvent({
    userId,
    type: "economic.intervention.subject_bound",
    subjectType: "Experiment",
    subjectId: experimentId,
    consequential: true,
    payload: {
      commercialActionId: action.id,
      subject: experiment.observationSubject,
      externalId: action.externalId,
      executionRunId: action.executionRunId,
      executionStepId: action.executionStepId,
      note: "The declared window will now attribute only to orders carrying this code. Attribution over a window is not causation.",
    },
  });

  return { bound: true, subject: experiment.observationSubject, externalId: action.externalId };
}

export interface InterventionView {
  experimentId: string;
  /** The intervention, when one is declared. */
  action: {
    id: string;
    kind: string;
    status: string;
    externalScope: string;
    code: string | null;
    externalId: string | null;
    executionRunId: string | null;
    executionStepId: string | null;
    contractDigest: string;
  } | null;
  /** The subject the window attributes to, and whether it is confirmed. */
  observationSubject: string | null;
  observationSubjectExternalId: string | null;
  /** True when the window may be observed: no subject, or a confirmed one. */
  observable: boolean;
  /** Why not, when not. */
  blocker: string | null;
}

/** A read of the whole chain for one experiment, for a surface or an operator. */
export async function interventionState(
  userId: string,
  experimentId: string
): Promise<InterventionView | null> {
  const experiment = await db.experiment.findFirst({
    where: { id: experimentId, userId },
    include: { commercialAction: true },
  });
  if (!experiment) return null;

  const action = experiment.commercialAction;
  const needsSubject = experiment.observationSubject !== null;
  const confirmed = experiment.observationSubjectExternalId !== null;

  return {
    experimentId,
    action: action
      ? {
          id: action.id,
          kind: action.kind,
          status: action.status,
          externalScope: action.externalScope,
          code: parseStoredParameters(action.parameters)?.code ?? null,
          externalId: action.externalId,
          executionRunId: action.executionRunId,
          executionStepId: action.executionStepId,
          contractDigest: action.contractDigest,
        }
      : null,
    observationSubject: experiment.observationSubject,
    observationSubjectExternalId: experiment.observationSubjectExternalId,
    observable: !needsSubject || confirmed,
    blocker:
      !needsSubject || confirmed
        ? null
        : action === null
          ? "The window names a subject and no intervention is declared."
          : action.status === "SUCCEEDED"
            ? "The intervention succeeded and its subject has not been confirmed yet."
            : action.status === "UNKNOWN"
              ? "The intervention's outcome is UNKNOWN. Ask the store whether the code exists before anything is attributed to it."
              : `The intervention is ${action.status}, so its subject does not exist to be measured.`,
  };
}
