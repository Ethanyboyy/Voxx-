/**
 * What the Brain is DOING, expressed as travelling signals.
 *
 * The Brain surface has to answer one question at a glance: *is this thing
 * working, and on what?* Colour is the only channel that can carry that
 * without text, so it has to mean something specific — and it can only mean
 * something if it is derived from events that really happened rather than from
 * a decorative timer.
 *
 * This module is the mapping. It takes the real `Event` types VOX writes
 * (`memory.created`, `supervisor.planning`, `agent.run.started`, …) and
 * classifies each into one of four cognitive activities. `BrainState` is used
 * only as the fallback when nothing has happened recently, because a state
 * label is a summary while an event is evidence.
 */

export type SignalKind = "memory" | "reasoning" | "objective" | "execution";

export const SIGNAL_KINDS: readonly SignalKind[] = ["memory", "reasoning", "objective", "execution"];

/** Human-readable label for the on-canvas legend. */
export const SIGNAL_LABEL: Record<SignalKind, string> = {
  memory: "Memory",
  reasoning: "Reasoning",
  objective: "Objectives",
  execution: "Execution",
};

/** Canonical colour per kind. The 3D layer and the legend must not diverge. */
export const SIGNAL_HEX: Record<SignalKind, string> = {
  memory: "#38bdf8",     // recall — cool cyan
  reasoning: "#a855f7",  // inference — the product's violet
  objective: "#f59e0b",  // goal-directed — warm amber
  execution: "#22d3ee",  // acting — bright cyan
};

/**
 * Exact event types whose prefix would classify them wrongly.
 *
 * `research.performed` is the system reasoning; `research.recorded` is the
 * system remembering what it found. Same prefix, different activity — which is
 * exactly why prefix matching alone is not good enough here.
 */
const EXACT: Record<string, SignalKind> = {
  "research.recorded": "memory",
  "research.performed": "reasoning",
  "research.failed": "reasoning",
  "experiment.result_recorded": "memory",
  "outcome.recorded": "memory",
  "lab.decision.recorded": "memory",
  "lab.research.recorded": "memory",
  "supervisor.planning": "reasoning",
  "supervisor.replanning": "reasoning",
  "proposal.created": "reasoning",

  // --- multimodal agent fabric ---------------------------------------------
  // Routing is VOX deciding what a request requires — inference about the
  // task, before anything is done about it. That is reasoning, and it is the
  // one part of this subsystem that genuinely is.
  "capability.routed": "reasoning",
  // A provider call is VOX acting on the world: it takes time, costs money and
  // produces a thing. Execution, not thought.
  "provider.started": "execution",
  "provider.completed": "execution",
  "provider.failed": "execution",
  // A refusal is the budget working, not work being done — see VIEW_ONLY.
  // An artifact appearing is VOX having learned a durable fact about what now
  // exists, which is where memory events sit.
  "artifact.created": "memory",
  "artifact.version_created": "memory",
  // Judging output against intent is inference over evidence.
  "qa.completed": "reasoning",
};

/**
 * Real, recorded events that are explicitly NOT cognition.
 *
 * Checked before the prefix table, because these all live under `lab.` and
 * would otherwise be classified as execution. Selecting a suit, opening a
 * component or exploding an assembly are things the USER did to look at
 * something. They belong in the activity timeline — they are genuine, audited
 * interactions — but making the Brain pulse with execution activity because
 * somebody tapped a model would be inventing cognition out of a camera move,
 * which is the same failure as a decorative loading animation.
 *
 * `lab.suit.equipped` is deliberately absent: equipping changes which suit is
 * active, so it is a real state change and does classify.
 */
const VIEW_ONLY: ReadonlySet<string> = new Set([
  "lab.suit.selected",
  "lab.suit.deselected",
  "lab.component.selected",
  "lab.assembly.exploded",
  "lab.assembly.reassembled",

  // A capability request is the user asking, before VOX has decided anything.
  // Only `capability.routed` — the decision — is cognition.
  "capability.requested",
  // A refused provider call is the budget doing its job. No work happened, and
  // making the Brain light up for a call that never left the building would
  // report activity that does not exist.
  "provider.refused",
  // Choosing which stored version to point at is a pointer move, not thought.
  "artifact.version_selected",
]);

/** Prefix rules, longest-first so the more specific rule wins. */
const PREFIXES: ReadonlyArray<readonly [string, SignalKind]> = [
  ["memory.", "memory"],
  ["knowledge.", "memory"],
  ["brain_group.", "memory"],

  ["cognition.", "reasoning"],
  ["hypothesis.", "reasoning"],
  ["observation.", "reasoning"],

  ["objective.", "objective"],
  ["goal.", "objective"],
  ["opportunity.", "objective"],
  ["project.", "objective"],
  ["economic_asset.", "objective"],

  ["agent.", "execution"],
  ["task.", "execution"],
  ["tool.", "execution"],
  ["proposal.", "execution"],
  ["supervisor.", "execution"],
  ["connection.", "execution"],
  ["lab.", "execution"],
  ["approval.", "execution"],
  ["permission.", "execution"],
];

/** Classifies one real event type. Returns null for anything unmapped —
 * auth, settings and view events are not cognition and must not fake it. */
export function signalKindForEvent(type: string): SignalKind | null {
  if (VIEW_ONLY.has(type)) return null;
  const exact = EXACT[type];
  if (exact) return exact;
  for (const [prefix, kind] of PREFIXES) {
    if (type.startsWith(prefix)) return kind;
  }
  return null;
}

/** BrainState fallback, used only when there is no recent real activity. */
export function signalKindsForState(state: string): SignalKind[] {
  switch (state) {
    case "executing": return ["execution", "objective"];
    case "researching": return ["memory", "reasoning"];
    case "learning": return ["memory"];
    case "thinking": return ["reasoning", "memory"];
    case "waiting": return ["objective"];
    case "error": return ["execution"];
    default: return ["reasoning"];
  }
}

export interface KindWeight {
  kind: SignalKind;
  /** Count of contributing events in the window. */
  count: number;
}

/**
 * The activity mix, weighted by how many real events of each kind occurred.
 *
 * Returned as counts rather than a normalised ratio so callers can also say
 * "nothing happened" (empty array) — a distinction a ratio would erase.
 */
export function signalWeights(
  events: ReadonlyArray<{ type: string }>,
  limit = 40,
): KindWeight[] {
  const counts = new Map<SignalKind, number>();
  for (const event of events.slice(0, limit)) {
    const kind = signalKindForEvent(event.type);
    if (!kind) continue;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count || SIGNAL_KINDS.indexOf(a.kind) - SIGNAL_KINDS.indexOf(b.kind));
}

/**
 * The kinds to emit right now.
 *
 * Evidence beats summary: if real events classified, those kinds travel — in
 * proportion, so a burst of memory writes reads as a memory-heavy brain. Only
 * when nothing classified does the declared `BrainState` stand in.
 */
export function activeSignalKinds(
  events: ReadonlyArray<{ type: string }>,
  state: string,
  limit = 40,
): SignalKind[] {
  const weights = signalWeights(events, limit);
  if (weights.length === 0) return signalKindsForState(state);

  // Repeat each kind in proportion to the rarest one, so random selection from
  // this array reproduces the real mix rather than flattening nine memory
  // writes and one task into an even split. Scaling against the minimum rather
  // than the total keeps the bag minimal — a single active kind yields exactly
  // one entry instead of eight identical ones.
  const min = Math.min(...weights.map((w) => w.count));
  const out: SignalKind[] = [];
  for (const { kind, count } of weights) {
    const share = Math.min(8, Math.max(1, Math.round(count / min)));
    for (let i = 0; i < share; i++) out.push(kind);
  }
  return out;
}
