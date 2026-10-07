/**
 * [SPRINT] THE PIPELINE: WHO WAS ASKED, WHAT THEY SAID, AND WHETHER MONEY CAME.
 *
 * ---------------------------------------------------------------------------
 * VOX DOES NOT SEND ANYTHING
 * ---------------------------------------------------------------------------
 *
 * This module has no send path. No SMTP, no provider, no template renderer, no
 * scheduler, and it imports nothing that can reach the network. `recordOutreach()`
 * records that *a human already sent* a message. The ordering is the point: if
 * this function could send, then a model's judgement about who deserves a cold
 * pitch would be the thing standing between a prospect and their inbox, and
 * that is not a decision to automate at any volume.
 *
 * So the human sends, and the system remembers. That is the whole division of
 * labour, and the `OutreachAttempt` table has no column that could change it.
 *
 * ---------------------------------------------------------------------------
 * A PAYMENT A HUMAN SAW IS `USER_RECORDED`, NOT `REALIZED`
 * ---------------------------------------------------------------------------
 *
 * This is the one design decision in the module that matters, and it is worth
 * being blunt about because it would have been easy to get wrong.
 *
 * `confirmOutreachPayment()` is the "record actual revenue only when payment is
 * verified" path. The temptation is to write `REALIZED` — the owner has gone and
 * looked at Stripe, they have a transaction id, the money is genuinely there,
 * and the enum has a member that means exactly "confirmed".
 *
 * It does not get `REALIZED`, because `REALIZED` means *VOX confirmed it against
 * an external system of record*, and VOX did not. A person did, and then typed
 * the result in. That is `USER_RECORDED` — "true as far as VOX knows, unverified
 * by anything" — which is precisely the situation. Writing `REALIZED` here would
 * be the same provenance laundering the P6-B figure layer exists to prevent: a
 * human assertion promoted to an external measurement because the human sounded
 * sure. When a payment-processor integration lands it will read the charge
 * itself, from inside its own module, and THAT may write `REALIZED` (I1).
 *
 * The reference is still demanded and still recorded, and that is what makes the
 * row worth something: `paymentReference` is REQUIRED, so the claim is checkable
 * by somebody other than the person making it.
 *
 * It also goes through the existing `addEconomicRevenue()` rather than touching
 * the ledger directly — so the amount passes the same `normalizeAmount()`
 * validation as every other row, and there is no second way into the ledger.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { addEconomicRevenue } from "@/lib/economic/service";
import type { OutreachChannel, OutreachOutcome } from "@/generated/prisma/enums";

/** Outcomes that mean the conversation is over and the answer was no. */
export const CLOSED_LOST: readonly OutreachOutcome[] = ["DECLINED", "DISQUALIFIED"];

export interface RecordOutreachInput {
  userId: string;
  prospect: string;
  organization?: string | null;
  channel: OutreachChannel;
  offer?: string | null;
  askedPriceCents?: number | null;
  /** When the human actually sent it. Defaults to now. */
  sentAt?: Date;
  opportunityId?: string | null;
  notes?: string | null;
}

/**
 * Records that a human sent one message to one person.
 *
 * Creates nothing external and sends nothing.
 */
export async function recordOutreach(input: RecordOutreachInput) {
  const prospect = input.prospect.trim();
  if (prospect.length === 0) {
    throw new Error("An outreach attempt needs a prospect: an unnamed row cannot be followed up.");
  }
  if (input.askedPriceCents != null && (!Number.isInteger(input.askedPriceCents) || input.askedPriceCents < 0)) {
    throw new Error("askedPriceCents must be a non-negative integer number of cents.");
  }

  // The opportunity, if named, must be this user's. Scoped in the WHERE clause
  // rather than checked after the read.
  if (input.opportunityId) {
    const owned = await db.opportunity.findFirst({
      where: { id: input.opportunityId, userId: input.userId },
      select: { id: true },
    });
    if (!owned) throw new Error("No such opportunity for this user.");
  }

  return db.outreachAttempt.create({
    data: {
      userId: input.userId,
      prospect,
      organization: input.organization?.trim() || null,
      channel: input.channel,
      offer: input.offer?.trim() || null,
      askedPriceCents: input.askedPriceCents ?? null,
      sentAt: input.sentAt ?? new Date(),
      opportunityId: input.opportunityId ?? null,
      notes: input.notes?.trim() || null,
    },
  });
}

export type RecordResponseRefusal =
  | "NOT_FOUND"
  /**
   * `PAID` is not settable here.
   *
   * Money has exactly one door — `confirmOutreachPayment()` — because that one
   * demands a processor and a reference. A plain status update to PAID would be
   * a way to mark revenue without either.
   */
  | "PAID_NEEDS_CONFIRMATION"
  /** The attempt is already PAID; its outcome is settled. */
  | "ALREADY_PAID";

export type RecordResponseResult =
  | { recorded: true; outcome: OutreachOutcome }
  | { recorded: false; reason: RecordResponseRefusal; detail: string };

/**
 * Records what the prospect said.
 *
 * `NO_RESPONSE` → `REPLIED`/`INTERESTED`/`AGREED`/`DECLINED` are all ordinary
 * updates. `PAID` is not, and is refused here.
 */
export async function recordOutreachResponse(
  userId: string,
  attemptId: string,
  outcome: OutreachOutcome,
  options: { respondedAt?: Date; notes?: string | null } = {}
): Promise<RecordResponseResult> {
  if (outcome === "PAID") {
    return {
      recorded: false,
      reason: "PAID_NEEDS_CONFIRMATION",
      detail:
        "PAID cannot be set as a status. Use confirmOutreachPayment(), which requires the processor and the transaction reference — marking revenue without either is the claim this system exists not to make.",
    };
  }

  const attempt = await db.outreachAttempt.findFirst({ where: { id: attemptId, userId } });
  if (!attempt) return { recorded: false, reason: "NOT_FOUND", detail: "No such outreach attempt." };
  if (attempt.outcome === "PAID") {
    return {
      recorded: false,
      reason: "ALREADY_PAID",
      detail: "This prospect has already paid. Walking the outcome back would detach a ledger row from its reason.",
    };
  }

  await db.outreachAttempt.update({
    where: { id: attemptId },
    data: {
      outcome,
      // Silence is not a response, so NO_RESPONSE never stamps a response time.
      respondedAt: outcome === "NO_RESPONSE" ? null : options.respondedAt ?? attempt.respondedAt ?? new Date(),
      notes: options.notes?.trim() || attempt.notes,
    },
  });

  return { recorded: true, outcome };
}

export type ConfirmPaymentRefusal =
  | "NOT_FOUND"
  /** Already banked. One payment, one ledger row. */
  | "ALREADY_PAID"
  /** No `EconomicAsset` to book the revenue against. */
  | "NO_ASSET"
  | "INVALID_AMOUNT"
  /** The processor or the reference is missing. Both are required. */
  | "EVIDENCE_INCOMPLETE"
  /** Another call banked this payment first. */
  | "RACE_LOST";

export type ConfirmPaymentResult =
  | {
      confirmed: true;
      revenueId: string;
      amountCents: number;
      /** Always `USER_RECORDED`. Stated in the result so a caller sees it. */
      provenance: "USER_RECORDED";
      caveat: string;
    }
  | { confirmed: false; reason: ConfirmPaymentRefusal; detail: string };

export interface ConfirmPaymentInput {
  userId: string;
  attemptId: string;
  /** The asset to book this against — the business line that earned it. */
  assetId: string;
  amountCents: number;
  /** Where the human looked: "stripe", "paypal", "zelle", "cash", "bank". */
  processor: string;
  /** The transaction id/reference read off that processor. REQUIRED. */
  reference: string;
  /** When the money arrived, per the processor. Defaults to now. */
  paidAt?: Date;
}

/**
 * Records that a human verified a payment arrived, and books it.
 *
 * Writes `USER_RECORDED`, never `REALIZED` — see the module header. Idempotent
 * by refusal: a second call is `ALREADY_PAID` rather than a second ledger row.
 */
export async function confirmOutreachPayment(input: ConfirmPaymentInput): Promise<ConfirmPaymentResult> {
  const processor = input.processor.trim();
  const reference = input.reference.trim();
  if (processor.length === 0 || reference.length === 0) {
    return {
      confirmed: false,
      reason: "EVIDENCE_INCOMPLETE",
      detail:
        "A confirmed payment needs both the processor and its transaction reference. Without them the row asserts money arrived and gives nobody a way to check.",
    };
  }
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return {
      confirmed: false,
      reason: "INVALID_AMOUNT",
      detail: "amountCents must be a positive integer number of cents.",
    };
  }

  const attempt = await db.outreachAttempt.findFirst({
    where: { id: input.attemptId, userId: input.userId },
  });
  if (!attempt) return { confirmed: false, reason: "NOT_FOUND", detail: "No such outreach attempt." };
  // `paidAt` as well as `revenueId`: a row claimed by an in-flight confirmation
  // has a `paidAt` and no `revenueId` yet, and that is still "taken".
  if (attempt.revenueId !== null || attempt.paidAt !== null) {
    return {
      confirmed: false,
      reason: "ALREADY_PAID",
      detail: "This payment is already banked. One verified payment produces one ledger row.",
    };
  }

  const asset = await db.economicAsset.findFirst({
    where: { id: input.assetId, userId: input.userId },
    select: { id: true },
  });
  if (!asset) {
    return {
      confirmed: false,
      reason: "NO_ASSET",
      detail: "No such economic asset for this user. Revenue has to be booked against the business line that earned it.",
    };
  }

  const paidAt = input.paidAt ?? new Date();

  // THE CLAIM, BEFORE THE LEDGER WRITE.
  //
  // It tests `paidAt` and it SETS `paidAt`, and those have to be the same
  // column. Testing `revenueId` instead would not claim anything: `revenueId`
  // is only attachable after the ledger row exists, so two concurrent callers
  // would both see it null, both pass, and both write money. Compare-and-set
  // only excludes a second writer when the condition is the thing the winner
  // changes — the same shape P5-G uses for its execution claim.
  const claimed = await db.outreachAttempt.updateMany({
    where: { id: input.attemptId, userId: input.userId, revenueId: null, paidAt: null },
    data: {
      outcome: "PAID",
      paidAt,
      paidAmountCents: input.amountCents,
      paymentProcessor: processor,
      paymentReference: reference,
      respondedAt: attempt.respondedAt ?? paidAt,
    },
  });
  if (claimed.count === 0) {
    return { confirmed: false, reason: "RACE_LOST", detail: "Another confirmation banked this payment first." };
  }

  // Through the EXISTING ledger API, so the amount passes the same validation
  // as every other row and `USER_RECORDED` is the default rather than a choice
  // made here. There is no second way into the ledger.
  const revenue = await addEconomicRevenue(input.userId, input.assetId, {
    amountUsd: input.amountCents / 100,
    source: `outreach:${processor}:${reference}`,
    occurredAt: paidAt,
    notes: `Payment verified by a person for "${attempt.prospect}"${attempt.organization ? ` (${attempt.organization})` : ""}. Human-verified, not confirmed by VOX against the processor.`,
  });
  if (!revenue) {
    // Should be unreachable: the asset was just read under the same userId.
    // Released rather than left claimed, so a transient failure does not strand
    // the attempt in PAID with no money behind it.
    await db.outreachAttempt.updateMany({
      where: { id: input.attemptId, userId: input.userId, revenueId: null },
      data: { outcome: "AGREED", paidAt: null, paidAmountCents: null, paymentProcessor: null, paymentReference: null },
    });
    return { confirmed: false, reason: "NO_ASSET", detail: "The ledger refused the entry; nothing was recorded." };
  }

  await db.outreachAttempt.update({
    where: { id: input.attemptId },
    data: { revenueId: revenue.id },
  });

  const caveat =
    "Recorded as USER_RECORDED: a person verified this against the processor, VOX did not. REALIZED still requires a payment-processor integration reading the charge itself.";

  await recordEvent({
    userId: input.userId,
    type: "revenue.outreach.payment_confirmed",
    subjectType: "OutreachAttempt",
    subjectId: input.attemptId,
    consequential: true,
    payload: {
      revenueId: revenue.id,
      amountCents: input.amountCents,
      processor,
      // The reference is audit evidence, not a secret: it is a transaction id a
      // person read off their own dashboard, and the row is worthless without it.
      reference,
      assetId: input.assetId,
      provenance: "USER_RECORDED",
      note: caveat,
    },
  });

  return { confirmed: true, revenueId: revenue.id, amountCents: input.amountCents, provenance: "USER_RECORDED", caveat };
}

export interface PipelineSummary {
  sent: number;
  responded: number;
  interested: number;
  agreed: number;
  paid: number;
  /** Cents a person has verified arrived. Null when nothing has — not zero. */
  verifiedRevenueCents: number | null;
  /** Null until at least one message has been sent. A rate needs a denominator. */
  responseRate: number | null;
  byChannel: { channel: OutreachChannel; sent: number; responded: number; paid: number }[];
  caveats: string[];
}

/**
 * The pipeline as it actually is.
 *
 * `verifiedRevenueCents` is NULL rather than 0 when nothing has been paid, for
 * the same reason the Observer renders an absent figure as `UNRECORDED`: "no
 * money yet" and "a measured zero" are different facts, and a sprint dashboard
 * showing $0.00 on day one reads as a result.
 */
export async function pipelineSummary(userId: string): Promise<PipelineSummary> {
  const attempts = await db.outreachAttempt.findMany({
    where: { userId },
    select: { channel: true, outcome: true, respondedAt: true, paidAmountCents: true },
  });

  const responded = attempts.filter((a) => a.respondedAt !== null).length;
  const paidRows = attempts.filter((a) => a.outcome === "PAID");
  const paidCents = paidRows.reduce((sum, a) => sum + (a.paidAmountCents ?? 0), 0);

  const channels = new Map<OutreachChannel, { sent: number; responded: number; paid: number }>();
  for (const a of attempts) {
    const row = channels.get(a.channel) ?? { sent: 0, responded: 0, paid: 0 };
    row.sent += 1;
    if (a.respondedAt !== null) row.responded += 1;
    if (a.outcome === "PAID") row.paid += 1;
    channels.set(a.channel, row);
  }

  return {
    sent: attempts.length,
    responded,
    interested: attempts.filter((a) => a.outcome === "INTERESTED").length,
    agreed: attempts.filter((a) => a.outcome === "AGREED").length,
    paid: paidRows.length,
    verifiedRevenueCents: paidRows.length === 0 ? null : paidCents,
    responseRate: attempts.length === 0 ? null : responded / attempts.length,
    caveats: [
      "Every payment here is USER_RECORDED: a person verified it against a processor, VOX did not.",
      "A response rate over a handful of sends is not a conversion rate — it is a small sample with a large interval.",
      "AGREED is not money. Only PAID rows have a ledger entry behind them.",
    ],
    byChannel: [...channels.entries()].map(([channel, row]) => ({ channel, ...row })),
  };
}
