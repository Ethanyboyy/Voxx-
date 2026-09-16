/**
 * [P5-E] THE DECLARED-WINDOW OBSERVATION.
 *
 * The service layer between the evidence loop and the integration port. Its job
 * is to refuse, in a specific order, everything that would make an external
 * answer mean something other than what the experiment asked.
 *
 * Nothing here executes anything. It is called BY a registered tool, which is
 * called by the executor, which performed the capability check and the policy
 * enforcement first. There is no path into this module that skips those.
 */

import { db } from "@/lib/db";
import {
  getEconomicProvider,
  resolveConnectionCredential,
  type ObservationOutcome,
  type ObservationRefusal,
  type ObservationFailure,
  type OrderCountQuery,
  type EconomicObservationProvider,
} from "@/lib/integrations/economic";
import { SHOPIFY_REQUIRED_SCOPE } from "@/lib/integrations/shopify";
import {
  classifyWindowTiming,
  observationContractDigestOf,
  resolveObservationWindow,
} from "@/lib/economic/observationContract";

export const EXTERNAL_ORDER_COUNT_RULE = "EXTERNAL_ORDER_COUNT";

/** The provider an external rule reads. One, deliberately. */
const PROVIDER_ID = "shopify";

function refusal(failure: ObservationFailure, detail: string): ObservationRefusal {
  return { observed: false, failure, detail, provider: PROVIDER_ID, attemptedAt: new Date() };
}

type WindowGate =
  | { open: true; provider: EconomicObservationProvider; query: OrderCountQuery }
  | { open: false; refusal: ObservationRefusal };

/**
 * Every check that must pass before a store is asked anything, in order.
 *
 * ORDER IS LOAD-BEARING. The contract is verified before the credential is
 * decrypted, and the window timing before the network call — so a request that
 * could never produce a valid measurement never reaches the provider, and a
 * secret is never decrypted for a question that was going to be refused anyway.
 */
async function openDeclaredWindow(userId: string, experimentId: string, expectedRule: string): Promise<WindowGate> {
  const experiment = await db.experiment.findFirst({ where: { id: experimentId, userId } });
  if (!experiment) {
    return { open: false, refusal: refusal("NO_CONTRACT", "No such experiment.") };
  }

  // The rule on the experiment must be the rule being asked for. Without this,
  // a tool could be pointed at an experiment that declared something else, and
  // the answer would be recorded against a contract it does not match.
  if (experiment.observationRule !== expectedRule) {
    return {
      open: false,
      refusal: refusal("NO_CONTRACT", "This experiment does not declare this observation rule."),
    };
  }

  const window = resolveObservationWindow(experiment);
  if (!window || !experiment.externalScope || !experiment.observationContractDigest) {
    return {
      open: false,
      refusal: refusal(
        "NO_CONTRACT",
        "This experiment has no complete external observation contract. The store, the window and the rule all have to be declared before the store is asked."
      ),
    };
  }

  // ---- THE FREEZE, CHECKED --------------------------------------------------
  //
  // Re-derived from the experiment's CURRENT terms and compared to the digest
  // stamped at dispatch. If someone widened the window or repointed the store
  // after dispatch, the terms no longer hash to the stamp and the store is not
  // asked at all.
  const current = observationContractDigestOf({
    rule: experiment.observationRule,
    scope: experiment.externalScope,
    windowStart: window.start,
    windowMinutes: window.minutes,
  });
  if (current !== experiment.observationContractDigest) {
    return {
      open: false,
      refusal: refusal(
        "CONTRACT_ALTERED",
        "The observation rule, store or window changed after this experiment was dispatched. Asking now would answer a different question from the one the experiment declared."
      ),
    };
  }

  const timing = classifyWindowTiming(window, new Date());
  if (timing === "WINDOW_NOT_CLOSED") {
    return {
      open: false,
      refusal: refusal(
        "WINDOW_NOT_CLOSED",
        "The declared window has not finished. A count taken now would describe a partial period and would be systematically low."
      ),
    };
  }
  if (timing === "WINDOW_EXPIRED") {
    return {
      open: false,
      refusal: refusal(
        "WINDOW_EXPIRED",
        "The declared window closed too long ago. A store's record of a past period moves — orders are cancelled, edited and archived — so the answer now would not be the answer then."
      ),
    };
  }

  const resolution = await resolveConnectionCredential(userId, "SHOPIFY");
  if (!resolution.resolved) {
    return { open: false, refusal: refusal(resolution.failure, resolution.detail) };
  }

  // THE STORE THE EXPERIMENT DECLARED MUST BE THE STORE THAT IS CONNECTED.
  //
  // Without this, an experiment could declare one shop, the user could connect a
  // different one, and the measurement would carry the declared scope while
  // holding the other store's number.
  if (resolution.credential.scope !== experiment.externalScope) {
    return {
      open: false,
      refusal: refusal(
        "CONTRACT_ALTERED",
        "The connected store is not the store this experiment declared. No number was obtained."
      ),
    };
  }

  if (
    resolution.credential.grantedScope &&
    !resolution.credential.grantedScope.includes(SHOPIFY_REQUIRED_SCOPE)
  ) {
    return {
      open: false,
      refusal: refusal(
        "CREDENTIAL_INVALID",
        `The stored credential does not carry the ${SHOPIFY_REQUIRED_SCOPE} scope.`
      ),
    };
  }

  const provider = getEconomicProvider(PROVIDER_ID);
  if (!provider) {
    return { open: false, refusal: refusal("NOT_CONFIGURED", "No economic observation provider is registered.") };
  }

  return {
    open: true,
    provider,
    query: {
      scope: resolution.credential.scope,
      accessToken: resolution.credential.accessToken,
      windowStart: window.start,
      windowEnd: window.end,
    },
  };
}

/**
 * Asks the declared store how many orders it recorded inside the declared window.
 *
 * Returns an outcome, never throws for a refusal, and the refusal arm carries no
 * value — so the caller cannot turn "no answer" into a zero even by accident.
 */
export async function observeDeclaredOrderWindow(
  userId: string,
  experimentId: string
): Promise<ObservationOutcome> {
  const gate = await openDeclaredWindow(userId, experimentId, EXTERNAL_ORDER_COUNT_RULE);
  if (!gate.open) return gate.refusal;
  return gate.provider.countOrdersInWindow(gate.query);
}

export interface DeclareContractInput {
  userId: string;
  experimentId: string;
  rule: string;
  /** The shop domain. Stored in the clear — it is not a secret. */
  externalScope: string;
  /** INCLUSIVE lower bound. */
  windowStart: Date;
  windowMinutes: number;
}

export type DeclareRefusal =
  | "NOT_FOUND"
  /** Already dispatched. Declaring the question after the run is the thing this prevents. */
  | "ALREADY_DISPATCHED"
  | "INVALID_WINDOW"
  | "INVALID_SCOPE";

export type DeclareResult =
  | { declared: true; digest: string; windowStart: Date; windowEnd: Date }
  | { declared: false; reason: DeclareRefusal };

/**
 * Freezes the question BEFORE the experiment runs.
 *
 * Refuses once an execution identity exists. That refusal is the entire point of
 * the module: after dispatch, changing the window or the store is choosing the
 * question with the answer already in view.
 */
export async function declareObservationContract(input: DeclareContractInput): Promise<DeclareResult> {
  const { userId, experimentId } = input;

  const experiment = await db.experiment.findFirst({ where: { id: experimentId, userId } });
  if (!experiment) return { declared: false, reason: "NOT_FOUND" };
  if (experiment.executionRunId !== null) return { declared: false, reason: "ALREADY_DISPATCHED" };

  const probe = resolveObservationWindow({
    observationWindowStart: input.windowStart,
    observationWindowMinutes: input.windowMinutes,
  });
  if (!probe) return { declared: false, reason: "INVALID_WINDOW" };
  if (input.externalScope.trim().length === 0) return { declared: false, reason: "INVALID_SCOPE" };

  const digest = observationContractDigestOf({
    rule: input.rule,
    scope: input.externalScope,
    windowStart: probe.start,
    windowMinutes: probe.minutes,
  });

  await db.experiment.update({
    where: { id: experimentId },
    data: {
      observationRule: input.rule,
      externalScope: input.externalScope,
      observationWindowStart: probe.start,
      observationWindowMinutes: probe.minutes,
      observationContractDigest: digest,
    },
  });

  return { declared: true, digest, windowStart: probe.start, windowEnd: probe.end };
}
