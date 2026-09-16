/**
 * [P5-E] THE OBSERVATION CONTRACT — what will be counted, frozen before it is.
 *
 * A leaf module: pure functions, no database, no network, no provider. It exists
 * because an external measurement has three degrees of freedom that an internal
 * one does not, and each of them is a way to get a better number without lying
 * about a single figure:
 *
 *   WHICH STORE     ask a different shop
 *   WHICH WINDOW    move the dates until a good week is inside them
 *   WHICH RULE      count something else that happens to be larger
 *
 * None of those requires falsifying anything. The store's answer is true every
 * time. What makes the result dishonest is that the question was chosen after
 * the answer was visible — so the defence is not validation, it is ORDERING.
 * All three are declared on the experiment before it runs and hashed together
 * into `observationContractDigest`. The digest is checked twice afterwards: once
 * before the store is asked, and again before a measurement is written from the
 * answer. An edit in between does not produce a better result; it produces a
 * refusal.
 */

import { createHash } from "node:crypto";

/**
 * How long after a window closes an observation may still be made.
 *
 * Seven days. A bound is needed because an observation is a claim about a moment
 * — "this is what the store said about that week" — and a store's history is not
 * immutable. Orders get cancelled, edited, and archived; asking six months later
 * is asking a different question from the one the experiment posed, even though
 * the filter string is identical.
 *
 * Seven rather than one because a person who runs an experiment on a Friday
 * should be able to look at it the following week without the evidence having
 * expired, and rather than thirty because a month is long enough for the store's
 * own record of that period to have meaningfully moved.
 */
export const EXTERNAL_OBSERVATION_GRACE_MINUTES = 7 * 24 * 60;

/** The longest window an experiment may declare. */
export const MAX_OBSERVATION_WINDOW_MINUTES = 90 * 24 * 60;

/** The shortest. Below a minute the boundary semantics stop being meaningful. */
export const MIN_OBSERVATION_WINDOW_MINUTES = 1;

export interface ObservationContractTerms {
  rule: string;
  scope: string;
  windowStart: Date;
  windowMinutes: number;
}

/**
 * The freeze.
 *
 * Every term that determines WHAT IS BEING ASKED goes in, and nothing else does.
 * Notably absent: anything secret. The digest is written to the database, echoed
 * in events, and shown in the UI, so a token inside it would be a token in the
 * audit log — and a hash is not encryption. `scope` is a shop domain, which is
 * public.
 */
export function observationContractDigestOf(terms: ObservationContractTerms): string {
  const canonical = [
    terms.rule,
    terms.scope,
    terms.windowStart.toISOString(),
    String(terms.windowMinutes),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}

export interface ResolvedWindow {
  /** INCLUSIVE. */
  start: Date;
  /** EXCLUSIVE. */
  end: Date;
  minutes: number;
}

/**
 * Turns the experiment's stored terms into a half-open interval, or null.
 *
 * INCLUSIVE START, EXCLUSIVE END — `[start, end)`. Stated everywhere it is used
 * because the alternative is the classic double-count: two consecutive windows
 * with inclusive ends both claim the order that landed exactly on the boundary,
 * and two experiments then report a total larger than the store's own.
 *
 * Returns null rather than a default for every missing or out-of-range term. A
 * defaulted window would be a window nobody declared, which is precisely the
 * thing the contract exists to prevent.
 */
export function resolveObservationWindow(experiment: {
  observationWindowStart: Date | null;
  observationWindowMinutes: number | null;
}): ResolvedWindow | null {
  const { observationWindowStart: start, observationWindowMinutes: minutes } = experiment;
  if (!start || minutes === null) return null;
  if (!Number.isInteger(minutes)) return null;
  if (minutes < MIN_OBSERVATION_WINDOW_MINUTES || minutes > MAX_OBSERVATION_WINDOW_MINUTES) return null;
  if (Number.isNaN(start.getTime())) return null;

  return { start, end: new Date(start.getTime() + minutes * 60_000), minutes };
}

export type WindowTiming =
  /** The window has not finished. Counting now would count a partial period. */
  | "WINDOW_NOT_CLOSED"
  /** Closed, and recently enough that the store's answer still describes it. */
  | "ELIGIBLE"
  /** Closed too long ago. The store's record of that period has had time to move. */
  | "WINDOW_EXPIRED";

/**
 * Whether a closed window may still be counted.
 *
 * `WINDOW_NOT_CLOSED` is the one that matters most. An experiment measured
 * halfway through its own window produces a real number from a real store that
 * describes a period nobody declared — and it is systematically LOW, which makes
 * it read as a disappointing result rather than as an incomplete one.
 */
export function classifyWindowTiming(window: ResolvedWindow, now: Date): WindowTiming {
  if (now.getTime() < window.end.getTime()) return "WINDOW_NOT_CLOSED";
  const minutesSinceClose = (now.getTime() - window.end.getTime()) / 60_000;
  return minutesSinceClose > EXTERNAL_OBSERVATION_GRACE_MINUTES ? "WINDOW_EXPIRED" : "ELIGIBLE";
}
