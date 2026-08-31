import { describe, expect, it } from "vitest";
import {
  COMPLETE_HOLD_SECONDS,
  EXPERIENCE_STATES,
  STATE_CHARACTER,
  deriveExperienceState,
  isMajorTransition,
} from "@/lib/experience/state";
import { MOTION, beatLength, choreograph, sequenceLength } from "@/lib/experience/motion";
import { LIGHTING, PLACES, lightingFor, routeBetween, transitionBeats } from "@/lib/experience/world";
import { describeIntent, normalizeCommand, parseCommand } from "@/lib/experience/intents";
import { WRIST_ASSEMBLY, assemblyNodes, describePart, getAssembly, partOffset } from "@/lib/experience/assembly";
import { GestureRecognizer, LONG_PRESS_MS, MIN_TOUCH_TARGET_PX, type GestureEvent } from "@/lib/experience/gestures";
import { buildTree, selectNode, INITIAL_INTERACTION } from "@/lib/3d/interaction";

describe("experience state", () => {
  it("derives state from real cognitive state, never decoration", () => {
    expect(deriveExperienceState({ brainState: "idle" })).toBe("idle");
    expect(deriveExperienceState({ brainState: "thinking" })).toBe("thinking");
    expect(deriveExperienceState({ brainState: "researching" })).toBe("analyzing");
    expect(deriveExperienceState({ brainState: "learning" })).toBe("analyzing");
    expect(deriveExperienceState({ brainState: "executing" })).toBe("executing");
  });

  it("puts an error above everything else", () => {
    // Never animate over a failure.
    expect(deriveExperienceState({ brainState: "error", listening: true, transitioning: true })).toBe("error");
  });

  it("shows listening the moment the microphone is genuinely open", () => {
    expect(deriveExperienceState({ brainState: "thinking", listening: true })).toBe("listening");
    // ...and not when it isn't.
    expect(deriveExperienceState({ brainState: "thinking", listening: false })).toBe("thinking");
  });

  it("treats waiting-on-the-user as idle, not as progress", () => {
    // "waiting" is VOX blocked on a human. Pulsing would claim work is
    // happening that is not.
    expect(deriveExperienceState({ brainState: "waiting" })).toBe("idle");
  });

  it("lets completion expire instead of living in it", () => {
    expect(deriveExperienceState({ brainState: "idle", justCompleted: true, secondsSinceEvent: 1 })).toBe("complete");
    expect(
      deriveExperienceState({ brainState: "idle", justCompleted: true, secondsSinceEvent: COMPLETE_HOLD_SECONDS + 1 }),
    ).toBe("idle");
    // No event timestamp at all cannot fake freshness.
    expect(deriveExperienceState({ brainState: "idle", justCompleted: true, secondsSinceEvent: null })).toBe("idle");
  });

  it("gives every state a restrained character", () => {
    for (const state of EXPERIENCE_STATES) {
      const character = STATE_CHARACTER[state];
      expect(character.label).toBeTruthy();
      expect(character.signals.length).toBeGreaterThan(0);
      // The whole scale stays low: restraint is the brief.
      expect(character.intensity).toBeGreaterThan(0);
      expect(character.intensity).toBeLessThanOrEqual(0.9);
    }
    // Idle must be visibly quieter than executing, or state means nothing.
    expect(STATE_CHARACTER.idle.intensity).toBeLessThan(STATE_CHARACTER.executing.intensity / 2);
  });

  it("reserves the big transition beat for real changes of situation", () => {
    expect(isMajorTransition("thinking", "thinking")).toBe(false);
    // One continuous escalation, not three separate events.
    expect(isMajorTransition("thinking", "analyzing")).toBe(false);
    expect(isMajorTransition("analyzing", "executing")).toBe(false);
    expect(isMajorTransition("idle", "executing")).toBe(true);
    expect(isMajorTransition("executing", "complete")).toBe(true);
    expect(isMajorTransition("thinking", "error")).toBe(true);
  });
});

describe("motion vocabulary", () => {
  it("keeps reassembly slower than separation", () => {
    // Things fly apart and settle precisely; equal timing loses that.
    expect(MOTION.REASSEMBLE.duration).toBeGreaterThan(MOTION.EXPLODE.duration);
  });

  it("makes the context change the longest beat", () => {
    expect(beatLength("TRANSITION")).toBeGreaterThan(beatLength("FOCUS"));
    expect(beatLength("TRANSITION")).toBeGreaterThan(beatLength("ACTIVATE"));
  });

  it("marks camera and assembly beats as non-decorative", () => {
    // Reduced motion may drop atmosphere; it must not drop the beats that
    // carry meaning, or the interface stops explaining itself.
    for (const beat of ["FOCUS", "ISOLATE", "EXPLODE", "REASSEMBLE", "TRANSITION"] as const) {
      expect(MOTION[beat].decorative).toBe(false);
    }
  });

  it("overlaps choreographed beats into one continuous movement", () => {
    const beats = ["TRANSITION", "MATERIALIZE", "FOCUS"] as const;
    const laid = choreograph([...beats]);
    expect(laid.map((b) => b.beat)).toEqual([...beats]);
    expect(laid[0].at).toBe(0);
    // Each starts before the previous has settled.
    expect(laid[1].at).toBeLessThan(beatLength("TRANSITION"));
    expect(laid[2].at).toBeGreaterThan(laid[1].at);
    // And the sequence is shorter than playing them end to end.
    const strict = beats.reduce((sum, b) => sum + beatLength(b), 0);
    expect(sequenceLength([...beats])).toBeLessThan(strict);
  });

  it("is stable for an empty sequence", () => {
    expect(choreograph([])).toEqual([]);
    expect(sequenceLength([])).toBe(0);
  });
});

describe("spatial world", () => {
  it("routes between places by fewest context changes", () => {
    expect(routeBetween("brain", "brain")).toEqual(["brain"]);
    expect(routeBetween("brain", "suit-bay")).toEqual(["brain", "suit-bay"]);
    const toInspection = routeBetween("brain", "inspection");
    expect(toInspection[0]).toBe("brain");
    expect(toInspection[toInspection.length - 1]).toBe("inspection");
    // Every hop must be a real exit, not a teleport.
    for (let i = 1; i < toInspection.length; i++) {
      expect(PLACES[toInspection[i - 1]].exits).toContain(toInspection[i]);
    }
  });

  it("names a beat sequence for every transition it supports", () => {
    expect(transitionBeats("brain", "brain")).toEqual([]);
    expect(transitionBeats("suit", "inspection")).toContain("ISOLATE");
    // Leaving inspection puts the object back together first.
    expect(transitionBeats("inspection", "suit")).toContain("REASSEMBLE");
    expect(transitionBeats("brain", "suit-bay")).toContain("MATERIALIZE");
  });

  it("keeps every lighting preset dark and restrained", () => {
    for (const preset of Object.values(LIGHTING)) {
      expect(preset.exposure).toBeLessThanOrEqual(1.15);
      // A dark environment: ambient never washes the room out.
      expect(preset.ambient).toBeLessThan(0.4);
      // The accent stays an accent.
      expect(preset.rim).toBeLessThan(preset.key);
    }
  });

  it("modulates room lighting by state without repainting the room", () => {
    const base = LIGHTING[PLACES["suit-bay"].lighting];
    const executing = lightingFor("suit-bay", "executing");
    expect(executing.rim).toBeGreaterThan(base.rim);
    expect(executing.key).toBe(base.key);
    // Error reads as attention, not as a red alarm.
    expect(lightingFor("suit-bay", "error").accent).toBe("#f59e0b");
    expect(lightingFor("suit-bay", "idle").rim).toBeLessThan(base.rim);
  });
});

describe("spatial intents", () => {
  it("understands the signature commands", () => {
    expect(parseCommand("Show me the latest suit")).toEqual({ kind: "goto", place: "suit", subject: "latest" });
    expect(parseCommand("Show me how this works")).toEqual({ kind: "inspect" });
    expect(parseCommand("Put it back")).toEqual({ kind: "reassemble" });
    expect(parseCommand("Return to Brain")).toEqual({ kind: "goto", place: "brain" });
  });

  it("prefers the more specific command when two could match", () => {
    // "put it back" must not be swallowed by a generic "back" rule.
    expect(parseCommand("put it back")).toEqual({ kind: "reassemble" });
    // A named subassembly beats the generic suit command.
    expect(parseCommand("show me the wrist")).toEqual({ kind: "inspect", target: "wrist" });
  });

  it("strips filler and politeness before matching", () => {
    expect(normalizeCommand("Hey Vox, could you please zoom in?")).toBe("zoom in");
    expect(parseCommand("Hey Vox, could you please zoom in?")).toEqual({ kind: "zoom", direction: "in" });
  });

  it("returns null rather than guessing a destination", () => {
    // Flying the camera somewhere the user did not ask for is worse than
    // admitting the command was not understood.
    expect(parseCommand("what is the weather like")).toBeNull();
    expect(parseCommand("")).toBeNull();
    expect(parseCommand("   ")).toBeNull();
  });

  it("can describe whatever it parsed", () => {
    for (const command of ["show me the latest suit", "put it back", "explode", "zoom out", "reset", "isolate", "the mask"]) {
      const intent = parseCommand(command);
      expect(intent, command).not.toBeNull();
      expect(describeIntent(intent!).length).toBeGreaterThan(0);
    }
  });
});

describe("assemblies", () => {
  it("gives every part a real function, not a serial number", () => {
    for (const part of WRIST_ASSEMBLY.parts) {
      expect(part.label).toBeTruthy();
      // If it cannot be explained, it should not be a separately named part.
      expect(part.function.length).toBeGreaterThan(20);
    }
    // Logical parts, not a shower of fragments.
    expect(WRIST_ASSEMBLY.parts.length).toBeLessThanOrEqual(10);
  });

  it("reassembles exactly, with no accumulated drift", () => {
    // The whole promise of reassembly: every part returns to where it started.
    for (const part of WRIST_ASSEMBLY.parts) {
      expect(partOffset(part, 0, WRIST_ASSEMBLY.parts.length)).toEqual([0, 0, 0]);
    }
  });

  it("separates monotonically and stays hand-sized", () => {
    const count = WRIST_ASSEMBLY.parts.length;
    for (const part of WRIST_ASSEMBLY.parts) {
      let previous = -1;
      for (const amount of [0, 0.25, 0.5, 0.75, 1]) {
        const [x, y, z] = partOffset(part, amount, count);
        const travel = Math.hypot(x, y, z);
        expect(travel).toBeGreaterThanOrEqual(previous - 1e-9);
        previous = travel;
      }
      // A 6cm device that explodes 30cm reads as debris, not a mechanism.
      expect(previous).toBeLessThanOrEqual(0.08);
    }
  });

  it("clamps out-of-range separation instead of flinging parts away", () => {
    const part = WRIST_ASSEMBLY.parts[3];
    const count = WRIST_ASSEMBLY.parts.length;
    expect(partOffset(part, -1, count)).toEqual([0, 0, 0]);
    const far = partOffset(part, 5, count);
    const full = partOffset(part, 1, count);
    expect(far).toEqual(full);
  });

  it("takes the outside off before the inside", () => {
    const ordered = [...WRIST_ASSEMBLY.parts].sort((a, b) => a.order - b.order);
    expect(ordered[0].id).toBe("wristHousing");
    // Orders are distinct, so the stagger is a real sequence.
    expect(new Set(ordered.map((p) => p.order)).size).toBe(ordered.length);
  });

  it("plugs straight into the shared interaction framework", () => {
    const nodes = assemblyNodes(WRIST_ASSEMBLY);
    const tree = buildTree(nodes);
    const state = selectNode(tree, INITIAL_INTERACTION, "wristCartridge");
    expect(state.selectedId).toBe("wristCartridge");
    expect(getAssembly("wrist")).not.toBeNull();
    expect(getAssembly("nope")).toBeNull();
    expect(describePart(WRIST_ASSEMBLY, "wristNozzle")?.label).toBe("Nozzle");
    expect(describePart(WRIST_ASSEMBLY, "missing")).toBeNull();
  });
});

describe("touch gestures", () => {
  function harness(startAt = 1000) {
    const events: GestureEvent[] = [];
    let clock = startAt;
    const recognizer = new GestureRecognizer({ onGesture: (e) => events.push(e), now: () => clock });
    return {
      events,
      recognizer,
      advance: (ms: number) => {
        clock += ms;
      },
      names: () => events.map((e) => e.name),
    };
  }

  it("recognises a tap", () => {
    const h = harness();
    h.recognizer.down(1, 100, 100);
    h.recognizer.up(1);
    expect(h.names()).toEqual(["tap"]);
  });

  it("does not turn a small wobble into a drag", () => {
    // A tap on a moving train is still a tap.
    const h = harness();
    h.recognizer.down(1, 100, 100);
    h.recognizer.move(1, 104, 103);
    h.recognizer.up(1);
    expect(h.names()).toEqual(["tap"]);
  });

  it("emits drag once the finger really travels, and suppresses the tap", () => {
    const h = harness();
    h.recognizer.down(1, 100, 100);
    h.recognizer.move(1, 160, 100);
    h.recognizer.up(1);
    expect(h.names()).toEqual(["drag"]);
  });

  it("fires long press only after the finger has stayed put", () => {
    const h = harness();
    h.recognizer.down(1, 100, 100);
    h.recognizer.tick();
    expect(h.names()).toEqual([]);
    h.advance(LONG_PRESS_MS + 10);
    h.recognizer.tick();
    h.recognizer.tick(); // must not fire twice
    expect(h.names()).toEqual(["long-press"]);
    h.recognizer.up(1);
    // A long press is not also a tap.
    expect(h.names()).toEqual(["long-press"]);
  });

  it("does not fire long press while the user is dragging", () => {
    const h = harness();
    h.recognizer.down(1, 100, 100);
    h.recognizer.move(1, 200, 100);
    h.advance(LONG_PRESS_MS + 50);
    h.recognizer.tick();
    expect(h.names()).toEqual(["drag"]);
  });

  it("recognises a double tap and does not double-count it", () => {
    const h = harness();
    h.recognizer.down(1, 100, 100);
    h.recognizer.up(1);
    h.advance(120);
    h.recognizer.down(2, 104, 102);
    h.recognizer.up(2);
    expect(h.names()).toEqual(["tap", "double-tap"]);

    // A third tap after the window starts a new sequence rather than chaining.
    h.advance(2000);
    h.recognizer.down(3, 104, 102);
    h.recognizer.up(3);
    expect(h.names()).toEqual(["tap", "double-tap", "tap"]);
  });

  it("treats two slow taps as two taps", () => {
    const h = harness();
    h.recognizer.down(1, 100, 100);
    h.recognizer.up(1);
    h.advance(900);
    h.recognizer.down(2, 100, 100);
    h.recognizer.up(2);
    expect(h.names()).toEqual(["tap", "tap"]);
  });

  it("pinches without also orbiting", () => {
    // Two fingers must zoom, not spin the object at the same time.
    const h = harness();
    h.recognizer.down(1, 100, 100);
    h.recognizer.down(2, 200, 100);
    h.recognizer.move(2, 300, 100);
    expect(h.names()).toEqual(["pinch"]);
    expect(h.events[0].scale).toBeCloseTo(2, 5);
    h.recognizer.up(2);
    h.recognizer.up(1);
    // And a pinch never leaves a stray tap behind.
    expect(h.names()).toEqual(["pinch"]);
  });

  it("forgets everything on cancel", () => {
    const h = harness();
    h.recognizer.down(1, 100, 100);
    h.recognizer.cancel(1);
    h.advance(LONG_PRESS_MS + 100);
    h.recognizer.tick();
    expect(h.names()).toEqual([]);
  });

  it("keeps touch targets comfortable", () => {
    expect(MIN_TOUCH_TARGET_PX).toBeGreaterThanOrEqual(44);
  });
});
