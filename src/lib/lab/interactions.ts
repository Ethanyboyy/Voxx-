/**
 * Suit Bay interactions, recorded as real events.
 *
 * The Suit Bay is a 3D environment, and the things a user does in it —
 * selecting a suit, opening a component, exploding an assembly — are real
 * interactions with real records, not animation state. Recording them puts
 * them in the same append-only timeline as everything else, so the activity
 * feed and the Brain see one history rather than two.
 *
 * Two rules this module exists to hold:
 *
 * 1. The set of recordable interactions is CLOSED and hardcoded, in the same
 *    spirit as the proposal action registry: an endpoint that writes an
 *    arbitrary caller-supplied event type into the audit trail is an audit
 *    trail an attacker can write fiction into.
 * 2. Looking at something is not doing something. Every type here except
 *    `lab.suit.equipped` is listed in `src/lib/3d/signals.ts#VIEW_ONLY`, so it
 *    is timeline-visible but contributes no cognitive signal to the Brain.
 *    Equipping changes which suit is active, so it is a genuine state change
 *    and does classify.
 *
 * Nothing here is consequential in the permissions sense — none of it performs
 * an external side effect, spends anything, or changes another party's state —
 * so none of it goes through `enforceCapability()`. If an interaction is ever
 * added that does, it needs its own gate, and the registry existing is not
 * that gate.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";

export const SUIT_INTERACTIONS = [
  "lab.suit.selected",
  "lab.suit.deselected",
  "lab.suit.equipped",
  "lab.component.selected",
  "lab.assembly.exploded",
  "lab.assembly.reassembled",
] as const;

export type SuitInteraction = (typeof SUIT_INTERACTIONS)[number];

const INTERACTIONS: ReadonlySet<string> = new Set(SUIT_INTERACTIONS);

export function isSuitInteraction(type: string): type is SuitInteraction {
  return INTERACTIONS.has(type);
}

export interface RecordSuitInteractionInput {
  userId: string;
  type: SuitInteraction;
  /** The LabSuit the interaction happened on, when there is one. */
  suitId?: string;
  /** Asset component id (e.g. "wristCartridgeL"), for component-level events. */
  componentId?: string;
  /** Assembly separation, 0-1, for explode/reassemble. */
  amount?: number;
}

export class UnknownSuitError extends Error {
  constructor(suitId: string) {
    super(`suit ${suitId} not found`);
    this.name = "UnknownSuitError";
  }
}

/**
 * Records one interaction.
 *
 * When a `suitId` is given it is verified to exist AND to belong to the
 * calling user before anything is written. That check is the reason this is a
 * service rather than a thin wrapper over `recordEvent`: without it the
 * endpoint would happily stamp another user's suit id into this user's
 * timeline, which is both a leak (it confirms the id exists) and a corruption
 * of the record.
 */
export async function recordSuitInteraction(input: RecordSuitInteractionInput) {
  if (!isSuitInteraction(input.type)) {
    throw new Error(`unregistered suit interaction: ${input.type}`);
  }

  let codename: string | undefined;
  if (input.suitId) {
    const suit = await db.labSuit.findFirst({
      where: { id: input.suitId, userId: input.userId },
      select: { id: true, codename: true },
    });
    if (!suit) throw new UnknownSuitError(input.suitId);
    codename = suit.codename;
  }

  const payload: Record<string, unknown> = {};
  if (codename) payload.codename = codename;
  if (input.componentId) payload.componentId = input.componentId;
  if (typeof input.amount === "number") payload.amount = input.amount;

  return recordEvent({
    userId: input.userId,
    type: input.type,
    // Equipping changes state; the rest are the user looking at something.
    consequential: input.type === "lab.suit.equipped",
    subjectType: input.suitId ? "LabSuit" : undefined,
    subjectId: input.suitId,
    payload: Object.keys(payload).length ? payload : undefined,
  });
}
