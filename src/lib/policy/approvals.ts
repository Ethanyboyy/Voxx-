/**
 * P4-B — ARGUMENT-BOUND, SINGLE-USE APPROVAL GRANTS.
 *
 * WHAT WAS WRONG. Approving something in VOX has meant granting a CAPABILITY:
 * a human grants `workspace.write` at ACT, and from then on every write is
 * authorized — any path, any content, forever, however many times. The P4 audit
 * spelled out what that permits. An approval can be replayed. It can be reused.
 * One approval authorizes unboundedly many actions. And on the agent path the
 * arguments are not even settled when the human sees them: the executor
 * resolves `{{stepN.output}}` references at EXECUTION time
 * (src/lib/agents/executor.ts), after the pause, so what was approved and what
 * runs are two different objects.
 *
 * WHAT A GRANT IS. Permission to perform ONE action, with THESE arguments,
 * under THIS classification, ONCE, before a stated time. Everything that could
 * drift between showing a person an action and performing it is pinned:
 *
 *   actionId + registry      what it is
 *   argumentsHash            what it will be called with
 *   classificationHash       what VOX understood it to do
 *   policyDecision           what the person was actually shown
 *   capability + level       the authorization it was issued against
 *   amplification            how many underlying calls it covers
 *   trustLabels              the provenance disclosed at the time
 *   target                   the entity it concerns
 *   expiresAt                after which it is worth nothing
 *   consumedAt               after which it is spent
 *
 * NOTHING HERE IS ENFORCED. No caller consumes a grant. `agents/executor.ts` is
 * untouched, `recordShadowPolicyEvaluation()` still returns void, and a HOLD
 * still executes. P4-C is the phase that makes a HOLD require a grant. The
 * primitive is built first deliberately: the phase that starts blocking
 * execution should not also be the phase inventing the thing it blocks on.
 *
 * THE PERMISSION SYSTEM IS UNCHANGED and remains the only source of truth for
 * whether a capability is held. A grant records WHAT WAS SHOWN so it cannot be
 * matched against a different requirement; it never asserts that the capability
 * is granted, and it cannot grant one.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { canonicalHash, hashArguments } from "@/lib/policy/canonical";
import { evaluatePolicy, type PolicyDecision } from "@/lib/policy/gate";
import { classifyAction, type ActionClassification, type ActionRegistry } from "@/lib/policy/classification";
import type { ApprovalGrant } from "@/generated/prisma/client";
import type { CapabilityLevel } from "@/generated/prisma/enums";

export { hashArguments };

/**
 * How long a grant is worth anything.
 *
 * Fifteen minutes, which is short on purpose. `src/lib/auth/session.ts` uses 30
 * days, and that is the right order of magnitude for "this person is logged in"
 * and the wrong one entirely for "this person looked at this specific action and
 * said yes". The longer a grant lives the more the world it was approved
 * against has moved on — files change, balances change, the plan changes — and
 * an approval that outlives its context is the stale-approval finding the audit
 * raised, not a convenience.
 */
export const DEFAULT_APPROVAL_TTL_MS = 15 * 60 * 1000;

/**
 * The longest TTL any caller may ask for. A ceiling rather than a default,
 * because "make it last longer" is the pressure this design exists to resist.
 */
export const MAX_APPROVAL_TTL_MS = 60 * 60 * 1000;

/**
 * The classification snapshot a grant binds to.
 *
 * Every field of `ActionClassification` is included, not a chosen subset: each
 * one changes what the action is understood to do, and a human approving
 * "irreversible, financial, internal ledger" has not approved "irreversible,
 * financial, external system of record" — that single boolean is the difference
 * between HOLD and DENY (see P4-A). The identity fields are here for the same
 * reason `registry` is a column: `task.create` exists in BOTH registries with
 * identical classifications, so without the registry the two would hash the
 * same and an approval for a proposal would satisfy a tool call.
 *
 * The evaluated decision and its reason codes are included too. They are
 * derived from the classification, so they cannot disagree with it — but they
 * also move when the MATRIX moves, and a policy amendment that changes what an
 * action would be decided as must invalidate approvals taken under the old one.
 * P4-A changing one cell is exactly that case.
 */
export interface ClassificationSnapshot {
  registry: ActionRegistry;
  actionId: string;
  effect: string;
  reversibility: string;
  financial: boolean;
  untrustedOutput: boolean;
  externalSystemOfRecord: boolean;
  decision: PolicyDecision;
  reasonCodes: string[];
}

/** Builds the snapshot from a classification, without consulting anything else. */
export function classificationSnapshot(
  registry: ActionRegistry,
  actionId: string,
  classification: ActionClassification
): ClassificationSnapshot {
  const evaluation = evaluatePolicy({ action: classification });
  return {
    registry,
    actionId,
    effect: classification.effect,
    reversibility: classification.reversibility,
    financial: classification.financial,
    untrustedOutput: classification.untrustedOutput,
    externalSystemOfRecord: classification.externalSystemOfRecord,
    decision: evaluation.decision,
    // Sorted so an incidental change to the order rules push in cannot
    // invalidate every outstanding approval. Order is not semantic; membership is.
    reasonCodes: [...evaluation.reasonCodes].sort(),
  };
}

/** SHA-256 (hex) of a classification snapshot. */
export function hashClassification(snapshot: ClassificationSnapshot): string {
  return canonicalHash(snapshot);
}

/**
 * The snapshot and hash for a registered action, looked up rather than supplied.
 *
 * Preferred over building a snapshot by hand: the classification comes from the
 * frozen table, so a caller cannot describe an action as something milder than
 * it is. Returns null for an unregistered action — an approval for something
 * VOX has never classified would be an approval of nothing.
 */
export function hashRegisteredClassification(
  registry: ActionRegistry,
  actionId: string
): { snapshot: ClassificationSnapshot; hash: string } | null {
  const { classification, known } = classifyAction(registry, actionId);
  if (!known) return null;
  const snapshot = classificationSnapshot(registry, actionId, classification);
  return { snapshot, hash: hashClassification(snapshot) };
}

export interface CreateApprovalGrantInput {
  userId: string;
  registry: ActionRegistry;
  actionId: string;
  /** The VALIDATED arguments. Hashed here so no caller can pass a stale hash. */
  parsedArguments: unknown;
  /** What the human was shown. Recorded as history, never recomputed later. */
  policyDecision: PolicyDecision;
  capability: string;
  requiredLevel: CapabilityLevel;
  /**
   * How many underlying calls this approval covers.
   *
   * P4-F is the phase that DERIVES this from the arguments (`count` on an image
   * generation, `maxIterations` on a refine loop) and enforces it. Until then it
   * is whatever the caller declares, defaults to one, and nothing reads it at
   * execution time. Deliberately not inferred here: a derivation written in this
   * phase would be a second amplification system for P4-F to reconcile with.
   */
  amplification?: number;
  /**
   * Provenance disclosed to the approver, as a snapshot.
   *
   * NOT the P4-G TrustLabel lattice, which does not exist. This is a record of
   * what a person was told; P4-G will be what has something true to put in it.
   */
  trustLabels?: string[];
  targetType?: string;
  targetId?: string;
  /** Clamped to {@link MAX_APPROVAL_TTL_MS}. Defaults to {@link DEFAULT_APPROVAL_TTL_MS}. */
  ttlMs?: number;
  /** Injectable for tests; production callers use the default. */
  now?: Date;
}

/**
 * Issues a grant.
 *
 * EXECUTES NOTHING. Creating a grant is a record that a person said yes; it
 * does not run the action, does not grant a permission, and does not change any
 * run's state. That separation is the whole point — P4-C will be the code that
 * turns a grant into permission to proceed.
 */
export async function createApprovalGrant(input: CreateApprovalGrantInput): Promise<ApprovalGrant> {
  const classified = hashRegisteredClassification(input.registry, input.actionId);
  if (!classified) {
    throw new Error(
      `Cannot approve "${input.actionId}": it is not registered in the ${input.registry} classification table, so there is nothing to bind an approval to.`
    );
  }

  const now = input.now ?? new Date();
  const ttlMs = Math.min(Math.max(1, input.ttlMs ?? DEFAULT_APPROVAL_TTL_MS), MAX_APPROVAL_TTL_MS);
  const amplification = Math.max(1, Math.trunc(input.amplification ?? 1));

  const grant = await db.approvalGrant.create({
    data: {
      userId: input.userId,
      registry: input.registry,
      actionId: input.actionId,
      argumentsHash: hashArguments(input.parsedArguments),
      classificationHash: classified.hash,
      policyDecision: input.policyDecision,
      capability: input.capability,
      requiredLevel: input.requiredLevel,
      amplification,
      trustLabels: input.trustLabels ? JSON.stringify(input.trustLabels) : null,
      targetType: input.targetType,
      targetId: input.targetId,
      expiresAt: new Date(now.getTime() + ttlMs),
    },
  });

  await recordEvent({
    userId: input.userId,
    type: "policy.approval_granted",
    subjectType: "ApprovalGrant",
    subjectId: grant.id,
    consequential: true,
    // Hashes and enums only. The arguments themselves are never recorded here —
    // they may hold file contents or a prompt, and the hash is what the audit
    // trail actually needs.
    payload: {
      registry: grant.registry,
      actionId: grant.actionId,
      argumentsHash: grant.argumentsHash,
      classificationHash: grant.classificationHash,
      policyDecision: grant.policyDecision,
      capability: grant.capability,
      requiredLevel: grant.requiredLevel,
      amplification: grant.amplification,
      expiresAt: grant.expiresAt.toISOString(),
    },
  });

  return grant;
}

/** Why a grant did not match. Codes, so a caller never parses prose. */
export type ApprovalMismatchReason =
  | "WRONG_USER"
  | "WRONG_REGISTRY"
  | "WRONG_ACTION"
  | "ARGUMENTS_CHANGED"
  | "CLASSIFICATION_CHANGED"
  | "WRONG_CAPABILITY"
  | "WRONG_REQUIRED_LEVEL"
  | "AMPLIFICATION_EXCEEDED"
  | "WRONG_TARGET"
  | "EXPIRED"
  | "ALREADY_CONSUMED";

export interface ApprovalMatchInput {
  userId: string;
  registry: ActionRegistry;
  actionId: string;
  argumentsHash: string;
  classificationHash: string;
  capability: string;
  requiredLevel: CapabilityLevel;
  /** How many calls the caller intends. Must not exceed what was approved. */
  amplification?: number;
  targetType?: string;
  targetId?: string;
  now?: Date;
}

export interface ApprovalMatch {
  matches: boolean;
  /** Every reason it failed, not just the first — an audit wants all of them. */
  reasons: ApprovalMismatchReason[];
}

/**
 * Whether a grant authorizes an intended action. Pure: reads nothing, writes
 * nothing, consumes nothing.
 *
 * NOT CALLED FROM THE EXECUTOR. This is the primitive P4-C will use.
 *
 * On `requiredLevel` the comparison is EXACT rather than "at least". A
 * rank-based comparison would need a second copy of the
 * OBSERVE < ANALYZE < RECOMMEND < ASK < ACT ladder living here, and a duplicated
 * ladder is the drift `src/lib/capabilities/types.ts` refused a second
 * permission vocabulary to avoid. Exact equality needs no ladder, and it fails
 * closed: an approval shown for one level never silently covers another.
 */
export function matchesApproval(grant: ApprovalGrant, input: ApprovalMatchInput): ApprovalMatch {
  const now = input.now ?? new Date();
  const reasons: ApprovalMismatchReason[] = [];

  if (grant.userId !== input.userId) reasons.push("WRONG_USER");
  if (grant.registry !== input.registry) reasons.push("WRONG_REGISTRY");
  if (grant.actionId !== input.actionId) reasons.push("WRONG_ACTION");
  if (grant.argumentsHash !== input.argumentsHash) reasons.push("ARGUMENTS_CHANGED");
  if (grant.classificationHash !== input.classificationHash) reasons.push("CLASSIFICATION_CHANGED");
  if (grant.capability !== input.capability) reasons.push("WRONG_CAPABILITY");
  if (grant.requiredLevel !== input.requiredLevel) reasons.push("WRONG_REQUIRED_LEVEL");
  if ((input.amplification ?? 1) > grant.amplification) reasons.push("AMPLIFICATION_EXCEEDED");
  if (grant.consumedAt !== null) reasons.push("ALREADY_CONSUMED");
  if (grant.expiresAt.getTime() <= now.getTime()) reasons.push("EXPIRED");

  // A grant that named a target is bound to it. A grant that named none places
  // no target constraint — it was issued without one, so it cannot be checked
  // against one, and pretending otherwise would be inventing a binding.
  if (grant.targetType !== null && grant.targetType !== (input.targetType ?? null)) reasons.push("WRONG_TARGET");
  else if (grant.targetId !== null && grant.targetId !== (input.targetId ?? null)) reasons.push("WRONG_TARGET");

  return { matches: reasons.length === 0, reasons };
}

export type ApprovalConsumptionFailure = "NOT_FOUND" | "ALREADY_CONSUMED" | "EXPIRED";

export type ApprovalConsumption =
  | { consumed: true; grant: ApprovalGrant }
  | { consumed: false; reason: ApprovalConsumptionFailure };

/**
 * Spends a grant, once.
 *
 * THE WHOLE THING IS ONE CONDITIONAL UPDATE. The WHERE clause repeats every
 * condition that makes consumption legal — right user, unconsumed, unexpired —
 * so the check and the write cannot come apart. A read-then-write pair has a
 * window between them no matter how tight, and two requests inside that window
 * would both see `consumedAt: null` and both proceed, which is precisely the
 * replay this model exists to prevent. This is the same compare-and-swap shape
 * `src/lib/economic/scheduler.ts` uses to claim a tick, for the same reason.
 *
 * `count !== 1` is the refusal. The re-read afterwards is ADVISORY — it exists
 * only to say WHICH condition failed, and the refusal has already happened
 * atomically above whatever it reports.
 *
 * NOT CALLED FROM THE EXECUTOR. P4-C will be what calls this.
 */
export async function consumeApprovalGrant(
  userId: string,
  grantId: string,
  now: Date = new Date()
): Promise<ApprovalConsumption> {
  const claimed = await db.approvalGrant.updateMany({
    where: { id: grantId, userId, consumedAt: null, expiresAt: { gt: now } },
    data: { consumedAt: now },
  });

  if (claimed.count !== 1) {
    const existing = await db.approvalGrant.findFirst({ where: { id: grantId, userId } });
    if (!existing) return { consumed: false, reason: "NOT_FOUND" };
    // Consumption is checked first: a grant that was spent and has since expired
    // was spent, and saying "expired" would misreport what happened to it.
    if (existing.consumedAt !== null) return { consumed: false, reason: "ALREADY_CONSUMED" };
    return { consumed: false, reason: "EXPIRED" };
  }

  const grant = await db.approvalGrant.findUniqueOrThrow({ where: { id: grantId } });

  await recordEvent({
    userId,
    type: "policy.approval_consumed",
    subjectType: "ApprovalGrant",
    subjectId: grant.id,
    consequential: true,
    payload: {
      registry: grant.registry,
      actionId: grant.actionId,
      argumentsHash: grant.argumentsHash,
      classificationHash: grant.classificationHash,
      policyDecision: grant.policyDecision,
      amplification: grant.amplification,
    },
  });

  return { consumed: true, grant };
}

export interface ApprovalShadowInput extends ApprovalMatchInput {
  /** Descriptive-only, for the audit record. */
  runId?: string;
  stepId?: string;
}

export interface ApprovalShadowResult {
  /** Whether a live grant authorizes this exact execution. */
  wouldAuthorize: boolean;
  /** The grant that matched, if one did. */
  grantId: string | null;
  /** How many live grants for this action were considered. */
  candidatesConsidered: number;
  /**
   * Why authorization failed. `NO_GRANT` when the user holds none for this
   * action at all; otherwise the mismatch reasons of the closest candidate.
   */
  reasons: (ApprovalMismatchReason | "NO_GRANT")[];
}

/**
 * [P4-C1] What enforcement WOULD do, without doing any of it.
 *
 * Runs the real matching semantics against the user's real live grants, and
 * **deliberately does not consume anything**. Consuming here would spend a
 * human's approval on an execution that is not being gated by it, which would
 * destroy the very thing P4-C2 needs intact.
 *
 * So this reads and compares. It is the observation half of the gate; the
 * enforcing half — consume-then-execute — is P4-C2's, and until a human
 * approval act exists there is nothing honest for it to enforce against.
 */
export async function evaluateApprovalForExecution(input: ApprovalShadowInput): Promise<ApprovalShadowResult> {
  const now = input.now ?? new Date();
  const candidates = await db.approvalGrant.findMany({
    where: {
      userId: input.userId,
      registry: input.registry,
      actionId: input.actionId,
      consumedAt: null,
      expiresAt: { gt: now },
    },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
  });

  let closest: ApprovalMismatchReason[] | null = null;
  for (const grant of candidates) {
    const result = matchesApproval(grant, { ...input, now });
    if (result.matches) {
      return { wouldAuthorize: true, grantId: grant.id, candidatesConsidered: candidates.length, reasons: [] };
    }
    // Fewest mismatches = the nearest miss, which is the most useful thing to
    // report to whoever is reading why an approval did not apply.
    if (closest === null || result.reasons.length < closest.length) closest = result.reasons;
  }

  return {
    wouldAuthorize: false,
    grantId: null,
    candidatesConsidered: candidates.length,
    reasons: closest ?? ["NO_GRANT"],
  };
}

/**
 * A user's live grants — unconsumed and unexpired.
 *
 * Read-only, and deliberately NOT part of the P3 `PendingApproval` projection:
 * that projection answers "what is waiting for a decision", and these are
 * decisions already made. Merging them would blur a real distinction.
 */
export async function listLiveApprovalGrants(userId: string, now: Date = new Date()): Promise<ApprovalGrant[]> {
  return db.approvalGrant.findMany({
    where: { userId, consumedAt: null, expiresAt: { gt: now } },
    orderBy: [{ expiresAt: "asc" }, { id: "asc" }],
  });
}
