// Economic time boundaries, in UTC.
//
// THE BUG THIS REPLACES. `startOfDay()` used `date.setHours(0,0,0,0)`, which
// means "midnight in whatever timezone this process happens to be configured
// for". That makes the $500/day floor a different question depending on where
// the server runs, and a moving one on the two days a year local time gains or
// loses an hour: under `setHours`, a DST spring-forward day is 23 hours long
// and an autumn day is 25, so "today's net profit" silently measures a
// different-sized window twice a year. Worse, the same deployment moved between
// regions would report different profit for the same ledger.
//
// THE POLICY. Every economic window boundary is UTC. VOX has no user-timezone
// abstraction — no field on User, no preference, nothing that reads one — so
// inventing a per-user timezone here would be building a feature, not fixing a
// bug. UTC has no DST, every day is exactly 86,400 seconds, and the answer does
// not depend on where the process runs. When VOX later grows a real user
// timezone, this module is the single place that changes, and the constant
// below is what it changes from.
//
// This is a deliberate, documented choice rather than a default: a user in
// UTC-8 will see "today" roll over at 16:00 local. That is the correct
// trade for a measurement that has to be reproducible and comparable across
// machines, and it is stated in the UI copy rather than hidden.

/** The timezone every economic window is measured in. */
export const ECONOMIC_TIMEZONE = "UTC" as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function assertValidDate(date: Date, field: string): void {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    throw new TypeError(`${field}: expected a valid Date, received ${String(date)}`);
  }
}

/**
 * Midnight UTC of the day containing `now`.
 *
 * Uses `Date.UTC` rather than any local-time setter, so the result is identical
 * on a machine in Auckland and one in Los Angeles, and identical on either side
 * of a DST transition in any zone.
 */
export function startOfUtcDay(now: Date): Date {
  assertValidDate(now, "now");
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * `n` whole 24-hour days before `now`.
 *
 * Deliberately arithmetic on the epoch rather than calendar-field subtraction:
 * a trailing-7-day window should be 7 × 86,400 seconds regardless of what the
 * calendar did in between. Calendar subtraction across a DST boundary in a
 * local zone would produce a 167- or 169-hour "7 days".
 */
export function utcDaysAgo(now: Date, days: number): Date {
  assertValidDate(now, "now");
  if (!Number.isFinite(days) || days < 0) {
    throw new TypeError(`days: expected a non-negative finite number, received ${String(days)}`);
  }
  return new Date(now.getTime() - days * MS_PER_DAY);
}

/**
 * The UTC hour bucket containing `now`, as a stable key.
 *
 * The scheduler's idempotency key. Two processes in different timezones must
 * derive the same bucket from the same instant, or the unique constraint that
 * makes a tick idempotent stops meaning anything.
 */
export function utcHourBucket(now: Date, bucketMs: number): Date {
  assertValidDate(now, "now");
  if (!Number.isSafeInteger(bucketMs) || bucketMs <= 0) {
    throw new TypeError(`bucketMs: expected a positive safe integer, received ${String(bucketMs)}`);
  }
  return new Date(Math.floor(now.getTime() / bucketMs) * bucketMs);
}
