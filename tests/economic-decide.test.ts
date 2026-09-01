import { describe, it, expect } from "vitest";
import { decide, type DecisionContract, type DecisionInput } from "@/lib/economic/decide";

/**
 * The hard constraints.
 *
 * These are the tests that matter most in the economic engine, because this is
 * the one place where a bug spends real money. Every case below is a claim
 * about what CANNOT happen: a contract past its loss cap cannot survive, a
 * halted engine cannot scale, a missed deadline cannot be extended.
 *
 * There is no database and no model here on purpose — if any of these
 * assertions ever needed one, the decision layer would have stopped being a
 * guarantee and become a suggestion.
 */

const BASE: DecisionContract = {
  experimentId: "exp-1",
  maxLossUsd: 200,
  requiredCapitalUsd: 100,
  scaleAtNetUsd: 500,
  killAtNetUsd: -150,
  deadlineAt: new Date("2026-12-01T00:00:00Z"),
};

const NOW = new Date("2026-09-01T00:00:00Z");

function input(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    contract: BASE,
    actual: { netUsd: 0, revenueUsd: 0, expenseUsd: 0 },
    now: NOW,
    halted: false,
    policyCeilingUsd: 1000,
    ...overrides,
  };
}

describe("maximum loss is a hard constraint", () => {
  it("kills the moment the loss reaches the cap", () => {
    const result = decide(input({ actual: { netUsd: -200, revenueUsd: 0, expenseUsd: 200 } }));
    expect(result.decision).toBe("KILL");
    expect(result.bindingConstraint).toBe("MAX_LOSS_EXCEEDED");
  });

  it("kills past the cap even when the contract is simultaneously above its scale threshold", () => {
    // Not a contrived case: a contract can be up on the week and still have
    // burned past its authorized downside. The cap wins, always.
    const result = decide(
      input({
        contract: { ...BASE, scaleAtNetUsd: -300 },
        actual: { netUsd: -250, revenueUsd: 1000, expenseUsd: 1250 },
      })
    );
    expect(result.decision).toBe("KILL");
    expect(result.bindingConstraint).toBe("MAX_LOSS_EXCEEDED");
  });

  it("kills past the cap even while the global halt is engaged", () => {
    // A halt stops NEW activity. It is not a reason to let an experiment keep
    // losing money past the limit it was given.
    const result = decide(input({ actual: { netUsd: -500, revenueUsd: 0, expenseUsd: 500 }, halted: true }));
    expect(result.decision).toBe("KILL");
    expect(result.bindingConstraint).toBe("MAX_LOSS_EXCEEDED");
  });

  it("kills past the cap even after a deadline it would otherwise have passed", () => {
    const result = decide(
      input({
        actual: { netUsd: -400, revenueUsd: 100, expenseUsd: 500 },
        now: new Date("2027-01-01T00:00:00Z"),
      })
    );
    expect(result.bindingConstraint).toBe("MAX_LOSS_EXCEEDED");
  });

  it("does not fire the cap one cent below it", () => {
    // The kill threshold is moved out of the way so this isolates the cap's
    // own boundary; with the default contract, -199.99 would (correctly) trip
    // the tighter kill threshold at -150 first.
    const contract = { ...BASE, killAtNetUsd: -1000 };
    const at = decide(input({ contract, actual: { netUsd: -200, revenueUsd: 0, expenseUsd: 200 } }));
    const below = decide(input({ contract, actual: { netUsd: -199.99, revenueUsd: 0, expenseUsd: 199.99 } }));
    expect(at.bindingConstraint).toBe("MAX_LOSS_EXCEEDED");
    expect(below.decision).toBe("HOLD");
  });

  it("never treats profit as a loss", () => {
    const result = decide(input({ actual: { netUsd: 300, revenueUsd: 400, expenseUsd: 100 } }));
    expect(result.decision).toBe("HOLD");
    expect(result.bindingConstraint).toBe("WITHIN_BOUNDS");
  });
});

describe("kill threshold", () => {
  it("kills at the threshold, independently of the loss cap", () => {
    const result = decide(input({ actual: { netUsd: -150, revenueUsd: 50, expenseUsd: 200 } }));
    expect(result.decision).toBe("KILL");
    expect(result.bindingConstraint).toBe("KILL_THRESHOLD_BREACHED");
  });
});

describe("global halt", () => {
  it("holds a healthy contract rather than scaling it", () => {
    const result = decide(input({ actual: { netUsd: 900, revenueUsd: 1000, expenseUsd: 100 }, halted: true }));
    expect(result.decision).toBe("HOLD");
    expect(result.bindingConstraint).toBe("GLOBAL_HALT");
  });

  it("can never return SCALE while halted, at any net", () => {
    for (const netUsd of [0, 500, 5_000, 1_000_000]) {
      const result = decide(input({ actual: { netUsd, revenueUsd: netUsd, expenseUsd: 0 }, halted: true }));
      expect(result.decision, `net ${netUsd}`).not.toBe("SCALE");
    }
  });
});

describe("deadline", () => {
  const PAST = new Date("2027-01-01T00:00:00Z");

  it("scales a contract that met its threshold by the deadline", () => {
    const result = decide(input({ actual: { netUsd: 600, revenueUsd: 700, expenseUsd: 100 }, now: PAST }));
    expect(result.decision).toBe("SCALE");
    expect(result.bindingConstraint).toBe("DEADLINE_PASSED_PROVEN");
  });

  it("kills a contract that missed its threshold by the deadline, even while profitable", () => {
    // $100 of profit is still a failure against a contract that promised $500
    // by a date. Letting it run is how a mediocre experiment becomes permanent.
    const result = decide(input({ actual: { netUsd: 100, revenueUsd: 200, expenseUsd: 100 }, now: PAST }));
    expect(result.decision).toBe("KILL");
    expect(result.bindingConstraint).toBe("DEADLINE_PASSED_UNPROVEN");
  });

  it("holds the same contract before the deadline", () => {
    const result = decide(input({ actual: { netUsd: 100, revenueUsd: 200, expenseUsd: 100 } }));
    expect(result.decision).toBe("HOLD");
  });
});

describe("scaling", () => {
  it("scales once the threshold is met inside the policy ceiling", () => {
    const result = decide(input({ actual: { netUsd: 500, revenueUsd: 600, expenseUsd: 100 } }));
    expect(result.decision).toBe("SCALE");
    expect(result.bindingConstraint).toBe("SCALE_THRESHOLD_MET");
  });

  it("holds instead of scaling when the contract needs more capital than policy allows", () => {
    const result = decide(
      input({
        contract: { ...BASE, requiredCapitalUsd: 5_000 },
        actual: { netUsd: 900, revenueUsd: 1000, expenseUsd: 100 },
        policyCeilingUsd: 100,
      })
    );
    expect(result.decision).toBe("HOLD");
    expect(result.bindingConstraint).toBe("CAPITAL_EXCEEDS_POLICY");
  });
});

describe("the result is auditable and deterministic", () => {
  it("marks exactly one binding reason", () => {
    const result = decide(input({ actual: { netUsd: -300, revenueUsd: 0, expenseUsd: 300 } }));
    expect(result.reasons.filter((r) => r.binding)).toHaveLength(1);
    expect(result.reasons.find((r) => r.binding)!.code).toBe(result.bindingConstraint);
  });

  it("puts the real numbers in the binding reason's text", () => {
    const result = decide(input({ actual: { netUsd: -212.4, revenueUsd: 87.6, expenseUsd: 300 } }));
    expect(result.reasons.find((r) => r.binding)!.detail).toContain("$212.40");
    expect(result.reasons.find((r) => r.binding)!.detail).toContain("$200.00");
  });

  it("returns the identical result for identical inputs", () => {
    const a = decide(input({ actual: { netUsd: 123.45, revenueUsd: 200, expenseUsd: 76.55 } }));
    const b = decide(input({ actual: { netUsd: 123.45, revenueUsd: 200, expenseUsd: 76.55 } }));
    expect(a).toEqual(b);
  });
});
