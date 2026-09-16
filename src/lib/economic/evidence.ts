/**
 * [P5-D] THE EXPERIMENT EVIDENCE LOOP.
 *
 * The smallest legitimate path by which a real VOX experiment can be defined,
 * authorized, executed through the EXISTING executor, observed, persisted, and
 * finally — by a human, never by VOX — turned into evidence that the economic
 * arithmetic counts.
 *
 * ---------------------------------------------------------------------------
 * THE CHAIN, IN ORDER, WITH NO SHORTCUT ANYWHERE ALONG IT
 * ---------------------------------------------------------------------------
 *
 *   Experiment declares an observation rule      (BEFORE it runs)
 *     -> requestExperimentExecution()            claims an execution identity
 *       -> createAgentRun()                      the existing run model
 *         -> executeRun()                        the existing executor
 *           -> checkCapability()                 the existing permission gate
 *             -> enforceExecution()              the existing policy gate
 *               -> tool.execute()                the existing registry
 *                 -> AgentStep.output            persisted by the executor
 *     -> observeExperimentExecution()            applies the frozen rule
 *       -> ExperimentMeasurement                 exactly one row, ever
 *     -> reconcileExperimentOutcome()            A HUMAN DECIDES  (probability.ts)
 *       -> getMeasuredProbability()              arithmetic over verdicts
 *
 * Nothing here executes anything itself. There is no second executor, no second
 * permission check, no grant this module can mint, and no path that reaches a
 * tool except by going through `executeRun`. That is deliberate: a measurement
 * is only worth anything if the thing it measures went through the same gates
 * as every other action in the system.
 *
 * ---------------------------------------------------------------------------
 * WHAT A MEASUREMENT ACTUALLY IS, AND WHAT IT IS NOT
 * ---------------------------------------------------------------------------
 *
 * A measurement is a pair of integers produced by applying a FROZEN observation
 * rule to the persisted output of a real execution, plus the identity of that
 * execution and the provenance of the material counted.
 *
 * The rule is declared on the experiment BEFORE it runs. That ordering is the
 * safeguard: choosing what to count after seeing the result is not measuring, it
 * is arguing. And the rule is a key into the table below rather than free text,
 * for the same reason the proposal registry is closed — a rule someone can write
 * at call time is a rule that can be written to produce a desired number.
 *
 * WHAT IT IS NOT, STATED PLAINLY SO THE LIMIT TRAVELS WITH THE FEATURE.
 *
 * `RESEARCH_SOURCED_RESULTS` counts how many results a research execution
 * returned with a source URL attached. That measures whether an assumption is
 * researchable with the provider currently configured. It is NOT revenue, NOT a
 * conversion, NOT a customer, and NOT evidence that an opportunity will make
 * money. `provenance` carries the provider id precisely so a count over the mock
 * provider's placeholder output is legible as exactly that.
 *
 * [P5-E] `EXTERNAL_ORDER_COUNT` asks a connected storefront how many orders it
 * recorded inside a declared window. That IS a fact about the world rather than
 * about VOX — the first one in this system — and it is still not a result. It
 * establishes that orders existed in a window. It establishes nothing about
 * whether the experiment caused them, what they were worth, or whether they will
 * happen again. Every one of those is a judgement a person makes with context
 * VOX does not have, which is why a measurement still cannot become evidence
 * without a human verdict.
 *
 * A THIRD STATE EXISTS AND MUST NOT COLLAPSE INTO EITHER. An execution that
 * fails, whose provider is unreachable, or whose output the rule cannot read
 * produces NO measurement — never a zero. The observation records why it
 * produced nothing and moves nothing.
 */

import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import type {
  AgentRun,
  AgentStep,
  Experiment,
  ExperimentMeasurement,
  MeasurementSemantics,
  MeasurementSource,
} from "@/generated/prisma/client";
import { recordEvent } from "@/lib/observability/events";
import { createAgentRun, cancelAgentRun, getAgentRun } from "@/lib/agents/service";
import { executeRun } from "@/lib/agents/executor";
import { observationContractDigestOf, resolveObservationWindow } from "@/lib/economic/observationContract";
import { formatMinor, MAX_MONEY_SCALE } from "@/lib/integrations/decimal";

/**
 * Whether VOX itself produced this figure, as opposed to a person reporting one.
 *
 * One definition, because several places branch on "did VOX observe this". Two
 * of those branches drifting apart is exactly how a human-entered number
 * eventually gets rendered as a measurement.
 */
export function isMachineObserved(source: MeasurementSource): boolean {
  return source === "MACHINE_OBSERVED" || source === "EXTERNAL_OBSERVED";
}

// ---------------------------------------------------------------------------
// The frozen observation registry
// ---------------------------------------------------------------------------

/** What one application of a rule produced. Counts and provenance, nothing else. */
export interface RuleObservation {
  observedValue: number;
  /**
   * The denominator, WHERE ONE EXISTS.
   *
   * For the research rule it is a real denominator: results returned. A rule
   * that counts events over a window has none — three orders are not "three out
   * of three" — and such a rule mirrors the value here, because a count has no
   * total and inventing one would put a fraction on screen that means nothing.
   */
  observedTotal: number;
  provenance: string;
  /**
   * [P5-F] A MONETARY amount, set only by a rule that read one.
   *
   * SEPARATE FROM `observedValue` ON PURPOSE, and the separation is the whole
   * safeguard. `observedValue` is a count with a unit in words beside it; money
   * is a triple — an integer, the number of decimal places that integer is
   * expressed at, and the currency it is denominated in — and it is meaningless
   * without all three. Folding an amount into the count column would produce a
   * bare number that reads as "1250" whether the store meant $12.50, ¥1,250 or
   * KWD 1.250, and every one of those renders plausibly.
   *
   * So a value rule fills BOTH: `observedValue` stays the number of orders
   * summed (which is what makes the sum checkable — it is the completeness
   * proof), and `money` carries the amount.
   */
  money?: {
    /** The exact total in minor units at `amountScale`. Never a float. */
    amountMinor: number;
    /** Decimal places the provider used. Read from the provider, never assumed. */
    amountScale: number;
    /** Currency code. Established from the provider, never defaulted. */
    currency: string;
  };
  /** [P5-E] Set only by a rule that read an external system of record. */
  external?: {
    provider: string;
    scope: string;
    retrievedAt: Date;
    responseDigest: string;
    windowStart: Date;
    windowEnd: Date;
    semantics: MeasurementSemantics;
  };
}

/**
 * The rule read the step's output and found an explicit non-answer.
 *
 * Distinct from `null`, which means "this output is not the shape I read". This
 * means "the execution ran, asked, and no number came back". It writes no
 * measurement and it is emphatically not a zero.
 */
export interface RuleNotObserved {
  notObserved: true;
  failure: string;
  detail: string;
}

export type RuleOutcome = RuleObservation | RuleNotObserved | null;

export function isNotObserved(outcome: RuleOutcome): outcome is RuleNotObserved {
  return outcome !== null && "notObserved" in outcome;
}

export interface ObservationRule {
  /** The tool whose output this rule reads. The rule and the tool are one choice. */
  readonly toolName: string;
  /** What is being counted, in words. Stored on the measurement so no number travels bare. */
  readonly unit: string;
  /** The exact arithmetic, in a sentence, so a reviewer can re-run it by hand. */
  readonly method: string;
  /** What this measurement does NOT establish. Carried to the surface deliberately. */
  readonly doesNotEstablish: string;
  /**
   * [P5-E] True when this rule reads an external system of record, and
   * therefore requires a frozen scope + window contract before it may be
   * dispatched — and again before a measurement is written from the answer.
   */
  readonly requiresExternalContract: boolean;
  /** The measurement source a successful application produces. */
  readonly source: MeasurementSource;
  /** Builds the tool arguments from the experiment. Deterministic. */
  readonly buildInput: (experiment: Experiment) => Record<string, unknown>;
  /** Applies the rule to a step's persisted output. Null when the output is unreadable. */
  readonly observe: (output: unknown) => RuleOutcome;
}

/** One result as `research.run` persists it on the step. */
interface ResearchResultShape {
  sourceUrl?: unknown;
  provider?: unknown;
}

/**
 * Every rule VOX can execute, hardcoded.
 *
 * TWO ENTRIES, and they are different kinds of thing. `RESEARCH_SOURCED_RESULTS`
 * counts what one of VOX's own executions produced — real, deterministic, and
 * about VOX. `EXTERNAL_ORDER_COUNT` asks a merchant's own system of record what
 * happened in the world, which is the first thing here that could be economic
 * evidence at all.
 *
 * A registry with seven speculative rules in it would be seven ways to measure
 * nothing. New rules belong here when a new capability genuinely arrives, with
 * the same properties — declared before execution, computed from persisted
 * output, honest about what it does not establish.
 */
export const OBSERVATION_RULES: Readonly<Record<string, ObservationRule>> = Object.freeze({
  RESEARCH_SOURCED_RESULTS: Object.freeze({
    requiresExternalContract: false,
    source: "MACHINE_OBSERVED" as MeasurementSource,
    toolName: "research.run",
    unit: "research results carrying a source URL",
    method:
      "Over the results the research execution actually persisted on its step: the denominator is how many results came back, the numerator is how many of those carry a non-empty source URL. Both are counted from the stored output, not from the request.",
    doesNotEstablish:
      "Nothing about revenue, customers, conversion, or whether the opportunity is viable. It measures whether this assumption is researchable with the provider that was configured at the time.",
    buildInput: (experiment: Experiment) => ({
      // The hypothesis is the query, because the hypothesis is what is being
      // tested. Sliced to the tool's own schema limit rather than left to fail
      // validation inside the executor, where the failure would read as a
      // planning bug rather than as an over-long hypothesis.
      query: experiment.hypothesis.slice(0, 500),
      ...(experiment.opportunityId ? { opportunityId: experiment.opportunityId } : {}),
    }),
    observe: (output: unknown): RuleOutcome => {
      if (!Array.isArray(output)) return null;
      const rows = output as ResearchResultShape[];
      const sourced = rows.filter((r) => typeof r?.sourceUrl === "string" && r.sourceUrl.length > 0);
      const providers = [
        ...new Set(rows.map((r) => (typeof r?.provider === "string" ? r.provider : "unknown"))),
      ].sort();
      return {
        observedValue: sourced.length,
        observedTotal: rows.length,
        // An empty result set has no provider to name, and saying so is more
        // honest than attributing zero results to a provider that may not have
        // been reached at all.
        provenance:
          rows.length === 0
            ? "research provider: none (the execution returned no results)"
            : `research provider: ${providers.join(", ")}`,
      };
    },
  }),

  /**
   * [P5-E] How many orders a connected storefront recorded inside a declared
   * window.
   *
   * THE FIRST RULE THAT MEASURES THE WORLD RATHER THAN VOX. The number comes
   * from a merchant's own system of record, retrieved through an authenticated
   * read the executor authorized, and it is a DELTA over a window rather than a
   * level read at an instant — so it cannot turn a store's entire trading
   * history into one experiment's result.
   *
   * IT STILL DOES NOT MEAN THE EXPERIMENT SUCCEEDED. Three orders in the window
   * is a fact. Whether three orders is a win, a loss, or noise depends on what
   * the experiment predicted, what it cost, what else was running that week, and
   * whether those orders had anything to do with it — none of which VOX knows.
   * A human reconciles. This rule counts.
   */
  EXTERNAL_ORDER_COUNT: Object.freeze({
    requiresExternalContract: true,
    source: "EXTERNAL_OBSERVED" as MeasurementSource,
    toolName: "economic.observe_orders",
    unit: "orders created in the observation window",
    method:
      "The connected storefront is asked how many orders it recorded with a creation time inside the declared window — lower bound inclusive, upper bound exclusive. The store answers with a single integer and its own precision flag; anything other than an exact count is refused rather than recorded. VOX performs no arithmetic on the answer.",
    doesNotEstablish:
      "Nothing about causation, revenue, margin, or profit. It says orders existed in a window, not that the experiment produced them, not that they were profitable, and not that they will recur. Attribution is a judgement a person makes with context VOX does not have.",
    buildInput: (experiment: Experiment) => ({ experimentId: experiment.id }),
    observe: (output: unknown): RuleOutcome => {
      if (typeof output !== "object" || output === null) return null;
      const row = output as Record<string, unknown>;

      // The explicit non-answer. Recorded as a refusal, never as a zero.
      if (row.observed === false) {
        return {
          notObserved: true,
          failure: typeof row.failure === "string" ? row.failure : "UNKNOWN",
          detail: typeof row.detail === "string" ? row.detail : "The observation produced no value.",
        };
      }
      if (row.observed !== true) return null;

      const value = row.value;
      if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
      for (const key of ["provider", "scope", "retrievedAt", "responseDigest", "windowStart", "windowEnd"]) {
        if (typeof row[key] !== "string") return null;
      }
      // A LEVEL read at an instant must never be recorded under a rule that
      // means a delta over a window — that is how a store's lifetime total
      // becomes one experiment's result.
      if (row.semantics !== "DELTA_OVER_WINDOW") return null;

      const retrievedAt = new Date(row.retrievedAt as string);
      const windowStart = new Date(row.windowStart as string);
      const windowEnd = new Date(row.windowEnd as string);
      if ([retrievedAt, windowStart, windowEnd].some((d) => Number.isNaN(d.getTime()))) return null;

      return {
        observedValue: value,
        // A count has no denominator; see the note on RuleObservation.
        observedTotal: value,
        provenance: `${row.provider as string}: ${row.scope as string}`,
        external: {
          provider: row.provider as string,
          scope: row.scope as string,
          retrievedAt,
          responseDigest: row.responseDigest as string,
          windowStart,
          windowEnd,
          semantics: "DELTA_OVER_WINDOW",
        },
      };
    },
  }),

  /**
   * [P5-F] How much order value a connected storefront recorded inside a
   * declared window.
   *
   * THE SAME QUESTION AS `EXTERNAL_ORDER_COUNT`, ASKED OF A DIFFERENT COLUMN.
   * Same store, same frozen contract, same inclusive-start/exclusive-end window,
   * same authenticated read-only scope. What changes is that the answer is
   * money, and money is where a measurement stops being merely wrong and starts
   * being a claim about revenue.
   *
   * SO THIS RULE IS DELIBERATELY HARDER TO SATISFY THAN THE COUNT. It refuses
   * unless the provider returned a single unambiguous currency, an exact
   * (non-rounded, non-estimated) figure, and a set of orders whose size the
   * store's own count agrees with. Any of those missing produces a refusal,
   * never a partial total — a sum that silently dropped its last page is a
   * smaller number that looks exactly like a real one.
   *
   * WHAT IT DOES NOT ESTABLISH, and this is the point of the whole phase:
   *
   *   NOT REVENUE. Gross order value is what customers were charged. Revenue is
   *   an accounting concept that survives refunds, cancellations, chargebacks,
   *   unfulfilled orders and recognition timing. This figure survives none of
   *   them — `totalPriceSet` is deliberately the value AT ORDER TIME, because
   *   the alternative drifts and a drifting measurement breaks its own digest.
   *
   *   NOT PROFIT. No cost of goods, no fees, no shipping, no advertising, no
   *   tax treatment. Subtracting nothing from a gross figure does not make it a
   *   margin.
   *
   *   NOT ATTRIBUTION. Orders in a window are orders in a window. Whether the
   *   experiment produced any of them needs context — other campaigns,
   *   seasonality, existing demand — that VOX does not have.
   *
   *   NOT CAUSATION, and no window arithmetic makes it so.
   */
  EXTERNAL_ORDER_VALUE: Object.freeze({
    requiresExternalContract: true,
    source: "EXTERNAL_OBSERVED" as MeasurementSource,
    toolName: "economic.observe_order_value",
    unit: "total price of orders created in the observation window, at order time and before returns",
    method:
      "The connected storefront is asked for the orders it recorded with a creation time inside the declared window — lower bound inclusive, upper bound exclusive — and their order-time totals are summed exactly as integers in minor units, at the number of decimal places the store itself used. The store is separately asked how many orders that window holds, and the sum is refused unless the number of orders summed equals that count and that count did not move while the pages were read. A single currency must hold across the shop and every order summed; a mixed-currency, rounded, estimated or incomplete answer is refused rather than recorded.",
    doesNotEstablish:
      "It is not revenue: gross order value at order time survives no refund, cancellation, chargeback or recognition rule. It is not profit: nothing is subtracted for goods, fees, shipping, advertising or tax. It is not attribution: orders inside a window are not orders caused by the experiment. It is not causation, and it does not predict recurrence. Every one of those is a judgement a person makes with context VOX does not have.",
    buildInput: (experiment: Experiment) => ({ experimentId: experiment.id }),
    observe: (output: unknown): RuleOutcome => {
      if (typeof output !== "object" || output === null) return null;
      const row = output as Record<string, unknown>;

      // The explicit non-answer. A refused sum is an absence of knowledge about
      // money, which is the one thing that must never round to zero.
      if (row.observed === false) {
        return {
          notObserved: true,
          failure: typeof row.failure === "string" ? row.failure : "UNKNOWN",
          detail:
            typeof row.detail === "string" ? row.detail : "The observation produced no monetary value.",
        };
      }
      if (row.observed !== true) return null;

      // Every monetary field is validated independently and the whole row is
      // rejected if any one is off-shape. A partially-read money row is not a
      // smaller amount, it is an unknown one.
      const amountMinor = row.amountMinor;
      const amountScale = row.amountScale;
      const orderCount = row.orderCount;
      if (typeof amountMinor !== "number" || !Number.isInteger(amountMinor) || amountMinor < 0) return null;
      if (typeof amountScale !== "number" || !Number.isInteger(amountScale) || amountScale < 0) return null;
      if (amountScale > MAX_MONEY_SCALE) return null;
      if (typeof orderCount !== "number" || !Number.isInteger(orderCount) || orderCount < 0) return null;

      // A three-letter code, checked by shape. A currency this module cannot
      // read is an amount it cannot denominate, and an undenominated amount is
      // not money.
      const currency = row.currency;
      if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return null;

      for (const key of ["provider", "scope", "retrievedAt", "responseDigest", "windowStart", "windowEnd"]) {
        if (typeof row[key] !== "string") return null;
      }
      if (row.semantics !== "DELTA_OVER_WINDOW") return null;

      const retrievedAt = new Date(row.retrievedAt as string);
      const windowStart = new Date(row.windowStart as string);
      const windowEnd = new Date(row.windowEnd as string);
      if ([retrievedAt, windowStart, windowEnd].some((d) => Number.isNaN(d.getTime()))) return null;

      return {
        // THE COUNT COLUMN STAYS A COUNT. `observedValue` is how many orders
        // went into the sum, which is exactly the number the completeness check
        // proved. Putting the amount here instead would produce a bare integer
        // with no scale and no currency attached to it anywhere downstream.
        observedValue: orderCount,
        observedTotal: orderCount,
        money: { amountMinor, amountScale, currency },
        provenance: `${row.provider as string}: ${row.scope as string}`,
        external: {
          provider: row.provider as string,
          scope: row.scope as string,
          retrievedAt,
          responseDigest: row.responseDigest as string,
          windowStart,
          windowEnd,
          semantics: "DELTA_OVER_WINDOW",
        },
      };
    },
  }),
});

export function getObservationRule(key: string | null): ObservationRule | null {
  if (!key) return null;
  return OBSERVATION_RULES[key] ?? null;
}

export function listObservationRules(): { key: string; rule: ObservationRule }[] {
  return Object.entries(OBSERVATION_RULES).map(([key, rule]) => ({ key, rule }));
}

// ---------------------------------------------------------------------------
// The digest
// ---------------------------------------------------------------------------

/**
 * A hash over everything that makes a measurement mean what it means.
 *
 * Bound onto the experiment at reconciliation, so a measurement edited (or
 * deleted) afterwards no longer matches the verdict that rests on it, and
 * `verifyEvidenceIntegrity()` can say so rather than leaving a probability
 * quietly standing on evidence that changed underneath it.
 *
 * The execution identity is inside the hash on purpose: repointing a measurement
 * at a different step is exactly as much a change of evidence as editing its
 * counts.
 */
export function measurementDigest(input: {
  experimentId: string;
  source: string;
  agentRunId: string | null;
  agentStepId: string | null;
  rule: string;
  unit: string;
  observedValue: number;
  observedTotal: number;
  provenance: string;
  /**
   * [P5-F] The monetary terms, when the measurement carries an amount.
   *
   * ALL THREE OR NONE. A digest covering the integer but not the scale would let
   * 1250 be restated as 125.0 without breaking; one covering the amount but not
   * the currency would let a JPY total be relabelled USD — a ~150x revaluation —
   * while still verifying. Currency and scale are not metadata about the amount,
   * they are part of it.
   */
  money?: {
    amountMinor: number;
    amountScale: number;
    currency: string;
  } | null;
  /**
   * [P5-E] External provenance, when the figure came from outside VOX.
   *
   * Inside the hash for the same reason the execution identity is: repointing a
   * measurement at a different store, a different window, or a different raw
   * response is exactly as much a change of evidence as editing its counts.
   * Absent entirely for a non-external measurement, so a research measurement's
   * digest is computed from exactly the terms it always was.
   */
  external?: {
    provider: string;
    scope: string;
    responseDigest: string;
    windowStart: Date;
    windowEnd: Date;
    semantics: string;
  } | null;
}): string {
  const canonical = [
    input.experimentId,
    input.source,
    input.agentRunId ?? "",
    input.agentStepId ?? "",
    input.rule,
    input.unit,
    String(input.observedValue),
    String(input.observedTotal),
    input.provenance,
    ...(input.external
      ? [
          "EXTERNAL",
          input.external.provider,
          input.external.scope,
          input.external.responseDigest,
          input.external.windowStart.toISOString(),
          input.external.windowEnd.toISOString(),
          input.external.semantics,
        ]
      : []),
    // [P5-F] APPENDED, AND TAGGED.
    //
    // Appended so a measurement carrying no amount hashes to exactly what it
    // hashed to before this phase existed — a research count and an order count
    // both keep their digests, and `verifyEvidenceIntegrity()` does not report
    // every pre-existing row as tampered with the moment this ships.
    //
    // Tagged because the terms are joined by a separator, and an untagged
    // variable-length tail is how two different measurements end up with the
    // same canonical string.
    ...(input.money
      ? ["MONEY", String(input.money.amountMinor), String(input.money.amountScale), input.money.currency]
      : []),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Recomputes a stored measurement's digest from the row as it stands.
 *
 * One definition, used by both integrity readers — two copies of this that
 * drifted would report tampering on rows that are fine, or miss it on rows that
 * are not.
 */
function recomputeMeasurementDigest(experimentId: string, measurement: ExperimentMeasurement): string {
  return measurementDigest({
    experimentId,
    source: measurement.source,
    agentRunId: measurement.agentRunId,
    agentStepId: measurement.agentStepId,
    rule: measurement.rule,
    unit: measurement.unit,
    observedValue: measurement.observedValue,
    observedTotal: measurement.observedTotal,
    provenance: measurement.provenance,
    money:
      measurement.observedAmountMinor !== null &&
      measurement.observedAmountScale !== null &&
      measurement.observedCurrency !== null
        ? {
            amountMinor: measurement.observedAmountMinor,
            amountScale: measurement.observedAmountScale,
            currency: measurement.observedCurrency,
          }
        : null,
    external:
      measurement.externalProvider && measurement.windowStart && measurement.windowEnd
        ? {
            provider: measurement.externalProvider,
            scope: measurement.externalScope ?? "",
            responseDigest: measurement.responseDigest ?? "",
            windowStart: measurement.windowStart,
            windowEnd: measurement.windowEnd,
            semantics: measurement.semantics ?? "",
          }
        : null,
  });
}

// ---------------------------------------------------------------------------
// The derived stage
// ---------------------------------------------------------------------------

/**
 * Where an experiment sits in the evidence lifecycle.
 *
 * DERIVED, NEVER STORED. Every value below is computed from rows the executor
 * already owns plus this module's own pointer columns. There is no stage column
 * to fall out of sync, no transition to miss on a crash, and no way for the
 * experiment to claim it is executing when the run says otherwise.
 */
export type EvidenceStage =
  /** No execution identity. Nothing has been dispatched. */
  | "NOT_DISPATCHED"
  /** Dispatched; the executor is holding it for a human's approval. */
  | "AWAITING_AUTHORIZATION"
  /** Dispatched and running. */
  | "EXECUTING"
  /**
   * The execution began and how it ended was never recorded.
   *
   * A step left RUNNING on a run that is no longer running — the process died
   * between `status: RUNNING` and the tool's result being persisted. The tool
   * may have run. It may have half-run. Nobody knows, and an unknown must not
   * be resolved by assumption in either direction.
   */
  | "IN_DOUBT"
  /** The execution reached a terminal failure. No measurement will come from it. */
  | "EXECUTION_FAILED"
  /** The execution completed and nothing has observed it yet. */
  | "AWAITING_OBSERVATION"
  /** A measurement exists. It is NOT yet evidence — nobody has accepted it. */
  | "MEASUREMENT_RECORDED"
  /** A human recorded a verdict. Only now can the probability count it. */
  | "RECONCILED";

interface StageInput {
  outcomeRecordedAt: Date | null;
  executionRunId: string | null;
  hasMeasurement: boolean;
  runStatus: AgentRun["status"] | null;
  anyStepInDoubt: boolean;
}

/**
 * Pure. No database, no clock, no I/O — so the whole lifecycle is testable by
 * enumeration rather than by staging eight database fixtures.
 *
 * ORDER MATTERS AND IS NOT ARBITRARY. `outcomeRecordedAt` is checked first
 * because a recorded verdict is the terminal fact; `anyStepInDoubt` outranks the
 * run's own status because a run row can read COMPLETED while carrying a step
 * nobody recorded the end of, and the unknown outranks the summary.
 */
export function deriveEvidenceStage(input: StageInput): EvidenceStage {
  if (input.outcomeRecordedAt !== null) return "RECONCILED";
  if (input.executionRunId === null) {
    // A human-entered measurement with no execution behind it still sits here:
    // it is recorded, and it is waiting for a person to accept it.
    return input.hasMeasurement ? "MEASUREMENT_RECORDED" : "NOT_DISPATCHED";
  }
  if (input.hasMeasurement) return "MEASUREMENT_RECORDED";
  if (input.anyStepInDoubt) return "IN_DOUBT";
  switch (input.runStatus) {
    case "COMPLETED":
      return "AWAITING_OBSERVATION";
    case "FAILED":
    case "CANCELLED":
      return "EXECUTION_FAILED";
    case "WAITING_FOR_PERMISSION":
      return "AWAITING_AUTHORIZATION";
    case "PLANNING":
    case "RUNNING":
    case "WAITING":
      return "EXECUTING";
    case null:
      // An execution identity pointing at a run that is not there. Not a
      // failure we can attribute and not something to observe — it is exactly
      // the "began, end unrecorded" case.
      return "IN_DOUBT";
  }
}

/**
 * A step whose end was never recorded.
 *
 * VOX has no `IN_DOUBT` step status — the executor writes RUNNING, calls the
 * tool, then writes COMPLETED or FAILED. So the observable signature of a lost
 * execution is a step still RUNNING on a run that is no longer running. That is
 * what this detects, and it is why observation refuses on it.
 */
function stepsInDoubt(run: { status: AgentRun["status"]; steps: AgentStep[] }): boolean {
  const runIsLive = run.status === "RUNNING" || run.status === "PLANNING" || run.status === "WAITING";
  if (runIsLive) return false;
  return run.steps.some((s) => s.status === "RUNNING");
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

export type DispatchRefusal =
  | "NOT_FOUND"
  /** No rule declared, or a rule key that is not in the frozen registry. */
  | "NO_OBSERVATION_RULE"
  | "UNKNOWN_OBSERVATION_RULE"
  /** An execution identity already exists. An experiment is executed once. */
  | "ALREADY_DISPATCHED"
  /** Someone else claimed the identity between this call's read and its write. */
  | "DISPATCH_RACE_LOST"
  /** A verdict is already recorded. Re-running would be evidence shopping. */
  | "ALREADY_RECONCILED";

export type DispatchResult =
  | { dispatched: true; runId: string; stage: EvidenceStage }
  | { dispatched: false; reason: DispatchRefusal };

/**
 * Claims an execution identity for an experiment and runs it through the
 * existing executor.
 *
 * ---------------------------------------------------------------------------
 * THE COMPARE-AND-SET, AND WHY IT IS NOT A CHECK-THEN-WRITE
 * ---------------------------------------------------------------------------
 *
 * Two concurrent dispatches of the same experiment must not produce two
 * executions — otherwise "the execution" is ambiguous, two measurements compete
 * for one experiment, and a person choosing between them is choosing their
 * evidence after the fact.
 *
 * Reading `executionRunId`, seeing null, and then writing it is a race with good
 * manners: both callers read null. So the write is conditional —
 * `updateMany({ where: { executionRunId: null } })` — and the database decides.
 * Exactly one call gets `count: 1`.
 *
 * THE LOSER HAS ALREADY CREATED A RUN. That run is real, it is persisted, and it
 * belongs to no experiment. Leaving it would put an orphan in the user's run
 * list that looks like work VOX is doing. So the loser cancels it, and only
 * then reports the loss. The run is created before the claim rather than after
 * because the claim needs a run id to write.
 */
export async function requestExperimentExecution(
  userId: string,
  experimentId: string
): Promise<DispatchResult> {
  const experiment = await db.experiment.findFirst({ where: { id: experimentId, userId } });
  if (!experiment) return { dispatched: false, reason: "NOT_FOUND" };
  if (experiment.outcomeRecordedAt !== null) return { dispatched: false, reason: "ALREADY_RECONCILED" };
  if (experiment.executionRunId !== null) return { dispatched: false, reason: "ALREADY_DISPATCHED" };
  if (!experiment.observationRule) return { dispatched: false, reason: "NO_OBSERVATION_RULE" };

  const rule = getObservationRule(experiment.observationRule);
  if (!rule) return { dispatched: false, reason: "UNKNOWN_OBSERVATION_RULE" };

  const run = await createAgentRun({
    userId,
    objective: `Execute economic experiment: ${experiment.hypothesis.slice(0, 200)}`,
    projectId: experiment.projectId ?? undefined,
    // ONE step, bound to the rule's own tool. The plan is not produced by a
    // planner here: the rule already decided what tool answers it, and letting a
    // planner choose would mean the thing measured and the thing declared could
    // differ.
    steps: [
      {
        description: `Observation for rule ${experiment.observationRule}`,
        toolName: rule.toolName,
        input: rule.buildInput(experiment),
      },
    ],
  });

  const claimed = await db.experiment.updateMany({
    where: { id: experimentId, userId, executionRunId: null },
    data: { executionRunId: run.id },
  });

  if (claimed.count === 0) {
    await cancelAgentRun(userId, run.id).catch(() => {
      // Best effort. Failing to tidy an orphan must not turn a lost race into an
      // exception — the race itself was handled correctly, and the caller's
      // answer is the same either way.
    });
    return { dispatched: false, reason: "DISPATCH_RACE_LOST" };
  }

  await recordEvent({
    userId,
    type: "economic.experiment.execution.dispatched",
    subjectType: "Experiment",
    subjectId: experimentId,
    consequential: true,
    payload: { agentRunId: run.id, rule: experiment.observationRule, toolName: rule.toolName },
  });

  // The existing executor, called exactly as every other caller calls it. It
  // performs the capability check, the policy enforcement, and the tool call. If
  // it parks for a permission, this returns with the run waiting — which is the
  // correct outcome, not an error.
  const executed = await executeRun(userId, run.id);

  return {
    dispatched: true,
    runId: run.id,
    stage: deriveEvidenceStage({
      outcomeRecordedAt: null,
      executionRunId: run.id,
      hasMeasurement: false,
      runStatus: executed.status,
      anyStepInDoubt: stepsInDoubt(executed),
    }),
  };
}

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

export type ObservationRefusalReason =
  | "NOT_FOUND"
  | "ALREADY_MEASURED"
  | "NOT_DISPATCHED"
  | "UNKNOWN_OBSERVATION_RULE"
  /** The run has not reached COMPLETED. Nothing to read yet. */
  | "EXECUTION_NOT_COMPLETED"
  /** A step began and its end was never recorded. Refuse rather than guess. */
  | "EXECUTION_IN_DOUBT"
  /** The run completed but carries no completed step for this rule's tool. */
  | "NO_OBSERVABLE_OUTPUT"
  /** The stored output is not the shape the rule reads. */
  | "UNREADABLE_OUTPUT"
  /** The execution asked and got an explicit non-answer. NOT a zero. */
  | "OBSERVATION_UNAVAILABLE";

export type ObservationResult =
  | { observed: true; measurement: ExperimentMeasurement }
  | { observed: false; reason: ObservationRefusalReason; failure?: string; detail?: string };

/**
 * Applies the experiment's declared rule to its execution's persisted output and
 * writes AT MOST ONE measurement.
 *
 * Idempotent by construction: the `experimentId` unique constraint is the real
 * guard, not the `ALREADY_MEASURED` check at the top. The check is a courtesy
 * that gives a clean answer on the common path; the constraint is what holds
 * when two observers run at the same instant.
 */
export async function observeExperimentExecution(
  userId: string,
  experimentId: string
): Promise<ObservationResult> {
  const experiment = await db.experiment.findFirst({
    where: { id: experimentId, userId },
    include: { measurement: true },
  });
  if (!experiment) return { observed: false, reason: "NOT_FOUND" };
  if (experiment.measurement) return { observed: false, reason: "ALREADY_MEASURED" };
  if (!experiment.executionRunId) return { observed: false, reason: "NOT_DISPATCHED" };

  const rule = getObservationRule(experiment.observationRule);
  if (!rule) return { observed: false, reason: "UNKNOWN_OBSERVATION_RULE" };

  const run = await getAgentRun(userId, experiment.executionRunId);
  if (!run) return { observed: false, reason: "EXECUTION_NOT_COMPLETED" };

  // Checked BEFORE the run's own status: a run can read COMPLETED while
  // carrying a step nobody recorded the end of, and the unknown outranks the
  // summary. An in-doubt execution must never become a success or a failure.
  if (stepsInDoubt(run)) return { observed: false, reason: "EXECUTION_IN_DOUBT" };
  if (run.status !== "COMPLETED") return { observed: false, reason: "EXECUTION_NOT_COMPLETED" };

  const step = run.steps.find(
    (s: AgentStep) => s.toolName === rule.toolName && s.status === "COMPLETED" && s.output !== null
  );
  if (!step || !step.output) return { observed: false, reason: "NO_OBSERVABLE_OUTPUT" };

  // ---- [P5-E] THE CONTRACT IS RE-CHECKED HERE, NOT ONLY AT DISPATCH --------
  //
  // The gate in `externalObservation.ts` verified the contract before the store
  // was asked, which stops a question being changed BEFORE it is asked. It does
  // not stop one being changed AFTER: the retrieval is already sitting in the
  // step's stored output, and rewriting the experiment's window or store
  // afterwards would leave a measurement that reads as though it had always been
  // about the new thing.
  //
  // So the digest is re-derived once more, immediately before the measurement is
  // written, and this is the check that actually protects the recorded evidence.
  if (rule.requiresExternalContract) {
    const window = resolveObservationWindow(experiment);
    if (!window || !experiment.externalScope || !experiment.observationContractDigest) {
      return {
        observed: false,
        reason: "OBSERVATION_UNAVAILABLE",
        failure: "NO_CONTRACT",
        detail: "The experiment no longer carries a complete observation contract.",
      };
    }
    const current = observationContractDigestOf({
      rule: experiment.observationRule!,
      scope: experiment.externalScope,
      windowStart: window.start,
      windowMinutes: window.minutes,
    });
    if (current !== experiment.observationContractDigest) {
      return {
        observed: false,
        reason: "OBSERVATION_UNAVAILABLE",
        failure: "CONTRACT_ALTERED",
        detail:
          "The observation rule, store or window changed after this experiment was dispatched. The retrieval sitting on the step answered a different question from the one the experiment now asks, so no measurement may be written from it.",
      };
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(step.output);
  } catch {
    return { observed: false, reason: "UNREADABLE_OUTPUT" };
  }

  const outcome = rule.observe(parsed);
  if (outcome === null) return { observed: false, reason: "UNREADABLE_OUTPUT" };

  // ---- THE EXPLICIT NON-ANSWER --------------------------------------------
  //
  // The execution ran, asked, and no number came back. This is the single most
  // important branch in the module, because the alternative implementation of it
  // is `?? 0`, and a zero here would be a fabricated result with a real
  // execution and a real audit trail behind it.
  //
  // NO MEASUREMENT IS WRITTEN. The reason is recorded on the experiment as a
  // diagnostic so a surface can say "observation unavailable" instead of showing
  // a silence that looks like a zero, and nothing downstream reads it: not the
  // probability, not the ranking, not the verdict.
  if (isNotObserved(outcome)) {
    await db.experiment.update({
      where: { id: experimentId },
      data: { lastObservationFailure: outcome.failure, lastObservationAttemptAt: new Date() },
    });
    await recordEvent({
      userId,
      type: "economic.experiment.observation.unavailable",
      subjectType: "Experiment",
      subjectId: experimentId,
      consequential: false,
      payload: { failure: outcome.failure, detail: outcome.detail, agentStepId: step.id },
    });
    return { observed: false, reason: "OBSERVATION_UNAVAILABLE", failure: outcome.failure, detail: outcome.detail };
  }

  const observation = outcome;
  const source = rule.source;

  // A rule that declares it reads an external system of record but produced no
  // external provenance is a contradiction, and the safe reading of a
  // contradiction is that nothing was observed.
  if (rule.requiresExternalContract && !observation.external) {
    return { observed: false, reason: "UNREADABLE_OUTPUT" };
  }

  const digest = measurementDigest({
    experimentId,
    source,
    agentRunId: run.id,
    agentStepId: step.id,
    rule: experiment.observationRule!,
    unit: rule.unit,
    observedValue: observation.observedValue,
    observedTotal: observation.observedTotal,
    provenance: observation.provenance,
    money: observation.money ?? null,
    external: observation.external
      ? {
          provider: observation.external.provider,
          scope: observation.external.scope,
          responseDigest: observation.external.responseDigest,
          windowStart: observation.external.windowStart,
          windowEnd: observation.external.windowEnd,
          semantics: observation.external.semantics,
        }
      : null,
  });

  let measurement: ExperimentMeasurement;
  try {
    measurement = await db.experimentMeasurement.create({
      data: {
        userId,
        experimentId,
        source,
        agentRunId: run.id,
        agentStepId: step.id,
        observedValue: observation.observedValue,
        observedTotal: observation.observedTotal,
        unit: rule.unit,
        rule: experiment.observationRule!,
        provenance: observation.provenance,
        digest,
        ...(observation.money
          ? {
              observedAmountMinor: observation.money.amountMinor,
              observedAmountScale: observation.money.amountScale,
              observedCurrency: observation.money.currency,
            }
          : {}),
        ...(observation.external
          ? {
              externalProvider: observation.external.provider,
              externalScope: observation.external.scope,
              retrievedAt: observation.external.retrievedAt,
              responseDigest: observation.external.responseDigest,
              windowStart: observation.external.windowStart,
              windowEnd: observation.external.windowEnd,
              semantics: observation.external.semantics,
            }
          : {}),
      },
    });
  } catch {
    // The unique constraint is the real guard. Losing it means another observer
    // already recorded this execution, which is the correct outcome.
    return { observed: false, reason: "ALREADY_MEASURED" };
  }

  await recordEvent({
    userId,
    type: "economic.experiment.measurement.recorded",
    subjectType: "Experiment",
    subjectId: experimentId,
    // Consequential: this is the material every later probability rests on, and
    // an auditor asking "where did this number come from" has to find it here.
    consequential: true,
    payload: {
      measurementId: measurement.id,
      source,
      agentRunId: run.id,
      agentStepId: step.id,
      rule: experiment.observationRule,
      observedValue: observation.observedValue,
      observedTotal: observation.observedTotal,
      provenance: observation.provenance,
      digest,
      ...(observation.money
        ? {
            observedAmountMinor: observation.money.amountMinor,
            observedAmountScale: observation.money.amountScale,
            observedCurrency: observation.money.currency,
          }
        : {}),
      ...(observation.external
        ? {
            externalProvider: observation.external.provider,
            externalScope: observation.external.scope,
            windowStart: observation.external.windowStart.toISOString(),
            windowEnd: observation.external.windowEnd.toISOString(),
            responseDigest: observation.external.responseDigest,
          }
        : {}),
    },
  });

  return { observed: true, measurement };
}

// ---------------------------------------------------------------------------
// Human-entered measurement
// ---------------------------------------------------------------------------

export type ExternalMeasurementRefusal =
  | "NOT_FOUND"
  | "ALREADY_MEASURED"
  | "INVALID_VALUE"
  /**
   * VOX dispatched an execution for this experiment.
   *
   * Typing a figure over an execution VOX performed would produce a measurement
   * that LOOKS machine-observed in every surface that renders it while resting
   * on nobody's observation at all. If the execution produced something,
   * `observeExperimentExecution()` is the path; if it did not, that is a fact
   * about the execution and should stay visible.
   */
  | "EXECUTION_EXISTS";

export type ExternalMeasurementResult =
  | { recorded: true; measurement: ExperimentMeasurement }
  | { recorded: false; reason: ExternalMeasurementRefusal };

export interface ExternalMeasurementInput {
  userId: string;
  experimentId: string;
  observedValue: number;
  observedTotal: number;
  unit: string;
  /** Where the person got this figure. Required — a number with no source is a rumour. */
  provenance: string;
}

/**
 * Records a figure A PERSON reports, clearly marked as theirs.
 *
 * `source: HUMAN_ENTERED` and `rule: "HUMAN_ENTERED"` are not cosmetic. They are
 * what stops this row being counted as something VOX observed — see
 * `isMachineObserved()` and `verifyEvidenceIntegrity()`, neither of which treats
 * it as machine evidence.
 */
export async function recordExternalMeasurement(
  input: ExternalMeasurementInput
): Promise<ExternalMeasurementResult> {
  const { userId, experimentId } = input;

  if (!Number.isInteger(input.observedValue) || input.observedValue < 0) {
    return { recorded: false, reason: "INVALID_VALUE" };
  }
  if (!Number.isInteger(input.observedTotal) || input.observedTotal < input.observedValue) {
    return { recorded: false, reason: "INVALID_VALUE" };
  }
  if (input.provenance.trim().length === 0 || input.unit.trim().length === 0) {
    return { recorded: false, reason: "INVALID_VALUE" };
  }

  const experiment = await db.experiment.findFirst({
    where: { id: experimentId, userId },
    include: { measurement: true },
  });
  if (!experiment) return { recorded: false, reason: "NOT_FOUND" };
  if (experiment.measurement) return { recorded: false, reason: "ALREADY_MEASURED" };
  if (experiment.executionRunId !== null) return { recorded: false, reason: "EXECUTION_EXISTS" };

  const digest = measurementDigest({
    experimentId,
    source: "HUMAN_ENTERED",
    agentRunId: null,
    agentStepId: null,
    rule: "HUMAN_ENTERED",
    unit: input.unit,
    observedValue: input.observedValue,
    observedTotal: input.observedTotal,
    provenance: input.provenance,
  });

  let measurement: ExperimentMeasurement;
  try {
    measurement = await db.experimentMeasurement.create({
      data: {
        userId,
        experimentId,
        source: "HUMAN_ENTERED",
        agentRunId: null,
        agentStepId: null,
        observedValue: input.observedValue,
        observedTotal: input.observedTotal,
        unit: input.unit,
        rule: "HUMAN_ENTERED",
        provenance: input.provenance,
        digest,
      },
    });
  } catch {
    return { recorded: false, reason: "ALREADY_MEASURED" };
  }

  await recordEvent({
    userId,
    type: "economic.experiment.measurement.recorded",
    subjectType: "Experiment",
    subjectId: experimentId,
    consequential: true,
    payload: {
      measurementId: measurement.id,
      source: "HUMAN_ENTERED",
      rule: "HUMAN_ENTERED",
      observedValue: input.observedValue,
      observedTotal: input.observedTotal,
      provenance: input.provenance,
      digest,
    },
  });

  return { recorded: true, measurement };
}

// ---------------------------------------------------------------------------
// Read surfaces
// ---------------------------------------------------------------------------

export interface ExperimentEvidence {
  experimentId: string;
  hypothesis: string;
  stage: EvidenceStage;
  observationRule: string | null;
  /** The rule's own words about what it measures and what it does not. */
  ruleMethod: string | null;
  ruleDoesNotEstablish: string | null;
  executionRunId: string | null;
  runStatus: AgentRun["status"] | null;
  /** Why the last observation attempt produced nothing. Diagnostic only. */
  lastObservationFailure: string | null;
  lastObservationAttemptAt: Date | null;
  measurement: MeasurementProjection | null;
  outcome: {
    verdict: Experiment["outcome"];
    recordedAt: Date | null;
    basis: Experiment["outcomeEvidenceBasis"];
    measurementId: string | null;
    note: string | null;
  } | null;
}

export interface MeasurementProjection {
  id: string;
  source: ExperimentMeasurement["source"];
  observedValue: number;
  observedTotal: number;
  unit: string;
  rule: string;
  provenance: string;
  agentRunId: string | null;
  agentStepId: string | null;
  observedAt: Date;
  /**
   * [P5-F] The monetary amount, or NULL when this measurement is a count.
   *
   * Null rather than zero, and a surface must render it as an absence. A value
   * measurement that failed to record its currency has no business displaying
   * its integer.
   */
  money: {
    amountMinor: number;
    amountScale: number;
    currency: string;
    /** Rendered with its currency code, never with an assumed symbol. */
    formatted: string;
  } | null;
  /** Null for a measurement of VOX's own execution. */
  external: {
    provider: string;
    scope: string;
    retrievedAt: Date | null;
    responseDigest: string | null;
    windowStart: Date | null;
    windowEnd: Date | null;
    semantics: MeasurementSemantics | null;
  } | null;
}

/**
 * One mapping from row to projection, used by both readers.
 *
 * Extracted rather than copied because a projection that says different things
 * depending on which function produced it is exactly how a surface ends up
 * showing a measurement without its provenance.
 */
function projectMeasurement(measurement: ExperimentMeasurement | null): MeasurementProjection | null {
  if (!measurement) return null;
  return {
    id: measurement.id,
    source: measurement.source,
    observedValue: measurement.observedValue,
    observedTotal: measurement.observedTotal,
    unit: measurement.unit,
    rule: measurement.rule,
    provenance: measurement.provenance,
    agentRunId: measurement.agentRunId,
    agentStepId: measurement.agentStepId,
    observedAt: measurement.observedAt,
    // All three or nothing. A partially-recorded amount is rendered as no
    // amount, because an integer without its currency is not a monetary fact.
    money:
      measurement.observedAmountMinor !== null &&
      measurement.observedAmountScale !== null &&
      measurement.observedCurrency !== null
        ? {
            amountMinor: measurement.observedAmountMinor,
            amountScale: measurement.observedAmountScale,
            currency: measurement.observedCurrency,
            formatted: formatMinor(
              measurement.observedAmountMinor,
              measurement.observedAmountScale,
              measurement.observedCurrency
            ),
          }
        : null,
    external: measurement.externalProvider
      ? {
          provider: measurement.externalProvider,
          scope: measurement.externalScope ?? "",
          retrievedAt: measurement.retrievedAt,
          responseDigest: measurement.responseDigest,
          windowStart: measurement.windowStart,
          windowEnd: measurement.windowEnd,
          semantics: measurement.semantics,
        }
      : null,
  };
}

export async function getExperimentEvidence(
  userId: string,
  experimentId: string
): Promise<ExperimentEvidence | null> {
  const experiment = await db.experiment.findFirst({
    where: { id: experimentId, userId },
    include: { measurement: true },
  });
  if (!experiment) return null;

  const run = experiment.executionRunId ? await getAgentRun(userId, experiment.executionRunId) : null;
  const rule = getObservationRule(experiment.observationRule);

  return {
    experimentId: experiment.id,
    hypothesis: experiment.hypothesis,
    stage: deriveEvidenceStage({
      outcomeRecordedAt: experiment.outcomeRecordedAt,
      executionRunId: experiment.executionRunId,
      hasMeasurement: experiment.measurement !== null,
      runStatus: run?.status ?? null,
      anyStepInDoubt: run ? stepsInDoubt(run) : false,
    }),
    observationRule: experiment.observationRule,
    ruleMethod: rule?.method ?? null,
    ruleDoesNotEstablish: rule?.doesNotEstablish ?? null,
    executionRunId: experiment.executionRunId,
    runStatus: run?.status ?? null,
    lastObservationFailure: experiment.lastObservationFailure,
    lastObservationAttemptAt: experiment.lastObservationAttemptAt,
    measurement: projectMeasurement(experiment.measurement),
    outcome:
      experiment.outcomeRecordedAt === null
        ? null
        : {
            verdict: experiment.outcome,
            recordedAt: experiment.outcomeRecordedAt,
            basis: experiment.outcomeEvidenceBasis,
            measurementId: experiment.outcomeMeasurementId,
            note: experiment.outcomeNote,
          },
  };
}

export async function listExperimentEvidence(userId: string, limit = 50): Promise<ExperimentEvidence[]> {
  const experiments = await db.experiment.findMany({
    where: { userId },
    include: { measurement: true },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  // The runs are fetched in one query rather than one per experiment. A list
  // surface that issues N+1 queries is how a read page becomes the slowest thing
  // in the app once a user has a hundred experiments.
  const runIds = experiments.map((e) => e.executionRunId).filter((id): id is string => id !== null);
  const runs = runIds.length
    ? await db.agentRun.findMany({ where: { id: { in: runIds }, userId }, include: { steps: true } })
    : [];
  const runById = new Map(runs.map((r) => [r.id, r]));

  return experiments.map((experiment) => {
    const run = experiment.executionRunId ? runById.get(experiment.executionRunId) ?? null : null;
    const rule = getObservationRule(experiment.observationRule);
    return {
      experimentId: experiment.id,
      hypothesis: experiment.hypothesis,
      stage: deriveEvidenceStage({
        outcomeRecordedAt: experiment.outcomeRecordedAt,
        executionRunId: experiment.executionRunId,
        hasMeasurement: experiment.measurement !== null,
        runStatus: run?.status ?? null,
        anyStepInDoubt: run ? stepsInDoubt(run) : false,
      }),
      observationRule: experiment.observationRule,
      ruleMethod: rule?.method ?? null,
      ruleDoesNotEstablish: rule?.doesNotEstablish ?? null,
      executionRunId: experiment.executionRunId,
      runStatus: run?.status ?? null,
      lastObservationFailure: experiment.lastObservationFailure,
      lastObservationAttemptAt: experiment.lastObservationAttemptAt,
      measurement: projectMeasurement(experiment.measurement),
      outcome:
        experiment.outcomeRecordedAt === null
          ? null
          : {
              verdict: experiment.outcome,
              recordedAt: experiment.outcomeRecordedAt,
              basis: experiment.outcomeEvidenceBasis,
              measurementId: experiment.outcomeMeasurementId,
              note: experiment.outcomeNote,
            },
    };
  });
}

/**
 * The full provenance chain for one experiment, as rows rather than as prose.
 *
 * Exists so the question "where did this number come from" has a single answer
 * a person can follow end to end: the experiment, the rule it declared, the run
 * that executed, the step that produced the output, the measurement computed
 * from it, and the verdict recorded against it.
 */
export interface EvidenceLineage {
  experimentId: string;
  declaredRule: string | null;
  run: { id: string; status: AgentRun["status"]; createdAt: Date; completedAt: Date | null } | null;
  step: {
    id: string;
    toolName: string | null;
    status: AgentStep["status"];
    capability: string | null;
    requiredLevel: AgentStep["requiredLevel"];
    completedAt: Date | null;
  } | null;
  measurement: MeasurementProjection | null;
  verdict: {
    outcome: Experiment["outcome"];
    recordedAt: Date;
    basis: Experiment["outcomeEvidenceBasis"];
    /** Whether the measurement still hashes to what the verdict was recorded against. */
    digestMatchesMeasurement: boolean | null;
  } | null;
}

export async function getEvidenceLineage(
  userId: string,
  experimentId: string
): Promise<EvidenceLineage | null> {
  const experiment = await db.experiment.findFirst({
    where: { id: experimentId, userId },
    include: { measurement: true },
  });
  if (!experiment) return null;

  const run = experiment.executionRunId ? await getAgentRun(userId, experiment.executionRunId) : null;
  const step = experiment.measurement?.agentStepId
    ? run?.steps.find((s) => s.id === experiment.measurement!.agentStepId) ?? null
    : null;

  return {
    experimentId: experiment.id,
    declaredRule: experiment.observationRule,
    run: run ? { id: run.id, status: run.status, createdAt: run.createdAt, completedAt: run.completedAt } : null,
    step: step
      ? {
          id: step.id,
          toolName: step.toolName,
          status: step.status,
          capability: step.capability,
          requiredLevel: step.requiredLevel,
          completedAt: step.completedAt,
        }
      : null,
    measurement: projectMeasurement(experiment.measurement),
    verdict:
      experiment.outcomeRecordedAt === null
        ? null
        : {
            outcome: experiment.outcome,
            recordedAt: experiment.outcomeRecordedAt,
            basis: experiment.outcomeEvidenceBasis,
            digestMatchesMeasurement:
              experiment.outcomeMeasurementDigest === null
                ? null
                : experiment.measurement !== null &&
                  experiment.measurement.digest === experiment.outcomeMeasurementDigest,
          },
  };
}

// ---------------------------------------------------------------------------
// Integrity
// ---------------------------------------------------------------------------

export type IntegrityFinding =
  /** The stored digest does not match the row's own contents. Edited in place. */
  | "MEASUREMENT_DIGEST_MISMATCH"
  /** A verdict rests on a measurement that no longer exists. */
  | "MEASUREMENT_MISSING_FOR_VERDICT"
  /** A verdict rests on a measurement whose contents have since changed. */
  | "VERDICT_DIGEST_MISMATCH"
  /** A measurement claims an execution that does not exist or is not this user's. */
  | "ORPHANED_EXECUTION_REFERENCE";

export interface IntegrityIssue {
  finding: IntegrityFinding;
  experimentId: string;
  measurementId: string | null;
  detail: string;
}

/**
 * Re-derives every machine-produced measurement's digest from the row itself and
 * reports where the arithmetic no longer holds.
 *
 * Scoped to machine-observed sources because a human-entered row's digest covers
 * what a person typed, and a person editing their own figure is an ordinary
 * correction rather than tampering with VOX's observation. Machine measurements
 * are different: nobody is supposed to be able to change them at all.
 *
 * READ-ONLY. It reports; it repairs nothing and deletes nothing. A tool that
 * "fixed" a mismatch by recomputing the digest would be a tool for erasing the
 * evidence that a measurement had been altered.
 */
export async function verifyEvidenceIntegrity(userId: string): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];

  const measurements = await db.experimentMeasurement.findMany({
    where: { userId, source: { in: ["MACHINE_OBSERVED", "EXTERNAL_OBSERVED"] } },
  });

  for (const measurement of measurements) {
    const expected = recomputeMeasurementDigest(measurement.experimentId, measurement);
    if (expected !== measurement.digest) {
      issues.push({
        finding: "MEASUREMENT_DIGEST_MISMATCH",
        experimentId: measurement.experimentId,
        measurementId: measurement.id,
        detail:
          "The measurement's stored digest does not match its own contents. The row was changed after it was written.",
      });
    }
    if (measurement.agentRunId) {
      const run = await db.agentRun.findFirst({
        where: { id: measurement.agentRunId, userId },
        select: { id: true },
      });
      if (!run) {
        issues.push({
          finding: "ORPHANED_EXECUTION_REFERENCE",
          experimentId: measurement.experimentId,
          measurementId: measurement.id,
          detail: "The measurement names an execution that no longer exists for this user.",
        });
      }
    }
  }

  const reconciled = await db.experiment.findMany({
    where: { userId, outcomeRecordedAt: { not: null }, outcomeMeasurementId: { not: null } },
    include: { measurement: true },
  });

  for (const experiment of reconciled) {
    if (!experiment.measurement) {
      issues.push({
        finding: "MEASUREMENT_MISSING_FOR_VERDICT",
        experimentId: experiment.id,
        measurementId: experiment.outcomeMeasurementId,
        detail:
          "A verdict was recorded against a measurement that has since been deleted. The verdict still stands; the evidence behind it does not.",
      });
      continue;
    }
    if (
      experiment.outcomeMeasurementDigest !== null &&
      experiment.measurement.digest !== experiment.outcomeMeasurementDigest
    ) {
      issues.push({
        finding: "VERDICT_DIGEST_MISMATCH",
        experimentId: experiment.id,
        measurementId: experiment.measurement.id,
        detail:
          "The measurement this verdict rests on has changed since the verdict was recorded. What was decided is not what the row now says.",
      });
    }
  }

  return issues;
}
