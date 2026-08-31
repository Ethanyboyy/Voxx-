import type { ExperienceState } from "@/lib/experience/state";
import type { MotionBeat } from "@/lib/experience/motion";

/**
 * The spatial world: VOX as a set of PLACES the user moves between, rather
 * than a set of pages they navigate to.
 *
 * The distinction is not cosmetic. A page is replaced; a place is travelled to,
 * which means the system can say what the journey looks like — what the camera
 * does, what the lighting does, and what the Brain is doing while it happens.
 * "Show me the latest suit" produces a route through this graph, and the route
 * is what gets animated.
 */

export type PlaceId = "brain" | "suit-bay" | "suit" | "inspection" | "lab" | "home";

export interface Place {
  id: PlaceId;
  label: string;
  /** The application route this place lives at. */
  route: string;
  /** Where the user can go directly from here. */
  exits: PlaceId[];
  /** Lighting preset — see LIGHTING below. */
  lighting: LightingId;
}

export type LightingId = "cognitive" | "gallery" | "spotlight" | "bench" | "ambient";

export interface LightingPreset {
  /** Overall exposure, relative. Restraint lives here: nothing above 1.15. */
  exposure: number;
  /** Ambient fill intensity — how much the room reads when nothing is lit. */
  ambient: number;
  /** Key light intensity. */
  key: number;
  /** Rim/accent intensity. The violet identity, kept as an accent only. */
  rim: number;
  /** Fog density proxy: higher means more atmospheric separation. */
  atmosphere: number;
  /** Hex accent used for rim and emissive cues. */
  accent: string;
}

/**
 * Lighting presets.
 *
 * Deliberately narrow in range. The brief is black/charcoal with controlled
 * violet/cyan/white illumination, so the presets differ mostly in WHERE the
 * light is, not how much of it there is — which is what makes a room read as
 * physical rather than as a coloured filter.
 */
export const LIGHTING: Record<LightingId, LightingPreset> = {
  // The Brain: dark void, light comes from the structure itself.
  cognitive: { exposure: 1.0, ambient: 0.22, key: 1.5, rim: 0.55, atmosphere: 0.85, accent: "#a855f7" },
  // Suit Bay wide shot: a real room, evenly but dimly lit, depth from falloff.
  gallery: { exposure: 0.95, ambient: 0.16, key: 1.15, rim: 0.35, atmosphere: 1.0, accent: "#8b5cf6" },
  // One subject picked out of the dark. Highest key, lowest ambient.
  spotlight: { exposure: 1.05, ambient: 0.1, key: 1.9, rim: 0.5, atmosphere: 0.7, accent: "#a78bfa" },
  // Close inspection: neutral and bright enough to judge a material honestly.
  bench: { exposure: 1.15, ambient: 0.34, key: 1.6, rim: 0.28, atmosphere: 0.35, accent: "#22d3ee" },
  ambient: { exposure: 1.0, ambient: 0.28, key: 1.0, rim: 0.3, atmosphere: 0.6, accent: "#a855f7" },
};

export const PLACES: Record<PlaceId, Place> = {
  home: { id: "home", label: "Home", route: "/dashboard", exits: ["brain", "lab"], lighting: "ambient" },
  brain: { id: "brain", label: "Brain", route: "/brain", exits: ["lab", "suit-bay", "home"], lighting: "cognitive" },
  lab: { id: "lab", label: "Laboratory", route: "/lab", exits: ["suit-bay", "brain"], lighting: "gallery" },
  "suit-bay": { id: "suit-bay", label: "Suit Bay", route: "/lab/suits", exits: ["suit", "lab", "brain"], lighting: "gallery" },
  suit: { id: "suit", label: "Suit", route: "/lab/suits", exits: ["inspection", "suit-bay", "brain"], lighting: "spotlight" },
  inspection: { id: "inspection", label: "Inspection", route: "/lab/suits", exits: ["suit", "suit-bay"], lighting: "bench" },
};

/**
 * The shortest route between two places, as a list of places to pass through.
 *
 * Breadth-first over `exits`, so a route is always the fewest context changes
 * rather than whatever order the graph happens to be written in. Returns an
 * empty array when no route exists, which callers must treat as "cannot go
 * there" instead of teleporting.
 */
export function routeBetween(from: PlaceId, to: PlaceId): PlaceId[] {
  if (from === to) return [from];
  const queue: PlaceId[][] = [[from]];
  const seen = new Set<PlaceId>([from]);
  while (queue.length > 0) {
    const path = queue.shift()!;
    const tail = path[path.length - 1];
    for (const next of PLACES[tail].exits) {
      if (seen.has(next)) continue;
      const extended = [...path, next];
      if (next === to) return extended;
      seen.add(next);
      queue.push(extended);
    }
  }
  return [];
}

/**
 * The beats that play when moving between two places.
 *
 * Arriving somewhere is not one animation: the old place has to let go, the
 * journey has to read as a journey, and the new subject has to arrive. Naming
 * that as a sequence is what keeps every transition in the product consistent.
 */
export function transitionBeats(from: PlaceId, to: PlaceId): MotionBeat[] {
  if (from === to) return [];
  if (to === "inspection") return ["FOCUS", "ISOLATE", "ACTIVATE"];
  if (from === "inspection") return ["DEACTIVATE", "REASSEMBLE", "FOCUS"];
  if (to === "suit") return ["TRANSITION", "FOCUS", "ACTIVATE"];
  if (to === "suit-bay") return ["TRANSITION", "MATERIALIZE", "FOCUS"];
  return ["DEACTIVATE", "TRANSITION", "MATERIALIZE"];
}

/**
 * Lighting for a place, nudged by what VOX is currently doing.
 *
 * The room is the base and the state is a modifier, not the other way round —
 * a laboratory does not change colour because a task finished. Executing lifts
 * the accent slightly; error pulls the accent to amber so the environment
 * itself reads as needing attention without turning red and cheap.
 */
export function lightingFor(place: PlaceId, state: ExperienceState): LightingPreset {
  const base = LIGHTING[PLACES[place].lighting];
  switch (state) {
    case "executing":
      return { ...base, rim: base.rim * 1.35, atmosphere: base.atmosphere * 1.1 };
    case "error":
      return { ...base, accent: "#f59e0b", rim: base.rim * 1.2 };
    case "listening":
      return { ...base, rim: base.rim * 1.2, ambient: base.ambient * 1.1 };
    case "idle":
      return { ...base, rim: base.rim * 0.8 };
    default:
      return base;
  }
}
