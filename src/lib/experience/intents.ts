import type { PlaceId } from "@/lib/experience/world";

/**
 * Spoken and typed commands → spatial intents.
 *
 * This is deliberately a small, honest pattern matcher rather than a model
 * call. Two reasons:
 *
 * 1. It runs on the device, in the frame budget, with no round trip — a
 *    navigation command that takes two seconds to interpret feels broken no
 *    matter how good the interpretation is.
 * 2. It cannot hallucinate a destination. Unrecognised input returns `null`,
 *    and the caller says so instead of guessing a place to fly to. Being
 *    wrong about where the user asked to go is worse than admitting it.
 *
 * Anything genuinely conversational belongs in the existing chat/AI path
 * (src/lib/ai), which can call back into these same intents.
 */

export type SpatialIntent =
  | { kind: "goto"; place: PlaceId; subject?: "latest" | "selected" }
  | { kind: "select"; target: string }
  | { kind: "inspect"; target?: string }
  | { kind: "explode" }
  | { kind: "reassemble" }
  | { kind: "isolate" }
  | { kind: "reset" }
  | { kind: "zoom"; direction: "in" | "out" };

interface Rule {
  /** Matched against the normalised command. */
  test: RegExp;
  intent: SpatialIntent | ((match: RegExpMatchArray) => SpatialIntent);
}

/** Lowercase, collapse whitespace, strip terminal punctuation and filler. */
export function normalizeCommand(raw: string): string {
  return (
    raw
      .toLowerCase()
      // Punctuation goes FIRST, everywhere — not just at the end. Removing
      // filler before punctuation leaves the comma from "hey vox," behind, and
      // the leftover stops the next rule from matching at a word boundary.
      // Hyphens and apostrophes survive: "web-shooter" is one word.
      .replace(/[.,!?;:"“”]/g, " ")
      .replace(/\b(please|hey vox|vox|could you|can you|would you|i want to|i'd like to)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Order matters: the most specific patterns come first.
 *
 * "put it back" must beat "back", and "show me the wrist" must beat the
 * generic "show me the suit" — otherwise the more useful command is
 * unreachable because a vaguer one matched first.
 */
const RULES: Rule[] = [
  // Assembly control — the signature interaction, so it wins outright.
  { test: /\b(put it back|reassemble|reassembly|back together|close it up)\b/, intent: { kind: "reassemble" } },
  { test: /\b(explode|exploded view|take it apart|break it down|pull it apart)\b/, intent: { kind: "explode" } },
  { test: /\b(how does (this|it) work|show me how (this|it) works|explain (this|it))\b/, intent: { kind: "inspect" } },
  { test: /\b(isolate|just this|only this|on its own)\b/, intent: { kind: "isolate" } },

  // Named subassemblies.
  {
    test: /\b(wrist|web[- ]?shooter|shooter|gauntlet)\b/,
    intent: { kind: "inspect", target: "wrist" },
  },
  { test: /\b(mask|helmet|head)\b/, intent: { kind: "select", target: "mask" } },
  { test: /\b(lens|lenses|eyes)\b/, intent: { kind: "select", target: "lens" } },
  { test: /\b(chest|torso|emblem)\b/, intent: { kind: "select", target: "chest" } },

  // Places.
  { test: /\b(return to brain|back to brain|go to brain|show (me )?the brain|open brain)\b/, intent: { kind: "goto", place: "brain" } },
  {
    test: /\b(latest|newest|most recent) suit\b/,
    intent: { kind: "goto", place: "suit", subject: "latest" },
  },
  { test: /\b(suit bay|all suits|the suits|suit archive)\b/, intent: { kind: "goto", place: "suit-bay" } },
  { test: /\b(show me (the )?suit|open (the )?suit|the suit)\b/, intent: { kind: "goto", place: "suit", subject: "selected" } },
  { test: /\b(laboratory|the lab|go to lab)\b/, intent: { kind: "goto", place: "lab" } },
  { test: /\b(home|dashboard)\b/, intent: { kind: "goto", place: "home" } },

  // Camera.
  { test: /\b(zoom in|closer|move closer|get closer)\b/, intent: { kind: "zoom", direction: "in" } },
  { test: /\b(zoom out|pull back|further away|wider)\b/, intent: { kind: "zoom", direction: "out" } },
  { test: /\b(reset|start over|reset (the )?view|show everything)\b/, intent: { kind: "reset" } },
];

/**
 * Parses one command. Returns null when nothing matched.
 *
 * Null is a real answer and callers must surface it — "I didn't catch that" is
 * a better experience than flying the camera somewhere the user did not ask
 * for and leaving them to work out what happened.
 */
export function parseCommand(raw: string): SpatialIntent | null {
  const text = normalizeCommand(raw);
  if (!text) return null;
  for (const rule of RULES) {
    const match = text.match(rule.test);
    if (!match) continue;
    return typeof rule.intent === "function" ? rule.intent(match) : rule.intent;
  }
  return null;
}

/** Short confirmation of what was understood, for the on-screen readout. */
export function describeIntent(intent: SpatialIntent): string {
  switch (intent.kind) {
    case "goto":
      return intent.subject === "latest" ? "Opening the latest suit" : `Going to ${intent.place.replace("-", " ")}`;
    case "select":
      return `Selecting ${intent.target}`;
    case "inspect":
      return intent.target ? `Inspecting ${intent.target}` : "Entering inspection";
    case "explode":
      return "Separating the assembly";
    case "reassemble":
      return "Reassembling";
    case "isolate":
      return "Isolating selection";
    case "reset":
      return "Resetting the view";
    case "zoom":
      return intent.direction === "in" ? "Moving closer" : "Pulling back";
  }
}
