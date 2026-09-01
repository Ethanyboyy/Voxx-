// The global economic halt.
//
// One switch that stops every economic action VOX can take. When it is
// engaged: no new economic execution may begin, no autonomous spend may occur,
// and the scheduler evaluates nothing.
//
// ENFORCED IN SERVICE CODE, NOT IN THE UI. A halt implemented by hiding a
// button is not a halt — the API route is still there, the tool registry entry
// is still there, and a scheduler tick does not go through the UI at all. So
// the check lives at every place money or execution can actually start:
//
//   * evaluateSpendPolicy()      (src/lib/economic/policy.ts) — denies.
//   * recordOpportunitySpend()   (src/lib/economic/service.ts) — throws.
//   * runEconomicTick()          (src/lib/economic/scheduler.ts) — records a
//                                 HALTED tick and evaluates nothing.
//   * decide()                   (src/lib/economic/decide.ts) — can never
//                                 return SCALE while halted.
//
// WHAT A HALT DOES NOT BLOCK. Reading. Reporting. And killing: `decide()`
// checks the maximum-loss and kill thresholds BEFORE the halt, because a halt
// exists to reduce exposure and leaving a bleeding experiment running would do
// the opposite.
import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";

export interface HaltState {
  halted: boolean;
  haltedAt: Date | null;
  reason: string | null;
}

export async function getHaltState(userId: string): Promise<HaltState> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: userId },
    select: { economicHaltedAt: true, economicHaltReason: true },
  });
  return {
    halted: user.economicHaltedAt !== null,
    haltedAt: user.economicHaltedAt,
    reason: user.economicHaltReason,
  };
}

export async function isEconomicHalted(userId: string): Promise<boolean> {
  return (await getHaltState(userId)).halted;
}

/**
 * Engages the halt.
 *
 * Idempotent, and deliberately so: an emergency stop that errors when it is
 * already stopped is an emergency stop someone has to think about. Pressing it
 * twice keeps the ORIGINAL timestamp and reason, since the first stop is the
 * one that describes why activity ceased.
 */
export async function haltEconomicEngine(userId: string, reason: string): Promise<HaltState> {
  const current = await getHaltState(userId);
  if (current.halted) return current;

  const user = await db.user.update({
    where: { id: userId },
    data: { economicHaltedAt: new Date(), economicHaltReason: reason },
    select: { economicHaltedAt: true, economicHaltReason: true },
  });

  await recordEvent({
    userId,
    type: "economic.halted",
    subjectType: "User",
    subjectId: userId,
    consequential: true,
    payload: { reason },
  });

  return { halted: true, haltedAt: user.economicHaltedAt, reason: user.economicHaltReason };
}

/**
 * Releases the halt. Consequential in its own right — resuming autonomous
 * economic activity is a decision worth its own audit row, not the mere
 * absence of a halt.
 */
export async function resumeEconomicEngine(userId: string): Promise<HaltState> {
  const current = await getHaltState(userId);
  if (!current.halted) return current;

  await db.user.update({
    where: { id: userId },
    data: { economicHaltedAt: null, economicHaltReason: null },
  });

  await recordEvent({
    userId,
    type: "economic.resumed",
    subjectType: "User",
    subjectId: userId,
    consequential: true,
    payload: { haltedSince: current.haltedAt?.toISOString() ?? null, previousReason: current.reason },
  });

  return { halted: false, haltedAt: null, reason: null };
}

/** Thrown by service code that refuses to act while the halt is engaged. */
export class EconomicHaltedError extends Error {
  constructor(reason: string | null) {
    super(
      `The global economic halt is engaged${reason ? `: ${reason}` : ""}. No economic execution or autonomous spend may occur until it is released.`
    );
    this.name = "EconomicHaltedError";
  }
}

/** Throws unless economic activity is permitted. Call before acting, not after. */
export async function assertNotHalted(userId: string): Promise<void> {
  const state = await getHaltState(userId);
  if (state.halted) throw new EconomicHaltedError(state.reason);
}
