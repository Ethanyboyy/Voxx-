/**
 * [P6-G] WHAT STANDS BETWEEN VOX AND ITS FIRST REAL COMMERCIAL ACTION.
 *
 * READ-ONLY, LOCAL, AND IT MAKES NO EXTERNAL CALL. That is the central design
 * decision and it is worth stating plainly: a diagnostic that reached out to
 * Shopify to prove the token still works would itself be the live external
 * call it is supposed to be checking the preconditions for. Every stage below
 * is answerable from VOX's own rows.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS WHEN EVERY PIECE ALREADY DID
 * ---------------------------------------------------------------------------
 *
 * All six answers were already derivable before P6-G — from
 * `resolveConnectionCredential()`, `checkCapability()`, the `CommercialAction`
 * row, `interventionState()` and the `ApprovalGrant` table. What did not exist
 * was one question with one answer. Finding out why a live run could not
 * proceed meant knowing which five modules to interrogate and in what order,
 * and the order is not obvious: an ungranted capability and an unconnected
 * store produce different instructions, and asking them the wrong way round
 * tells an operator to fix the second thing first.
 *
 * So this is a composition, not a mechanism. It duplicates nothing: every
 * stage calls the existing function and reports what it said.
 *
 * ---------------------------------------------------------------------------
 * THE STAGES ARE ORDERED, AND THE FIRST UNMET ONE IS THE ANSWER
 * ---------------------------------------------------------------------------
 *
 * Reporting every unmet precondition at once would read as five problems when
 * there is one next step. The stages are strictly ordered by what has to be
 * true first, and the result names the earliest thing that is not.
 *
 * ---------------------------------------------------------------------------
 * AND IT NEVER RETURNS THE TOKEN
 * ---------------------------------------------------------------------------
 *
 * Not the token, not a prefix of it, not its length, not a hash. The shop
 * domain is returned because it is public and an operator needs to see WHICH
 * store is about to be written to — and that is the only thing about the
 * credential that comes back. `tests/p6-g-live-readiness.test.ts` asserts the
 * serialized result contains no part of the token.
 */

import { db } from "@/lib/db";
import { checkCapability } from "@/lib/permissions/service";
import { resolveConnectionCredential } from "@/lib/integrations/economic";
import { CREATE_DISCOUNT_TOOL } from "@/lib/commerce/execute";
import { SHOPIFY_WRITE_SCOPE } from "@/lib/integrations/shopifyCommerce";
import { parseStoredParameters } from "@/lib/commerce/contract";

/** The capability a live commercial write answers to. Unchanged by P6-G. */
export const LIVE_WRITE_CAPABILITY = "integration.shopify.write";

export type LiveReadinessState =
  /**
   * No Shopify store is connected, or the connection is not CONNECTED.
   *
   * THE STATE THIS REPOSITORY IS IN. There is no environment variable path and
   * no autonomous acquisition path: the only way in is a merchant pasting a
   * custom-app Admin API token into `connectShopifyStore()`, which then proves
   * it with a real authenticated read before storing anything.
   */
  | "CREDENTIAL_MISSING"
  /**
   * A connection exists and its credential cannot be used.
   *
   * Read access not granted, no credential row, or a payload that does not
   * decrypt. NOT "the token was rejected by Shopify" — establishing that needs
   * a live call, which this function does not make. Liveness was proven once,
   * at connect time, and is not re-proven here.
   */
  | "CREDENTIAL_INVALID"
  /** The account has not granted `integration.shopify.write` at ACT. */
  | "PERMISSION_INSUFFICIENT"
  /**
   * The store is reachable and the capability is granted, and there is no
   * frozen intervention to execute. The live path is open and nothing is
   * queued on it.
   */
  | "LIVE_CONNECTED"
  /**
   * A frozen intervention exists and no matching `ApprovalGrant` does.
   *
   * The expected resting state of a correctly-gated system: VOX has prepared
   * exactly one bounded action and is waiting for a person. Reaching this state
   * is success, not failure.
   */
  | "AUTHORIZATION_REQUIRED"
  /**
   * Everything is in place. THE NEXT EXECUTION WOULD WRITE TO A REAL STORE.
   *
   * Reported, never acted on. This function performs no write and starts no
   * run; it says that the gates would now open.
   */
  | "READY_FOR_LIVE_EXECUTION";

export interface LiveReadinessStage {
  stage: string;
  met: boolean;
  /** What is true, or what to do about it. Never a secret. */
  detail: string;
}

export interface LiveReadiness {
  state: LiveReadinessState;
  /** Every stage in order, so the answer is inspectable rather than asserted. */
  stages: LiveReadinessStage[];
  /** The shop domain, which is public. The ONLY credential detail returned. */
  shopDomain: string | null;
  /** Whether the operator declared the write scope at connect time. */
  writeScopeDeclared: boolean;
  /** The frozen intervention awaiting authorization or execution, if any. */
  pendingAction: {
    actionId: string;
    experimentId: string | null;
    code: string | null;
    contractDigest: string;
    status: string;
  } | null;
  /** The single next thing a person should do. */
  nextStep: string;
  /** Limits that remain true whatever the state. */
  caveats: string[];
}

function stage(name: string, met: boolean, detail: string): LiveReadinessStage {
  return { stage: name, met, detail };
}

/**
 * The preflight.
 *
 * Returns the earliest unmet precondition and the instruction for it. Makes no
 * external call, writes nothing, and authorizes nothing.
 */
export async function liveReadiness(userId: string): Promise<LiveReadiness> {
  const stages: LiveReadinessStage[] = [];
  const caveats = [
    "Gross order value is not profit: it excludes refunds, chargebacks, cost of goods and fees.",
    "Orders carrying an intervention's code are redemptions, not evidence the code caused the purchase.",
    "A declared write scope is declared by the operator, not proven — VOX cannot prove a write scope without performing a write.",
  ];

  // ---- 1. THE CONNECTION -------------------------------------------------
  const connection = await db.connection.findFirst({
    where: { userId, service: "SHOPIFY" },
    // `credential` is included to test for PRESENCE only. No field of it is
    // read, returned or logged.
    include: { credential: { select: { id: true } } },
  });

  if (!connection || connection.status !== "CONNECTED") {
    stages.push(
      stage(
        "connection",
        false,
        connection
          ? `A Shopify connection exists and is ${connection.status}, not CONNECTED.`
          : "No Shopify store is connected."
      )
    );
    return {
      state: "CREDENTIAL_MISSING",
      stages,
      // NULL, not a guess. The shop domain lives inside the encrypted
      // credential payload and is only available once it resolves — which is
      // the next stage. Reporting a domain we have not read would be
      // reporting which store is about to be written to without knowing.
      shopDomain: null,
      writeScopeDeclared: false,
      pendingAction: null,
      nextStep:
        "Connect one store: create a custom app in the Shopify admin with read_orders and write_discounts, then pass its Admin API access token to connectShopifyStore(). VOX performs a real authenticated read before it calls the connection connected, so a token that does not work never gets stored.",
      caveats,
    };
  }
  stages.push(stage("connection", true, "A Shopify connection exists and is CONNECTED."));

  // ---- 2. THE CREDENTIAL RESOLVES ----------------------------------------
  //
  // Through the SAME function the observation path uses, so this diagnostic
  // cannot be more optimistic than the code that actually reads the store.
  const resolution = await resolveConnectionCredential(userId, "SHOPIFY");
  if (!resolution.resolved) {
    stages.push(stage("credential", false, resolution.detail));
    return {
      // NOT_CONFIGURED from here means the connection moved underneath us;
      // anything else is a credential that exists and cannot be used.
      state: resolution.failure === "NOT_CONFIGURED" ? "CREDENTIAL_MISSING" : "CREDENTIAL_INVALID",
      stages,
      shopDomain: null,
      writeScopeDeclared: false,
      pendingAction: null,
      nextStep: resolution.detail,
      caveats,
    };
  }

  const shopDomain = resolution.credential.scope;
  const grantedScope = resolution.credential.grantedScope ?? "";
  const writeScopeDeclared = grantedScope.includes(SHOPIFY_WRITE_SCOPE);
  stages.push(stage("credential", true, "The stored credential resolves and decrypts."));
  stages.push(
    stage(
      "write scope declared",
      writeScopeDeclared,
      writeScopeDeclared
        ? `The operator declared ${SHOPIFY_WRITE_SCOPE} on this connection.`
        : `This connection does not declare ${SHOPIFY_WRITE_SCOPE}. The write path refuses before sending anything.`
    )
  );

  // ---- 3. THE CAPABILITY -------------------------------------------------
  const capability = await checkCapability(userId, LIVE_WRITE_CAPABILITY, "ACT");
  stages.push(
    stage(
      "capability",
      capability.allowed,
      capability.allowed
        ? `${LIVE_WRITE_CAPABILITY} is granted at ${capability.effectiveLevel}.`
        : `${LIVE_WRITE_CAPABILITY} is at ${capability.effectiveLevel}${capability.isDefault ? " (the default, never granted)" : ""} and ACT is required.`
    )
  );
  if (!capability.allowed || !writeScopeDeclared) {
    return {
      state: "PERMISSION_INSUFFICIENT",
      stages,
      shopDomain,
      writeScopeDeclared,
      pendingAction: null,
      nextStep: !capability.allowed
        ? `Grant ${LIVE_WRITE_CAPABILITY} at ACT. It is above the default band on purpose, so an account that has granted nothing cannot reach the write tool at all.`
        : `Reconnect the store declaring ${SHOPIFY_WRITE_SCOPE}, or the write will refuse before anything is sent.`,
      caveats,
    };
  }

  // ---- 4. A FROZEN INTERVENTION TO EXECUTE -------------------------------
  const pending = await db.commercialAction.findFirst({
    where: { userId, status: "PLANNED" },
    orderBy: { createdAt: "desc" },
  });
  if (!pending) {
    stages.push(stage("intervention", false, "No frozen intervention is waiting to be executed."));
    return {
      state: "LIVE_CONNECTED",
      stages,
      shopDomain,
      writeScopeDeclared,
      pendingAction: null,
      nextStep:
        "Declare one bounded intervention with declareCommercialAction(), then declare the observation window naming that code as its subject. Nothing is sent until a person approves the step.",
      caveats,
    };
  }

  const pendingAction = {
    actionId: pending.id,
    experimentId: pending.experimentId,
    code: parseStoredParameters(pending.parameters)?.code ?? null,
    contractDigest: pending.contractDigest,
    status: pending.status,
  };
  stages.push(stage("intervention", true, `One frozen intervention is planned against ${pending.externalScope}.`));

  // ---- 5. THE ARGUMENT-BOUND GRANT ---------------------------------------
  //
  // Presence only. Whether a grant MATCHES is decided by `matchesApproval()`
  // at execution time, against the hash of the validated arguments — and
  // re-deciding it here would be a second answer to the one question the
  // authorization boundary exists to answer.
  const grant = await db.approvalGrant.findFirst({
    where: { userId, actionId: CREATE_DISCOUNT_TOOL, consumedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, createdAt: true },
  });
  if (!grant) {
    stages.push(stage("authorization", false, "No unconsumed approval exists for the write tool."));
    return {
      state: "AUTHORIZATION_REQUIRED",
      stages,
      shopDomain,
      writeScopeDeclared,
      pendingAction,
      nextStep:
        "Dispatch the intervention through the executor and approve the step it parks at. The grant binds the hash of the validated arguments, so the parameters cannot move between approval and execution.",
      caveats,
    };
  }
  stages.push(
    stage(
      "authorization",
      true,
      "An unconsumed approval for the write tool exists. Whether it matches these exact arguments is decided at execution by matchesApproval()."
    )
  );

  return {
    state: "READY_FOR_LIVE_EXECUTION",
    stages,
    shopDomain,
    writeScopeDeclared,
    pendingAction,
    nextStep: `Executing this step would create discount code ${pendingAction.code ?? "(unreadable)"} in ${shopDomain}. That is a real change to a real store. Nothing here performs it.`,
    caveats,
  };
}
