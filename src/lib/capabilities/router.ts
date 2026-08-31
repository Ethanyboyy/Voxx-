/**
 * The capability router: given a request, decide what it actually requires.
 *
 * The hardest requirement in the brief is not "route image requests to the
 * image provider" — it is *"WHEN NOT to use any of them."* A router that
 * reaches for a provider because one is configured produces a system that
 * generates a picture every time you mention a suit. So the default here is
 * the empty plan, and every capability has to be argued into it.
 *
 * Two stages, on purpose:
 *
 *   1. A deterministic pre-pass over strong lexical and structural signals.
 *      Most requests are not ambiguous — "make a trailer" is temporal, "give
 *      me ten variations" is image, "fix the Suit Bay" is execution — and
 *      deciding those without a model call makes routing fast, free, and
 *      assertable in unit tests. This is the part that has to be right.
 *
 *   2. A model-assisted fallback for the genuinely unclear remainder, through
 *      the existing getAIProvider(). Reached only when the pre-pass has no
 *      confident signal, so a provider outage degrades routing to "answer
 *      directly" rather than breaking it.
 *
 * Routing metadata is deliberately thin — capability, provider, a one-line
 * operational reason. The brief forbids exposing or storing chain-of-thought,
 * and a `reason` field is where that rule is most easily broken by accident.
 */

import type { Capability, CapabilityPlan, CapabilityStep } from "@/lib/capabilities/types";
import { EMPTY_PLAN } from "@/lib/capabilities/types";

/** What the router is allowed to know. All of it is real, caller-supplied state. */
export interface RoutingContext {
  /** The user's request, verbatim. */
  request: string;
  /** Whether any usable visual reference is already attached or in scope. */
  hasVisualReference?: boolean;
  /** Whether the subject already has a 3D asset VOX could film or edit. */
  hasModel3d?: boolean;
  /**
   * Which capabilities have a CONFIGURED provider behind them right now.
   * Absent entries are treated as unavailable — the router must never plan a
   * step it already knows cannot run.
   */
  available?: Partial<Record<Capability, boolean>>;
  /** Capabilities the caller's permissions forbid. Filtered out of the plan. */
  denied?: Capability[];
}

const MAX_REASON = 120;

function step(capability: Capability, reason: string, optional = false): CapabilityStep {
  return { capability, reason: reason.slice(0, MAX_REASON), optional };
}

/**
 * Temporal words. The distinguishing question for video is not "is this
 * visual" but "does the output MOVE" — a trailer, a reveal, a flythrough, a
 * shot. "Show me the suit" is a still; "show the suit activating" is not.
 */
const TEMPORAL = [
  "trailer", "cinematic", "video", "film", "footage", "shot", "sequence",
  "reveal", "flythrough", "fly through", "walkthrough", "animate", "animation",
  "commercial", "promo", "promotional", "montage", "clip", "b-roll",
];

/**
 * "Show the suit ACTIVATING" is a video; "show me the suit" is a picture.
 *
 * The difference is a continuous-form action verb, not a noun, so no amount of
 * adding words to TEMPORAL catches it — "Show this suit walking through the
 * Lab" contains none of them. Matching bare `-ing` would over-fire ("show me
 * the EXISTING suits"), so the verbs are enumerated: every one denotes
 * something happening over time, which is exactly what makes the output
 * temporal.
 */
const PRESENTATIONAL = ["show", "watch", "see ", "let me see", "demonstrate"];
const MOTION_VERBS = [
  "walking", "running", "moving", "activating", "deploying", "launching",
  "opening", "closing", "transforming", "assembling", "disassembling",
  "unfolding", "folding", "flying", "landing", "turning", "rotating",
  "powering up", "powering on", "starting up", "operating", "firing",
];

/** Words that ask for a picture to exist that does not yet. */
const IMAGE_MAKE = [
  "concept art", "moodboard", "mood board", "design a", "visualize", "visualise",
  "render a concept", "illustration", "artwork", "sketch", "image of", "picture of",
];

/** Words that ask for an EXISTING picture to change. */
const IMAGE_EDIT = [
  "change the color", "change the colour", "recolor", "recolour", "restyle",
  "keep this", "same design but", "using this image", "based on this image",
  "edit this", "modify this image", "make this look", "improve the realism",
  "more realistic", "redesign the",
];

/**
 * Requests that ask VOX to change the actual software.
 *
 * PATTERNS, not fixed phrases. A literal list failed on real sentences that
 * are obviously execution requests: "build THE CHOSEN DESIGN into the Suit
 * Bay" does not contain "build it into", and "find what is wrong ... and fix
 * it" does not contain "fix the". The variable part is the object, so the
 * pattern has to allow for one rather than enumerate every phrasing.
 */
const EXECUTION_PATTERNS: RegExp[] = [
  /\bfix (the|this|that|it)\b/,
  // "build X into the Suit Bay" for any reasonable X.
  /\bbuild\b[^.?!]{0,60}\b(into|in) the\b/,
  /\b(implement|refactor)\b/,
  /\bwire (it |this |them )?up\b/,
  /\badd a\b/,
  /\bmake the code\b/,
  /\bin the (codebase|code|repo|repository|project)\b/,
  /\brun the tests\b/,
  /\bget (it|this|them) working\b/,
  // "make it match", "make the Suit Bay match the reference".
  /\bmake\b[^.?!]{0,40}\bmatch\b/,
  /\bapply (this|that|it)\b[^.?!]{0,30}\bto the\b/,
];

/** Asking for more than one option is an image-generation tell. */
const VARIATION = /\b(\d+|two|three|four|five|six|ten|several|multiple)\s+(variation|version|option|concept|design|alternative)s?\b/i;

/** Something VOX would have to look up rather than recall. */
const RESEARCH = ["look up", "research", "find out", "what's the latest", "current best practice"];

/**
 * Requests that are ASKING FOR A JUDGEMENT about something visual.
 *
 * Distinct from the QA that automatically follows generation. These are cases
 * where evaluation is the whole task and nothing needs to be produced:
 * "does this match the reference?" wants an answer, not an image.
 */
const QA_REQUEST_PATTERNS: RegExp[] = [
  // "does this match", and also "does this IMAGE match the reference".
  /\bdoes (this|it|that|the)\b[^.?!]{0,40}\bmatch\b/,
  /\bcompare (these|those|the)\b/,
  /\bis (this|it|that)\b[^.?!]{0,30}\bclose to\b/,
  /\bhow close\b/,
  /\bcheck (whether|if)\b/,
  /\b(review|evaluate|assess) (this|that|these|the)\b/,
  /\b(what'?s|what is) wrong with\b/,
  /\bfind what(?:'?s| is)? wrong\b/,
];

/**
 * Phrases that attach a correctness bar to work being requested.
 *
 * "Make a trailer" is a generation task. "Make a trailer and make sure the
 * suit stays consistent" is a generation task WITH an acceptance criterion,
 * and the criterion is what turns the optional QA step into a required one.
 */
const QUALITY_BAR = [
  "make sure", "make it match", "match the reference", "as close as possible",
  "get it as close", "stays consistent", "stay consistent", "keep it consistent",
  "verify", "validate", "make certain", "ensure",
];

function mentionsAny(text: string, needles: string[]): boolean {
  return needles.some((n) => text.includes(n));
}

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Names of things VOX stores, which imply it should recall before acting.
 * Deliberately about VOX's own domain: a request that names a suit, the Lab or
 * a project is one where answering from nothing would be worse than answering
 * from what is on record.
 */
const MEMORY_SUBJECTS = ["suit", "lab", "mark ", "vx-", "project", "objective", "gadget", "the bay"];

/**
 * The deterministic pass.
 *
 * Returns null when it has no confident opinion, which is the signal to fall
 * back to the model. Returning a low-confidence guess here would be worse than
 * admitting uncertainty — it would be an untestable guess wearing a
 * deterministic label.
 */
export function routeDeterministic(context: RoutingContext): CapabilityPlan | null {
  const text = context.request.toLowerCase();
  const steps: CapabilityStep[] = [];

  const wantsVideo =
    mentionsAny(text, TEMPORAL) ||
    (mentionsAny(text, PRESENTATIONAL) && mentionsAny(text, MOTION_VERBS));
  const wantsEdit = mentionsAny(text, IMAGE_EDIT) || (context.hasVisualReference === true && /\b(this|it)\b/.test(text) && mentionsAny(text, ["color", "colour", "lens", "material", "realistic"]));
  const wantsImage = mentionsAny(text, IMAGE_MAKE) || VARIATION.test(context.request);
  const wantsExecution = matchesAny(text, EXECUTION_PATTERNS);
  const wantsResearch = mentionsAny(text, RESEARCH);
  const asksForJudgement = matchesAny(text, QA_REQUEST_PATTERNS);
  const setsQualityBar = mentionsAny(text, QUALITY_BAR);

  if (!wantsVideo && !wantsEdit && !wantsImage && !wantsExecution && !wantsResearch && !asksForJudgement) {
    // No signal at all is not the same as "answer directly" — a short, vague
    // request may still need routing. Defer rather than assert.
    return null;
  }

  // Recall first, whenever the request names something VOX has on record.
  // This is the step that makes "a trailer for the Mark 07" use the real
  // Mark 07 rather than inventing one.
  if (mentionsAny(text, MEMORY_SUBJECTS)) {
    steps.push(step("MEMORY", "request names a subject VOX has records for"));
  }

  if (wantsResearch) {
    steps.push(step("RESEARCH", "request asks for information VOX does not hold"));
  }

  if (wantsExecution) {
    steps.push(step("EXECUTION", "request asks to change the application itself"));
    // "Build it into the Suit Bay AND make it match the reference" is not one
    // instruction, it is a change plus an acceptance test. Without this the
    // agent would edit the code and never look at what it produced.
    if (setsQualityBar || asksForJudgement) {
      steps.push(step("VISUAL_QA", "implementation must be checked against the target"));
    }
  }

  // Video needs something to film. When there is no usable visual reference
  // and no 3D model, a concept image is a REQUIRED precursor, not a nicety —
  // this is the chaining the brief describes, expressed as a routing rule
  // rather than as a hardcoded pipeline.
  if (wantsVideo) {
    const hasSubject = context.hasVisualReference === true || context.hasModel3d === true;
    if (!hasSubject) {
      steps.push(step("IMAGE_GENERATION", "no visual reference exists to film"));
    }
    steps.push(step("VIDEO_GENERATION", "requested output moves"));
  } else if (wantsEdit) {
    steps.push(step("IMAGE_EDIT", "request modifies an existing image"));
  } else if (wantsImage) {
    steps.push(step("IMAGE_GENERATION", "request asks for an image that does not exist yet"));
  }

  const producesMedia = steps.some(
    (s) => s.capability === "IMAGE_GENERATION" || s.capability === "IMAGE_EDIT" || s.capability === "VIDEO_GENERATION",
  );

  if (producesMedia) {
    // Optional by default — QA being unavailable should not block delivering
    // the media. But when the request states a bar to clear, the check IS the
    // task and skipping it would answer a different question.
    const required = setsQualityBar || asksForJudgement;
    steps.push(step("VISUAL_QA", required ? "request states a quality bar to clear" : "verify generated media before presenting it", !required));
  } else if (asksForJudgement && !steps.some((s) => s.capability === "VISUAL_QA")) {
    // Evaluation as the whole task: "does this match the reference?" wants an
    // answer, not a new image.
    steps.push(step("VISUAL_QA", "request asks for a judgement about existing media"));
  }

  return finalize({ steps, strategy: "deterministic", degraded: false, notes: [] }, context);
}

/**
 * Applies permission and availability reality to a proposed plan.
 *
 * Separated from the routing rules so both the deterministic and the
 * model-assisted path go through exactly one filter. A required step whose
 * provider is unconfigured degrades the plan and says so; an optional one is
 * dropped quietly, which is the difference between "we could not do this" and
 * "we did not need to".
 */
export function finalize(plan: CapabilityPlan, context: RoutingContext): CapabilityPlan {
  const denied = new Set(context.denied ?? []);
  const available = context.available ?? {};
  const notes = [...plan.notes];
  let degraded = plan.degraded;

  const steps: CapabilityStep[] = [];
  for (const s of plan.steps) {
    if (denied.has(s.capability)) {
      degraded = true;
      notes.push(`${s.capability} not permitted`);
      continue;
    }
    // Only capabilities explicitly reported unavailable are dropped. An absent
    // entry means the caller did not tell us, and inventing an answer either
    // way would be worse than proceeding and letting the provider speak.
    if (available[s.capability] === false) {
      degraded = true;
      notes.push(`${s.capability} has no configured provider`);
      continue;
    }
    steps.push(s);
  }

  // QA with nothing left to check is noise, not diligence — but only when it
  // was the OPTIONAL follow-up to generation that then got dropped. A required
  // QA step is the task itself: "does this match the reference?" judges media
  // that already exists, and "build it and make it match" judges a render the
  // execution step produces. Stripping those because no generator ran would
  // silently answer a different question.
  const producesMedia = steps.some(
    (s) => s.capability === "IMAGE_GENERATION" || s.capability === "IMAGE_EDIT" || s.capability === "VIDEO_GENERATION",
  );
  const cleaned = producesMedia
    ? steps
    : steps.filter((s) => s.capability !== "VISUAL_QA" || !s.optional);

  // A plan that lost everything is a direct answer, not an empty ceremony.
  if (cleaned.length === 0) {
    return { steps: [], strategy: "direct", degraded, notes };
  }

  return { steps: cleaned, strategy: plan.strategy, degraded, notes };
}

/**
 * Routes a request.
 *
 * `classify` is the model-assisted fallback, injected rather than imported so
 * this module stays free of a provider dependency and fully testable. Callers
 * pass a function that consults getAIProvider(); tests pass a stub; omitting it
 * entirely is valid and yields the empty plan, which is the correct behaviour
 * when no classifier is available — VOX answers directly rather than guessing
 * expensively.
 */
export async function routeRequest(
  context: RoutingContext,
  classify?: (context: RoutingContext) => Promise<Capability[]>,
): Promise<CapabilityPlan> {
  const deterministic = routeDeterministic(context);
  if (deterministic) return deterministic;

  if (!classify) return EMPTY_PLAN;

  let capabilities: Capability[] = [];
  try {
    capabilities = await classify(context);
  } catch {
    // A classifier failure must not fail the request. Answering directly is
    // always a legitimate outcome, so degrade to it rather than propagating.
    return EMPTY_PLAN;
  }

  if (capabilities.length === 0) return EMPTY_PLAN;

  return finalize(
    {
      steps: capabilities.map((c) => step(c, "selected by request classification")),
      strategy: "model_assisted",
      degraded: false,
      notes: [],
    },
    context,
  );
}
