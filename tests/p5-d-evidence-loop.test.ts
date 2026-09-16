/**
 * [P5-D] THE EXPERIMENT EVIDENCE LOOP — adversarial tests.
 *
 * The question these ask is not "does the happy path work". It is: can a number
 * that nobody measured end up counted as evidence? Every test below is an
 * attempt to make that happen, and each one that passes is a route that is
 * closed.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { readFileSync } from "node:fs";
import { grantPermission } from "@/lib/permissions/service";
import {
  OBSERVATION_RULES,
  deriveEvidenceStage,
  getEvidenceLineage,
  getExperimentEvidence,
  getObservationRule,
  isMachineObserved,
  isNotObserved,
  listExperimentEvidence,
  measurementDigest,
  observeExperimentExecution,
  recordExternalMeasurement,
  requestExperimentExecution,
  verifyEvidenceIntegrity,
} from "@/lib/economic/evidence";
import { getMeasuredProbability, reconcileExperimentOutcome } from "@/lib/economic/probability";
import { createTestUser, approveAndResume } from "./helpers";
import type { User } from "@/generated/prisma/client";

let user: User;
let other: User;

beforeAll(async () => {
  user = await createTestUser();
  other = await createTestUser();
  // `research.run` needs RECOMMEND and is a policy HOLD, so every dispatch below
  // parks for a human. That is the real path and the tests walk it.
  await grantPermission(user.id, "research.web", "RECOMMEND");
  await grantPermission(other.id, "research.web", "RECOMMEND");
});

async function makeExperiment(
  owner: User = user,
  overrides: Record<string, unknown> = {}
) {
  return db.experiment.create({
    data: {
      userId: owner.id,
      hypothesis: `Hypothesis ${Math.random().toString(36).slice(2)}`,
      observationRule: "RESEARCH_SOURCED_RESULTS",
      ...overrides,
    },
  });
}

/** Dispatches and plays the human through the approval the policy gate demands. */
async function dispatchAndApprove(experimentId: string, owner: User = user) {
  const result = await requestExperimentExecution(owner.id, experimentId);
  if (result.dispatched) await approveAndResume(owner.id, result.runId);
  return result;
}

// ---------------------------------------------------------------------------
// The rule registry is closed
// ---------------------------------------------------------------------------

describe("the observation registry is frozen", () => {
  it("cannot be extended at runtime", () => {
    expect(() => {
      (OBSERVATION_RULES as Record<string, unknown>).INVENTED_RULE = {};
    }).toThrow();
    expect(OBSERVATION_RULES.INVENTED_RULE).toBeUndefined();
  });

  it("cannot have an existing rule rewritten to count something else", () => {
    const rule = OBSERVATION_RULES.RESEARCH_SOURCED_RESULTS;
    expect(() => {
      (rule as unknown as { unit: string }).unit = "dollars of revenue";
    }).toThrow();
    expect(rule.unit).toBe("research results carrying a source URL");
  });

  it("refuses a rule key that is not in the registry", () => {
    expect(getObservationRule("REVENUE_I_JUST_MADE_UP")).toBeNull();
    expect(getObservationRule(null)).toBeNull();
  });

  it("every rule states what it does not establish", () => {
    for (const rule of Object.values(OBSERVATION_RULES)) {
      expect(rule.doesNotEstablish.length).toBeGreaterThan(40);
      expect(rule.method.length).toBeGreaterThan(40);
      expect(rule.unit.length).toBeGreaterThan(0);
    }
  });

  it("no rule claims to measure revenue, profit or conversion", () => {
    // A tripwire. If a future rule's unit says "revenue", the claim it makes is
    // categorically larger than anything this module can support, and it should
    // fail here before it reaches a surface.
    for (const rule of Object.values(OBSERVATION_RULES)) {
      expect(rule.unit.toLowerCase()).not.toMatch(/revenue|profit|margin|conversion/);
    }
  });
});

// ---------------------------------------------------------------------------
// The derived stage
// ---------------------------------------------------------------------------

describe("evidence stage is derived, never stored", () => {
  const base = {
    outcomeRecordedAt: null,
    executionRunId: null,
    hasMeasurement: false,
    runStatus: null,
    anyStepInDoubt: false,
  } as const;

  it("nothing dispatched", () => {
    expect(deriveEvidenceStage(base)).toBe("NOT_DISPATCHED");
  });

  it("a verdict outranks everything else", () => {
    expect(
      deriveEvidenceStage({ ...base, outcomeRecordedAt: new Date(), executionRunId: "r", runStatus: "RUNNING" })
    ).toBe("RECONCILED");
  });

  it("an in-doubt step outranks a run that says COMPLETED", () => {
    // The whole point: a run row can read COMPLETED while carrying a step whose
    // end was never recorded. The unknown wins.
    expect(
      deriveEvidenceStage({ ...base, executionRunId: "r", runStatus: "COMPLETED", anyStepInDoubt: true })
    ).toBe("IN_DOUBT");
  });

  it("an execution identity pointing at no run is in doubt, not failed", () => {
    expect(deriveEvidenceStage({ ...base, executionRunId: "r", runStatus: null })).toBe("IN_DOUBT");
  });

  it("maps every run status to a stage", () => {
    const cases: [string, string][] = [
      ["COMPLETED", "AWAITING_OBSERVATION"],
      ["FAILED", "EXECUTION_FAILED"],
      ["CANCELLED", "EXECUTION_FAILED"],
      ["WAITING_FOR_PERMISSION", "AWAITING_AUTHORIZATION"],
      ["RUNNING", "EXECUTING"],
      ["PLANNING", "EXECUTING"],
      ["WAITING", "EXECUTING"],
    ];
    for (const [status, expected] of cases) {
      expect(
        deriveEvidenceStage({ ...base, executionRunId: "r", runStatus: status as never })
      ).toBe(expected);
    }
  });

  it("a measurement with no execution is recorded, not dispatched", () => {
    expect(deriveEvidenceStage({ ...base, hasMeasurement: true })).toBe("MEASUREMENT_RECORDED");
  });
});

// ---------------------------------------------------------------------------
// Dispatch: exactly one execution per experiment
// ---------------------------------------------------------------------------

describe("dispatch claims exactly one execution identity", () => {
  it("runs the declared rule's tool through the real executor", async () => {
    const experiment = await makeExperiment();
    const result = await requestExperimentExecution(user.id, experiment.id);
    expect(result.dispatched).toBe(true);
    if (!result.dispatched) return;

    const run = await db.agentRun.findUnique({ where: { id: result.runId }, include: { steps: true } });
    expect(run?.steps).toHaveLength(1);
    expect(run?.steps[0].toolName).toBe("research.run");
    // The capability gate ran: the step carries what the executor checked.
    expect(run?.steps[0].capability).toBe("research.web");
  });

  it("parks for the human the policy gate demands rather than executing", async () => {
    const experiment = await makeExperiment();
    const result = await requestExperimentExecution(user.id, experiment.id);
    expect(result.dispatched).toBe(true);
    if (!result.dispatched) return;
    // `research.run` is a HOLD. Dispatch does not get to skip that.
    expect(result.stage).toBe("AWAITING_AUTHORIZATION");
  });

  it("refuses a second dispatch", async () => {
    const experiment = await makeExperiment();
    await dispatchAndApprove(experiment.id);
    const second = await requestExperimentExecution(user.id, experiment.id);
    expect(second).toEqual({ dispatched: false, reason: "ALREADY_DISPATCHED" });
  });

  it("two concurrent dispatches produce exactly one execution", async () => {
    const experiment = await makeExperiment();
    const [a, b] = await Promise.all([
      requestExperimentExecution(user.id, experiment.id),
      requestExperimentExecution(user.id, experiment.id),
    ]);

    const dispatched = [a, b].filter((r) => r.dispatched);
    expect(dispatched).toHaveLength(1);

    const loser = [a, b].find((r) => !r.dispatched);
    expect(loser && "reason" in loser ? loser.reason : null).toMatch(
      /DISPATCH_RACE_LOST|ALREADY_DISPATCHED/
    );

    const after = await db.experiment.findUnique({ where: { id: experiment.id } });
    expect(after?.executionRunId).not.toBeNull();
  });

  it("the losing dispatch leaves no orphan run pretending to be work", async () => {
    const experiment = await makeExperiment();
    const [a, b] = await Promise.all([
      requestExperimentExecution(user.id, experiment.id),
      requestExperimentExecution(user.id, experiment.id),
    ]);
    const winner = [a, b].find((r) => r.dispatched);
    expect(winner?.dispatched).toBe(true);
    if (!winner?.dispatched) return;

    const runs = await db.agentRun.findMany({
      where: { userId: user.id, objective: { contains: experiment.hypothesis.slice(0, 40) } },
    });
    const live = runs.filter((r) => r.status !== "CANCELLED");
    expect(live).toHaveLength(1);
    expect(live[0].id).toBe(winner.runId);
  });

  it("refuses an experiment that declared no rule", async () => {
    const experiment = await makeExperiment(user, { observationRule: null });
    expect(await requestExperimentExecution(user.id, experiment.id)).toEqual({
      dispatched: false,
      reason: "NO_OBSERVATION_RULE",
    });
  });

  it("refuses a rule key outside the frozen registry", async () => {
    const experiment = await makeExperiment(user, { observationRule: "REVENUE_FROM_NOWHERE" });
    expect(await requestExperimentExecution(user.id, experiment.id)).toEqual({
      dispatched: false,
      reason: "UNKNOWN_OBSERVATION_RULE",
    });
  });

  it("refuses to re-run an experiment that already has a verdict", async () => {
    const experiment = await makeExperiment();
    await reconcileExperimentOutcome({ userId: user.id, experimentId: experiment.id, verdict: "LOSS" });
    expect(await requestExperimentExecution(user.id, experiment.id)).toEqual({
      dispatched: false,
      reason: "ALREADY_RECONCILED",
    });
  });

  it("cannot dispatch another user's experiment", async () => {
    const experiment = await makeExperiment(other);
    expect(await requestExperimentExecution(user.id, experiment.id)).toEqual({
      dispatched: false,
      reason: "NOT_FOUND",
    });
  });
});

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

describe("observation writes at most one measurement", () => {
  it("measures the execution's own persisted output", async () => {
    const experiment = await makeExperiment();
    await dispatchAndApprove(experiment.id);

    const result = await observeExperimentExecution(user.id, experiment.id);
    expect(result.observed).toBe(true);
    if (!result.observed) return;

    const step = await db.agentStep.findUnique({ where: { id: result.measurement.agentStepId! } });
    const output = JSON.parse(step!.output!) as { sourceUrl: string | null }[];
    const sourced = output.filter((r) => typeof r.sourceUrl === "string" && r.sourceUrl.length > 0);

    // Recomputed by hand from the row the executor wrote — not trusted from the
    // function under test.
    expect(result.measurement.observedValue).toBe(sourced.length);
    expect(result.measurement.observedTotal).toBe(output.length);
    expect(result.measurement.source).toBe("MACHINE_OBSERVED");
    expect(isMachineObserved(result.measurement.source)).toBe(true);
  });

  it("names the provider that answered, so a mock count reads as a mock count", async () => {
    const experiment = await makeExperiment();
    await dispatchAndApprove(experiment.id);
    const result = await observeExperimentExecution(user.id, experiment.id);
    expect(result.observed).toBe(true);
    if (!result.observed) return;
    expect(result.measurement.provenance).toMatch(/research provider: /);
    expect(result.measurement.provenance).toContain("mock");
  });

  it("is idempotent — a second observation writes nothing", async () => {
    const experiment = await makeExperiment();
    await dispatchAndApprove(experiment.id);
    await observeExperimentExecution(user.id, experiment.id);
    const second = await observeExperimentExecution(user.id, experiment.id);
    expect(second).toEqual({ observed: false, reason: "ALREADY_MEASURED" });
    expect(await db.experimentMeasurement.count({ where: { experimentId: experiment.id } })).toBe(1);
  });

  it("two concurrent observers still produce exactly one measurement", async () => {
    const experiment = await makeExperiment();
    await dispatchAndApprove(experiment.id);
    const [a, b] = await Promise.all([
      observeExperimentExecution(user.id, experiment.id),
      observeExperimentExecution(user.id, experiment.id),
    ]);
    expect([a.observed, b.observed].filter(Boolean)).toHaveLength(1);
    expect(await db.experimentMeasurement.count({ where: { experimentId: experiment.id } })).toBe(1);
  });

  it("refuses an execution that has not completed", async () => {
    const experiment = await makeExperiment();
    // Dispatched but the human has not approved, so it is parked.
    await requestExperimentExecution(user.id, experiment.id);
    expect((await observeExperimentExecution(user.id, experiment.id)).observed).toBe(false);
    const again = await observeExperimentExecution(user.id, experiment.id);
    expect(again.observed === false && again.reason).toBe("EXECUTION_NOT_COMPLETED");
  });

  it("refuses a step whose end was never recorded, rather than guessing", async () => {
    const experiment = await makeExperiment();
    const dispatch = await dispatchAndApprove(experiment.id);
    expect(dispatch.dispatched).toBe(true);
    if (!dispatch.dispatched) return;

    // Simulate the crash: the process died between "RUNNING" and the result
    // being persisted. The run row still says COMPLETED.
    await db.agentStep.updateMany({
      where: { runId: dispatch.runId },
      data: { status: "RUNNING" },
    });

    const result = await observeExperimentExecution(user.id, experiment.id);
    expect(result).toEqual({ observed: false, reason: "EXECUTION_IN_DOUBT" });
  });

  it("refuses output that is not the shape the rule reads — and writes no zero", async () => {
    const experiment = await makeExperiment();
    const dispatch = await dispatchAndApprove(experiment.id);
    expect(dispatch.dispatched).toBe(true);
    if (!dispatch.dispatched) return;

    await db.agentStep.updateMany({
      where: { runId: dispatch.runId },
      data: { output: JSON.stringify({ unexpected: "shape" }) },
    });

    const result = await observeExperimentExecution(user.id, experiment.id);
    expect(result).toEqual({ observed: false, reason: "UNREADABLE_OUTPUT" });
    expect(await db.experimentMeasurement.count({ where: { experimentId: experiment.id } })).toBe(0);
  });

  it("refuses unparseable output without throwing", async () => {
    const experiment = await makeExperiment();
    const dispatch = await dispatchAndApprove(experiment.id);
    if (!dispatch.dispatched) return;
    await db.agentStep.updateMany({ where: { runId: dispatch.runId }, data: { output: "{not json" } });
    expect(await observeExperimentExecution(user.id, experiment.id)).toEqual({
      observed: false,
      reason: "UNREADABLE_OUTPUT",
    });
  });

  it("an empty result set is a real zero with an honest provenance", async () => {
    const experiment = await makeExperiment();
    const dispatch = await dispatchAndApprove(experiment.id);
    if (!dispatch.dispatched) return;
    await db.agentStep.updateMany({ where: { runId: dispatch.runId }, data: { output: "[]" } });

    const result = await observeExperimentExecution(user.id, experiment.id);
    expect(result.observed).toBe(true);
    if (!result.observed) return;
    // Zero out of zero is a fact about this execution. It is recorded, and its
    // provenance says no provider answered rather than blaming one.
    expect(result.measurement.observedValue).toBe(0);
    expect(result.measurement.observedTotal).toBe(0);
    expect(result.measurement.provenance).toContain("none");
  });

  it("cannot observe another user's experiment", async () => {
    const experiment = await makeExperiment(other);
    await dispatchAndApprove(experiment.id, other);
    expect(await observeExperimentExecution(user.id, experiment.id)).toEqual({
      observed: false,
      reason: "NOT_FOUND",
    });
  });

  it("an explicit non-answer writes a diagnostic and no measurement", () => {
    // The refusal shape itself, checked directly: the type says a non-answer
    // carries no value, so there is no field a `?? 0` could read.
    const notObserved = { notObserved: true as const, failure: "PROVIDER_DOWN", detail: "no answer" };
    expect(isNotObserved(notObserved)).toBe(true);
    expect("observedValue" in notObserved).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Human-entered measurement
// ---------------------------------------------------------------------------

describe("a human-entered figure is never VOX's observation", () => {
  it("records with HUMAN_ENTERED source and a stated provenance", async () => {
    const experiment = await makeExperiment();
    const result = await recordExternalMeasurement({
      userId: user.id,
      experimentId: experiment.id,
      observedValue: 3,
      observedTotal: 10,
      unit: "signups",
      provenance: "Counted by hand in the Stripe dashboard",
    });
    expect(result.recorded).toBe(true);
    if (!result.recorded) return;
    expect(result.measurement.source).toBe("HUMAN_ENTERED");
    expect(isMachineObserved(result.measurement.source)).toBe(false);
  });

  it("refuses once VOX has executed the experiment", async () => {
    const experiment = await makeExperiment();
    await dispatchAndApprove(experiment.id);
    // This is the attack: type a number over an execution VOX performed, so it
    // renders with a real run and step behind it while resting on nobody.
    expect(
      await recordExternalMeasurement({
        userId: user.id,
        experimentId: experiment.id,
        observedValue: 999,
        observedTotal: 999,
        unit: "sales",
        provenance: "I remember it going well",
      })
    ).toEqual({ recorded: false, reason: "EXECUTION_EXISTS" });
  });

  it("refuses a number with no stated source", async () => {
    const experiment = await makeExperiment();
    expect(
      await recordExternalMeasurement({
        userId: user.id,
        experimentId: experiment.id,
        observedValue: 5,
        observedTotal: 5,
        unit: "sales",
        provenance: "   ",
      })
    ).toEqual({ recorded: false, reason: "INVALID_VALUE" });
  });

  it("refuses a numerator larger than its denominator", async () => {
    const experiment = await makeExperiment();
    expect(
      await recordExternalMeasurement({
        userId: user.id,
        experimentId: experiment.id,
        observedValue: 11,
        observedTotal: 10,
        unit: "sales",
        provenance: "dashboard",
      })
    ).toEqual({ recorded: false, reason: "INVALID_VALUE" });
  });

  it("refuses negative and fractional values", async () => {
    const experiment = await makeExperiment();
    for (const observedValue of [-1, 1.5]) {
      expect(
        await recordExternalMeasurement({
          userId: user.id,
          experimentId: experiment.id,
          observedValue,
          observedTotal: 10,
          unit: "sales",
          provenance: "dashboard",
        })
      ).toEqual({ recorded: false, reason: "INVALID_VALUE" });
    }
  });
});

// ---------------------------------------------------------------------------
// Reconciliation — the only path to a verdict
// ---------------------------------------------------------------------------

describe("only a human turns a measurement into evidence", () => {
  it("refuses a verdict on an execution nobody observed", async () => {
    const experiment = await makeExperiment();
    await dispatchAndApprove(experiment.id);
    // Executed, never observed. This is the case the whole refusal exists for.
    expect(
      await reconcileExperimentOutcome({ userId: user.id, experimentId: experiment.id, verdict: "WIN" })
    ).toEqual({ reconciled: false, reason: "MEASUREMENT_MISSING" });

    const after = await db.experiment.findUnique({ where: { id: experiment.id } });
    expect(after?.outcome).toBe("PENDING");
    expect(after?.outcomeRecordedAt).toBeNull();
  });

  it("allows a verdict on an experiment VOX never executed", async () => {
    const experiment = await makeExperiment();
    const result = await reconcileExperimentOutcome({
      userId: user.id,
      experimentId: experiment.id,
      verdict: "WIN",
      note: "We shipped it and it worked.",
    });
    expect(result.reconciled).toBe(true);
    if (!result.reconciled) return;
    // The basis says plainly that this rests on the person, not on VOX.
    expect(result.basis).toBe("HUMAN_EXTERNAL");
  });

  it("records MACHINE_MEASUREMENT when VOX observed its own execution", async () => {
    const experiment = await makeExperiment();
    await dispatchAndApprove(experiment.id);
    await observeExperimentExecution(user.id, experiment.id);

    const result = await reconcileExperimentOutcome({
      userId: user.id,
      experimentId: experiment.id,
      verdict: "LOSS",
    });
    expect(result.reconciled).toBe(true);
    if (!result.reconciled) return;
    expect(result.basis).toBe("MACHINE_MEASUREMENT");
    expect(result.measurementId).not.toBeNull();
  });

  it("binds the digest the measurement had at that moment", async () => {
    const experiment = await makeExperiment();
    await dispatchAndApprove(experiment.id);
    const observed = await observeExperimentExecution(user.id, experiment.id);
    expect(observed.observed).toBe(true);
    if (!observed.observed) return;

    await reconcileExperimentOutcome({ userId: user.id, experimentId: experiment.id, verdict: "WIN" });
    const after = await db.experiment.findUnique({ where: { id: experiment.id } });
    expect(after?.outcomeMeasurementDigest).toBe(observed.measurement.digest);
  });

  it("refuses a second verdict", async () => {
    const experiment = await makeExperiment();
    await reconcileExperimentOutcome({ userId: user.id, experimentId: experiment.id, verdict: "WIN" });
    expect(
      await reconcileExperimentOutcome({ userId: user.id, experimentId: experiment.id, verdict: "LOSS" })
    ).toEqual({ reconciled: false, reason: "ALREADY_RECONCILED" });
    const after = await db.experiment.findUnique({ where: { id: experiment.id } });
    expect(after?.outcome).toBe("WIN");
  });

  it("two concurrent verdicts record exactly one", async () => {
    const experiment = await makeExperiment();
    const [a, b] = await Promise.all([
      reconcileExperimentOutcome({ userId: user.id, experimentId: experiment.id, verdict: "WIN" }),
      reconcileExperimentOutcome({ userId: user.id, experimentId: experiment.id, verdict: "LOSS" }),
    ]);
    expect([a.reconciled, b.reconciled].filter(Boolean)).toHaveLength(1);
  });

  it("refuses PENDING and KILLED_BY_CONSTRAINT as human verdicts", async () => {
    const experiment = await makeExperiment();
    for (const verdict of ["PENDING", "KILLED_BY_CONSTRAINT", "nonsense"]) {
      expect(
        await reconcileExperimentOutcome({
          userId: user.id,
          experimentId: experiment.id,
          verdict: verdict as never,
        })
      ).toEqual({ reconciled: false, reason: "INVALID_VERDICT" });
    }
  });

  it("cannot reconcile another user's experiment", async () => {
    const experiment = await makeExperiment(other);
    expect(
      await reconcileExperimentOutcome({ userId: user.id, experimentId: experiment.id, verdict: "WIN" })
    ).toEqual({ reconciled: false, reason: "NOT_FOUND" });
  });
});

// ---------------------------------------------------------------------------
// The probability
// ---------------------------------------------------------------------------

describe("measured probability counts verdicts and nothing else", () => {
  it("is null, not zero, when nothing has been decided", async () => {
    const fresh = await createTestUser();
    const evidence = await getMeasuredProbability({ userId: fresh.id });
    expect(evidence.probability).toBeNull();
    expect(evidence.decided).toBe(0);
  });

  it("does not count an outcome that no human recorded", async () => {
    const fresh = await createTestUser();
    // The attack: write WIN straight onto the row, bypassing reconciliation.
    // `outcomeRecordedAt` stays null, so it is an enum value and not a verdict.
    await db.experiment.create({
      data: { userId: fresh.id, hypothesis: "Smuggled win", outcome: "WIN" },
    });
    const evidence = await getMeasuredProbability({ userId: fresh.id });
    expect(evidence.decided).toBe(0);
    expect(evidence.probability).toBeNull();
  });

  it("counts wins over decided experiments", async () => {
    const fresh = await createTestUser();
    for (const verdict of ["WIN", "WIN", "LOSS"] as const) {
      const e = await db.experiment.create({ data: { userId: fresh.id, hypothesis: `h-${verdict}-${Math.random()}` } });
      await reconcileExperimentOutcome({ userId: fresh.id, experimentId: e.id, verdict });
    }
    const evidence = await getMeasuredProbability({ userId: fresh.id });
    expect(evidence.wins).toBe(2);
    expect(evidence.losses).toBe(1);
    expect(evidence.decided).toBe(3);
    expect(evidence.probability).toBeCloseTo(2 / 3);
  });

  it("excludes INCONCLUSIVE from both numerator and denominator", async () => {
    const fresh = await createTestUser();
    for (const verdict of ["WIN", "INCONCLUSIVE", "INCONCLUSIVE"] as const) {
      const e = await db.experiment.create({ data: { userId: fresh.id, hypothesis: `h-${verdict}-${Math.random()}` } });
      await reconcileExperimentOutcome({ userId: fresh.id, experimentId: e.id, verdict });
    }
    const evidence = await getMeasuredProbability({ userId: fresh.id });
    // Not 1/3, and not 1/1 by accident — 1 win out of 1 trial, with two
    // undecided trials reported separately.
    expect(evidence.decided).toBe(1);
    expect(evidence.inconclusive).toBe(2);
    expect(evidence.probability).toBe(1);
  });

  it("does not count a KILLED_BY_CONSTRAINT experiment as a loss", async () => {
    const fresh = await createTestUser();
    await db.experiment.create({
      data: {
        userId: fresh.id,
        hypothesis: "Killed by the ceiling",
        outcome: "KILLED_BY_CONSTRAINT",
        outcomeRecordedAt: new Date(),
      },
    });
    const evidence = await getMeasuredProbability({ userId: fresh.id });
    expect(evidence.decided).toBe(0);
    expect(evidence.probability).toBeNull();
  });

  it("machineObservedOnly excludes verdicts resting on a person's report", async () => {
    const fresh = await createTestUser();
    const human = await db.experiment.create({ data: { userId: fresh.id, hypothesis: "human" } });
    await reconcileExperimentOutcome({ userId: fresh.id, experimentId: human.id, verdict: "WIN" });

    expect((await getMeasuredProbability({ userId: fresh.id })).decided).toBe(1);
    expect((await getMeasuredProbability({ userId: fresh.id, machineObservedOnly: true })).decided).toBe(0);
  });

  it("is scoped per user", async () => {
    const a = await createTestUser();
    const b = await createTestUser();
    const e = await db.experiment.create({ data: { userId: a.id, hypothesis: "a's win" } });
    await reconcileExperimentOutcome({ userId: a.id, experimentId: e.id, verdict: "WIN" });
    expect((await getMeasuredProbability({ userId: b.id })).decided).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The digest and integrity
// ---------------------------------------------------------------------------

describe("the digest binds everything that makes a measurement mean something", () => {
  const base = {
    experimentId: "e1",
    source: "MACHINE_OBSERVED",
    agentRunId: "r1",
    agentStepId: "s1",
    rule: "RESEARCH_SOURCED_RESULTS",
    unit: "results",
    observedValue: 3,
    observedTotal: 5,
    provenance: "research provider: mock",
  };

  it("is stable for identical input", () => {
    expect(measurementDigest(base)).toBe(measurementDigest(base));
  });

  it("changes when any term changes", () => {
    const original = measurementDigest(base);
    const mutations = [
      { observedValue: 4 },
      { observedTotal: 6 },
      { provenance: "research provider: anthropic" },
      { rule: "SOMETHING_ELSE" },
      { unit: "dollars" },
      { source: "HUMAN_ENTERED" },
      // Repointing at a different execution is as much a change of evidence as
      // editing the counts.
      { agentRunId: "r2" },
      { agentStepId: "s2" },
      { experimentId: "e2" },
    ];
    for (const mutation of mutations) {
      expect(measurementDigest({ ...base, ...mutation })).not.toBe(original);
    }
  });

  it("detects a measurement edited in place", async () => {
    const experiment = await makeExperiment();
    await dispatchAndApprove(experiment.id);
    const observed = await observeExperimentExecution(user.id, experiment.id);
    expect(observed.observed).toBe(true);
    if (!observed.observed) return;

    expect(await verifyEvidenceIntegrity(user.id)).toEqual(
      expect.not.arrayContaining([expect.objectContaining({ experimentId: experiment.id })])
    );

    // The attack: improve the number after the fact.
    await db.experimentMeasurement.update({
      where: { id: observed.measurement.id },
      data: { observedValue: observed.measurement.observedValue + 7 },
    });

    const issues = await verifyEvidenceIntegrity(user.id);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          finding: "MEASUREMENT_DIGEST_MISMATCH",
          experimentId: experiment.id,
        }),
      ])
    );
  });

  it("detects a verdict whose evidence changed underneath it", async () => {
    const experiment = await makeExperiment();
    await dispatchAndApprove(experiment.id);
    const observed = await observeExperimentExecution(user.id, experiment.id);
    if (!observed.observed) return;
    await reconcileExperimentOutcome({ userId: user.id, experimentId: experiment.id, verdict: "WIN" });

    await db.experimentMeasurement.update({
      where: { id: observed.measurement.id },
      data: { observedValue: 999, digest: "recomputed-to-look-clean" },
    });

    const issues = await verifyEvidenceIntegrity(user.id);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ finding: "VERDICT_DIGEST_MISMATCH", experimentId: experiment.id }),
      ])
    );
  });

  it("detects a verdict whose measurement was deleted", async () => {
    const experiment = await makeExperiment();
    await dispatchAndApprove(experiment.id);
    const observed = await observeExperimentExecution(user.id, experiment.id);
    if (!observed.observed) return;
    await reconcileExperimentOutcome({ userId: user.id, experimentId: experiment.id, verdict: "WIN" });

    await db.experimentMeasurement.delete({ where: { id: observed.measurement.id } });

    const issues = await verifyEvidenceIntegrity(user.id);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          finding: "MEASUREMENT_MISSING_FOR_VERDICT",
          experimentId: experiment.id,
        }),
      ])
    );
  });

  it("reports rather than repairs", async () => {
    const experiment = await makeExperiment();
    await dispatchAndApprove(experiment.id);
    const observed = await observeExperimentExecution(user.id, experiment.id);
    if (!observed.observed) return;
    await db.experimentMeasurement.update({
      where: { id: observed.measurement.id },
      data: { observedValue: 42 },
    });

    await verifyEvidenceIntegrity(user.id);
    await verifyEvidenceIntegrity(user.id);

    // Still 42, still mismatched. A verifier that "fixed" this would be a tool
    // for erasing the evidence that a measurement had been altered.
    const after = await db.experimentMeasurement.findUnique({ where: { id: observed.measurement.id } });
    expect(after?.observedValue).toBe(42);
    expect(after?.digest).toBe(observed.measurement.digest);
  });

  it("does not flag a human-entered figure a person corrected", async () => {
    const experiment = await makeExperiment();
    const recorded = await recordExternalMeasurement({
      userId: user.id,
      experimentId: experiment.id,
      observedValue: 2,
      observedTotal: 10,
      unit: "signups",
      provenance: "dashboard",
    });
    if (!recorded.recorded) return;
    await db.experimentMeasurement.update({
      where: { id: recorded.measurement.id },
      data: { observedValue: 3 },
    });

    const issues = await verifyEvidenceIntegrity(user.id);
    expect(issues.filter((i) => i.experimentId === experiment.id)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Read surfaces carry the caveat
// ---------------------------------------------------------------------------

describe("every read surface carries provenance and limits", () => {
  it("the evidence projection states what the rule does not establish", async () => {
    const experiment = await makeExperiment();
    const evidence = await getExperimentEvidence(user.id, experiment.id);
    expect(evidence?.ruleDoesNotEstablish).toContain("revenue");
    expect(evidence?.ruleMethod).toBeTruthy();
  });

  it("the lineage names the run, the step, and the capability that was checked", async () => {
    const experiment = await makeExperiment();
    await dispatchAndApprove(experiment.id);
    await observeExperimentExecution(user.id, experiment.id);

    const lineage = await getEvidenceLineage(user.id, experiment.id);
    expect(lineage?.run?.id).toBeTruthy();
    expect(lineage?.step?.toolName).toBe("research.run");
    expect(lineage?.step?.capability).toBe("research.web");
    expect(lineage?.measurement?.id).toBeTruthy();
  });

  it("the lineage reports a broken digest link rather than hiding it", async () => {
    const experiment = await makeExperiment();
    await dispatchAndApprove(experiment.id);
    const observed = await observeExperimentExecution(user.id, experiment.id);
    if (!observed.observed) return;
    await reconcileExperimentOutcome({ userId: user.id, experimentId: experiment.id, verdict: "WIN" });
    await db.experimentMeasurement.update({
      where: { id: observed.measurement.id },
      data: { digest: "different" },
    });

    const lineage = await getEvidenceLineage(user.id, experiment.id);
    expect(lineage?.verdict?.digestMatchesMeasurement).toBe(false);
  });

  it("the list and the single read agree about a measurement", async () => {
    const experiment = await makeExperiment();
    await dispatchAndApprove(experiment.id);
    await observeExperimentExecution(user.id, experiment.id);

    const single = await getExperimentEvidence(user.id, experiment.id);
    const listed = (await listExperimentEvidence(user.id)).find((e) => e.experimentId === experiment.id);
    expect(listed?.measurement).toEqual(single?.measurement);
    expect(listed?.stage).toBe(single?.stage);
  });

  it("does not leak another user's experiments into the list", async () => {
    const mine = await makeExperiment();
    const theirs = await makeExperiment(other);
    const listed = await listExperimentEvidence(user.id);
    expect(listed.map((e) => e.experimentId)).toContain(mine.id);
    expect(listed.map((e) => e.experimentId)).not.toContain(theirs.id);
  });
});

// ---------------------------------------------------------------------------
// Source-level guarantees
// ---------------------------------------------------------------------------

describe("the module cannot execute or authorize anything itself", () => {
  const source = readFileSync("src/lib/economic/evidence.ts", "utf8");

  it("mints no permission and no approval grant", () => {
    for (const forbidden of ["grantPermission", "createApprovalGrant", "consumeApprovalGrant"]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("reaches a tool only through the existing executor", () => {
    // No direct registry access: if this module could call `getTool(...).execute`
    // it would be a second execution path with no capability check in front of
    // it, and every guarantee above would be decorative.
    expect(source).not.toContain("getTool");
    expect(source).not.toContain("@/lib/tools/registry");
    expect(source).toContain("executeRun");
  });

  it("does not write an experiment outcome", () => {
    // Writing WIN or LOSS is `reconcileExperimentOutcome`'s alone, and that
    // function is reached by a person through an API route.
    expect(source).not.toMatch(/outcome:\s*"(WIN|LOSS)"/);
  });

  it("contains no model call", () => {
    for (const forbidden of ["@anthropic-ai/sdk", "getAIProvider", "complete(", "prompt"]) {
      expect(source.includes(forbidden)).toBe(false);
    }
  });
});
