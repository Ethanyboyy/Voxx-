/**
 * P1 — CLASSIFICATION METADATA.
 *
 * What this is for. VOX has always been able to answer "is this user ALLOWED to
 * do this?" — that is `checkCapability()` on the
 * OBSERVE < ANALYZE < RECOMMEND < ASK < ACT ladder, and it remains the only
 * source of authorization truth. What VOX has never been able to answer is a
 * different question: "what does this action actually DO, and can it be taken
 * back?" A granted ACT permission says a human once decided this class of
 * action was permitted. It says nothing about whether this particular call
 * overwrites an untracked file, spends money that cannot be recovered, or
 * merely lists a directory.
 *
 * These two questions are deliberately kept apart.
 *
 *   AUTHORIZATION  — src/lib/permissions/service.ts, CAPABILITY_PERMISSION_KEY.
 *                    Who may do this. UNCHANGED by this phase.
 *   CLASSIFICATION — this file. What this is, and what it costs to be wrong.
 *
 * src/lib/capabilities/types.ts already rejected a second permission ladder
 * (READ/WRITE/EXECUTE/NETWORK/DEPLOY/DESTRUCTIVE) on the grounds that a second
 * vocabulary for "what is allowed" is the first thing to drift out of agreement
 * with the first. That reasoning is right and it is why nothing here duplicates
 * a permission key, a capability level, or a grant. `Effect` below is NOT a
 * permission level: `workspace.validate` requires only ANALYZE but runs the
 * repository's own build, and `qa.visual_review` requires only RECOMMEND but
 * charges a provider. Consequence and authorization are genuinely different
 * axes, which is exactly why one cannot be derived from the other.
 *
 * EVERYTHING HERE IS STATIC. Not one value in this file is produced by a model,
 * inferred from a prompt, or read out of free text. Classification is a
 * property of the tool as written, decided by whoever adds the tool, reviewable
 * in a diff. A model cannot argue with a lookup table.
 */

/**
 * Runtime immutability for everything in this module.
 *
 * WHY THIS EXISTS. An adversarial audit of P1/P2 reproduced, in three lines,
 * the reclassification of `workspace.write` from WRITE/PARTIALLY_REVERSIBLE
 * (HOLD) to READ/REVERSIBLE (ALLOW), process-wide and permanently:
 *
 *   const c = classifyAction("tool", "workspace.write").classification;
 *   c.effect = "READ";
 *
 * `Readonly<T>` and `readonly` are erased at compile time. They stop a
 * TypeScript author; they stop nothing at runtime, and the lookup handed out a
 * live reference INTO the shared table, so mutating the returned object was the
 * same as editing the table. `UNKNOWN_ACTION` was worse: one shared object
 * served as the conservative default for every unclassified action, so
 * poisoning it once moved that default from HOLD to ALLOW for everything.
 *
 * Freezing is the fix rather than copy-on-read because a copy still leaves the
 * source mutable, and because a frozen object can be shared safely — the
 * lookup keeps returning the table's own entry, which is what makes the
 * classification identity-stable. Assignment to a frozen property THROWS in
 * strict mode (ES modules are always strict), so a mutation attempt fails
 * loudly at the attempt rather than quietly succeeding.
 */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

/**
 * How exposed the material a task handles is.
 *
 * Ordered least to most restricted. Used today to record what a run touched;
 * P6 uses it to keep a provider without the necessary clearance off a task
 * (a third-party model may see PUBLIC material and nothing above it).
 */
export type Sensitivity = "PUBLIC" | "INTERNAL" | "PRIVATE" | "SENSITIVE";

export const SENSITIVITIES: readonly Sensitivity[] = deepFreeze(["PUBLIC", "INTERNAL", "PRIVATE", "SENSITIVE"] as const);

/**
 * How current the information a task needs has to be.
 *
 *   STATIC   — answerable from what is already known; nothing expires.
 *   FRESH    — needs recent material, but not this minute's.
 *   REALTIME — only a live source will do.
 */
export type Freshness = "STATIC" | "FRESH" | "REALTIME";

export const FRESHNESSES: readonly Freshness[] = deepFreeze(["STATIC", "FRESH", "REALTIME"] as const);

/** How much thinking the task warrants. Bounded on purpose — see the note below. */
export type ReasoningDepth = "LOW" | "MEDIUM" | "HIGH";

export const REASONING_DEPTHS: readonly ReasoningDepth[] = deepFreeze(["LOW", "MEDIUM", "HIGH"] as const);

/**
 * How long the caller can wait.
 *
 *   INTERACTIVE — a person is watching a cursor blink.
 *   STANDARD    — a normal request/response.
 *   EXTENDED    — a background run may take as long as it takes.
 */
export type LatencyBudget = "INTERACTIVE" | "STANDARD" | "EXTENDED";

export const LATENCY_BUDGETS: readonly LatencyBudget[] = deepFreeze(["INTERACTIVE", "STANDARD", "EXTENDED"] as const);

/**
 * What the task may cost at a third party.
 *
 * FREE is not "cheap" — it means no external charge is incurred at all, which
 * is true of every VOX-internal tool and is the honest default.
 */
export type CostBudget = "FREE" | "LOW" | "MODERATE" | "HIGH";

export const COST_BUDGETS: readonly CostBudget[] = deepFreeze(["FREE", "LOW", "MODERATE", "HIGH"] as const);

/**
 * What a task IS.
 *
 * Every field is a bounded enum or a boolean. There is deliberately no numeric
 * score and no free-text field: a number invites a model to produce one, and a
 * string invites a model to argue through it.
 *
 * Note what is absent. `confidence`, `reliability` and `availability` are NOT
 * here. They describe how a provider happens to be behaving right now, not what
 * the task requires, and mixing a runtime observation into a task description is
 * how a policy input becomes something a degraded provider can move. Provider
 * availability already has a home in src/lib/capabilities/availability.ts.
 */
export interface TaskClassification {
  sensitivity: Sensitivity;
  freshness: Freshness;
  /** The task cannot be answered by generating text alone. */
  needsTools: boolean;
  /** The caller parses the result; prose is not sufficient. */
  needsStructuredOutput: boolean;
  /** The task requires looking at an image. */
  needsVision: boolean;
  reasoningDepth: ReasoningDepth;
  latencyBudget: LatencyBudget;
  costBudget: CostBudget;
}

/**
 * What an action DOES. The policy input proper.
 *
 *   READ      — observes something. Changes nothing.
 *   ANALYZE   — derives something from what it observed. Still changes nothing
 *               a user would notice, though it may burn CPU or money.
 *   WRITE     — changes VOX's own state: a row, a file in the workspace.
 *   ACT       — reaches outside VOX. Someone else's system now differs.
 *   FINANCIAL — moves money on the user's own ledger. Reserved for operations
 *               whose PURPOSE is the money.
 *
 * The FINANCIAL/ACT line matters and is easy to get wrong. `media.image.generate`
 * charges a provider, but its purpose is an image — it is ACT with
 * `financial: true`. `economic.record_expense` exists to move the ledger — it is
 * FINANCIAL. The distinction is the operation's reason for existing, not whether
 * a bill arrives, which is what the separate flag is for.
 */
export type Effect = "READ" | "ANALYZE" | "WRITE" | "ACT" | "FINANCIAL";

export const EFFECTS: readonly Effect[] = deepFreeze(["READ", "ANALYZE", "WRITE", "ACT", "FINANCIAL"] as const);

/**
 * Whether the effect can be undone, and at what cost.
 *
 *   REVERSIBLE            — a single ordinary operation puts it back. Deleting
 *                           a row VOX created.
 *   PARTIALLY_REVERSIBLE  — recoverable, but not cleanly or not entirely. A
 *                           tracked file can come back from git; an untracked
 *                           one that was overwritten cannot. A calendar event
 *                           can be deleted, but the invitation was already seen.
 *   IRREVERSIBLE          — nothing puts it back. Money spent at a third party.
 */
export type Reversibility = "REVERSIBLE" | "PARTIALLY_REVERSIBLE" | "IRREVERSIBLE";

export const REVERSIBILITIES: readonly Reversibility[] = deepFreeze([
  "REVERSIBLE",
  "PARTIALLY_REVERSIBLE",
  "IRREVERSIBLE",
] as const);

export interface ActionClassification {
  effect: Effect;
  reversibility: Reversibility;
  /**
   * The operation costs the user real money, whatever its effect class.
   *
   * Held separately from `effect: "FINANCIAL"` so that an ACT or WRITE which
   * merely bills as a side effect still carries the fact. Never inferred: it is
   * set by hand per action and can only ever make the policy decision stricter.
   */
  financial: boolean;
  /**
   * The action's OUTPUT contains material VOX did not author — web pages, a
   * third party's calendar entries, anything a stranger can write.
   *
   * RECORDED ONLY IN THIS PHASE. Finding C-1 (research output reaching
   * `workspace.write` with no boundary between them) is real, and this flag is
   * the hook a future taint boundary needs. It deliberately plays NO part in the
   * policy decision below — implementing propagation is P4, and a half-built
   * taint rule that silently holds some paths and not others would be worse
   * than the honest absence of one.
   */
  untrustedOutput: boolean;
}

/**
 * What an unclassified action is treated as.
 *
 * Conservative, but recoverable. An action nobody classified is assumed to
 * write, to be only partially undoable, and to be non-financial — which the
 * matrix turns into HOLD. HOLD means "a person must look at this", so a newly
 * added tool that nobody remembered to classify demands attention at P4 instead
 * of either running unexamined or becoming permanently unusable. DENY would be
 * the stricter default and the wrong one: it would make forgetting a table entry
 * indistinguishable from a deliberate prohibition.
 */
export const UNKNOWN_ACTION: ActionClassification = deepFreeze({
  effect: "WRITE",
  reversibility: "PARTIALLY_REVERSIBLE",
  financial: false,
  untrustedOutput: false,
});

/**
 * Every tool in src/lib/tools/registry.ts, classified.
 *
 * Keyed by `ToolDefinition.name`. The executor is the single site in VOX that
 * calls `tool.execute()`, so this table plus that one call site is complete
 * coverage of tool execution.
 */
export const TOOL_CLASSIFICATIONS: Readonly<Record<string, ActionClassification>> = deepFreeze({
  // --- VOX's own memory and domain rows. Everything here is a row VOX created
  // and can delete again. ---
  "memory.search": { effect: "READ", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
  "memory.create": { effect: "WRITE", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
  "task.create": { effect: "WRITE", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
  "project.create": { effect: "WRITE", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
  "idea.create": { effect: "WRITE", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
  "decision.create": { effect: "WRITE", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
  "connection.suggest": { effect: "WRITE", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
  "lab.create_requirement": { effect: "WRITE", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
  "lab.create_question": { effect: "WRITE", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
  "lab.attach_artifact": { effect: "WRITE", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },

  // WRITE, not READ. Corrected after the P1/P2 audit, which traced what
  // `runResearch()` (src/lib/research/service.ts) actually does: a network
  // request to the open web, N `ResearchItem` rows in a transaction, an Event,
  // and `recordResearchExperience()` — which creates a durable Memory and
  // knowledge-graph nodes and edges. "Observes; changes nothing" was wrong
  // about a call that adds to what VOX knows.
  //
  // That the written state feeds back into planning is what makes the
  // misclassification consequential rather than cosmetic:
  // `buildPlanningContext()` reads these rows and renders them into the
  // planner's prompt, so untrusted web text reaches the model that authors
  // subsequent tool arguments. This entry now HOLDs instead of ALLOWing.
  //
  // PARTIALLY_REVERSIBLE, not REVERSIBLE: the rows and graph edges can be
  // deleted, but anything that already read them has already been influenced.
  "research.run": {
    effect: "WRITE",
    reversibility: "PARTIALLY_REVERSIBLE",
    financial: false,
    untrustedOutput: true,
  },

  // --- Money. ---
  //
  // WHAT THIS OPERATION ACTUALLY IS. Traced end to end after the audit:
  // `economic.record_expense` -> `recordOpportunitySpend()` ->
  // `recordPolicySpend()` -> ONE SQL INSERT into `EconomicExpense`. There is no
  // payment processor, no bank, no card, no transfer, and no external
  // money-movement integration anywhere in VOX. So this is an ACCOUNTING
  // MUTATION representing money moving elsewhere — NOT an external spend.
  //
  // It is not merely bookkeeping either, and that is why it stays FINANCIAL.
  // The row consumes the user's autonomous spend ceiling, a finite budget that
  // does not replenish and that only a human can raise. Recording an expense
  // is how VOX uses up the authority a human granted it.
  //
  // IRREVERSIBLE, corrected from PARTIALLY_REVERSIBLE. The previous entry
  // claimed the row "can be corrected by a compensating entry". No such
  // mechanism exists: `db.economicExpense.create` is the only expense operation
  // in the entire repository — there is no delete, no update, and `toCents()`
  // rejects negative amounts outright. The ledger is append-only, so a
  // recorded expense cannot be undone by any code path that exists.
  //
  // Under the matrix this now evaluates to DENY, and DENY is currently a
  // SHADOW decision that stops nothing (P2 executes every decision). Before P4
  // turns decisions into enforcement, the semantics of this cell need a
  // deliberate answer — see POLICY_GATE.md, "The open question at
  // FINANCIAL + IRREVERSIBLE". The classification here states the fact; it does
  // not presume the policy.
  "economic.record_expense": {
    effect: "FINANCIAL",
    reversibility: "IRREVERSIBLE",
    financial: true,
    untrustedOutput: false,
  },

  // --- Someone else's systems. ---
  "calendar.list_events": { effect: "READ", reversibility: "REVERSIBLE", financial: false, untrustedOutput: true },
  // The event can be deleted; the invitation has already been delivered.
  "calendar.create_event": {
    effect: "ACT",
    reversibility: "PARTIALLY_REVERSIBLE",
    financial: false,
    untrustedOutput: false,
  },

  // --- Metered providers. ACT rather than FINANCIAL (the purpose is the media),
  // financial: true because the charge is real, IRREVERSIBLE because a provider
  // call cannot be un-spent. ---
  "media.image.generate": { effect: "ACT", reversibility: "IRREVERSIBLE", financial: true, untrustedOutput: false },
  "media.video.generate": { effect: "ACT", reversibility: "IRREVERSIBLE", financial: true, untrustedOutput: false },
  "media.image.refine": { effect: "ACT", reversibility: "IRREVERSIBLE", financial: true, untrustedOutput: false },
  // Judges rather than produces, so ANALYZE — but it calls a metered provider,
  // which is precisely the case the separate financial flag exists to catch.
  "qa.visual_review": { effect: "ANALYZE", reversibility: "REVERSIBLE", financial: true, untrustedOutput: false },
  // Writes an approval on an artifact VOX owns, having paid to compare candidates.
  "artifact.select_best": { effect: "WRITE", reversibility: "REVERSIBLE", financial: true, untrustedOutput: false },

  // --- The workspace: VOX's own source tree. ---
  "workspace.list": { effect: "READ", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
  "workspace.structure": { effect: "READ", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
  "workspace.read": { effect: "READ", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
  "workspace.search": { effect: "READ", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
  "workspace.git_status": { effect: "ANALYZE", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
  // PARTIALLY_REVERSIBLE, not REVERSIBLE: git restores a tracked file, and
  // restores nothing at all for a file that was never committed.
  "workspace.write": {
    effect: "WRITE",
    reversibility: "PARTIALLY_REVERSIBLE",
    financial: false,
    untrustedOutput: false,
  },
  "workspace.patch": {
    effect: "WRITE",
    reversibility: "PARTIALLY_REVERSIBLE",
    financial: false,
    untrustedOutput: false,
  },
  // Finding H-1 lives here: this runs the repository's own typecheck, lint,
  // tests and build, which is code execution, at ANALYZE. Classified honestly
  // as ANALYZE/REVERSIBLE — it changes nothing — and left as-is. Constraining
  // what it composes with is P4's job, not a classification's.
  "workspace.validate": { effect: "ANALYZE", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
});

/**
 * The proposal engine's closed action registry
 * (src/lib/cognition/proposals.ts#ACTION_HANDLERS), classified.
 *
 * Kept as a separate table because it is a separate execution authority with a
 * separate key space — `actionType`, not tool name. Merging the two would
 * suggest a unification that has not happened; see finding H-4.
 *
 * Every handler is internal-only by construction: each one calls a VOX service
 * function that writes a VOX row. None reaches a third party, none spends.
 */
export const PROPOSAL_ACTION_CLASSIFICATIONS: Readonly<Record<string, ActionClassification>> = deepFreeze({
  "memory.create_relation": { effect: "WRITE", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
  "task.create": { effect: "WRITE", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
  "knowledge.create_connection": {
    effect: "WRITE",
    reversibility: "REVERSIBLE",
    financial: false,
    untrustedOutput: false,
  },
  // Moves a Connections Hub row to AWAITING_APPROVAL. Grants nothing, connects
  // to nothing — the access grant is a separate, explicit human step.
  "connection.propose": { effect: "WRITE", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
  "lab.create_experiment": { effect: "WRITE", reversibility: "REVERSIBLE", financial: false, untrustedOutput: false },
});

/**
 * Actions that cannot be performed without looking at an image.
 *
 * A property of the tool, not of the request: `qa.visual_review` judges a
 * picture whatever it was asked about. Kept as an explicit set rather than
 * derived from the effect classification, because "changes an image" and
 * "must see an image" are different facts — `media.image.generate` produces one
 * without needing to look at anything.
 */
const VISION_REQUIRING_TOOLS: ReadonlySet<string> = Object.freeze(new Set([
  "qa.visual_review",
  "artifact.select_best",
  "media.image.refine",
]));

/** Which registry an action id belongs to. */
export type ActionRegistry = "tool" | "proposal";

export interface ClassificationLookup {
  classification: ActionClassification;
  /**
   * False when the id was not in the table and {@link UNKNOWN_ACTION} was
   * substituted. Recorded on the event so an unclassified action is visible as
   * a gap rather than indistinguishable from a deliberate WRITE.
   */
  known: boolean;
}

/**
 * Looks up an action's classification, substituting the conservative default
 * when there is none.
 *
 * Total: every input produces a result. A missing entry, an empty string and a
 * non-string all yield UNKNOWN_ACTION with `known: false`, because the gate that
 * calls this must never be the reason execution stopped (see gate.ts).
 */
export function classifyAction(registry: ActionRegistry, actionId: unknown): ClassificationLookup {
  const table = registry === "proposal" ? PROPOSAL_ACTION_CLASSIFICATIONS : TOOL_CLASSIFICATIONS;
  if (typeof actionId !== "string" || actionId.length === 0) {
    return { classification: UNKNOWN_ACTION, known: false };
  }
  // Own-property check: a key like "constructor" must not resolve to something
  // off Object.prototype and be reported as a known classification.
  const found = Object.prototype.hasOwnProperty.call(table, actionId) ? table[actionId] : undefined;
  return found ? { classification: found, known: true } : { classification: UNKNOWN_ACTION, known: false };
}

/**
 * The task profile for an action, derived from its own classification.
 *
 * Deterministic and structural — same action id in, same profile out, with no
 * model consulted and no request text read. This is what P5/P6 will route on;
 * in this phase it is recorded so that when provider selection arrives there is
 * already a history of what VOX has actually been asked to do.
 */
export function classifyTask(registry: ActionRegistry, actionId: unknown): TaskClassification {
  const { classification } = classifyAction(registry, actionId);

  // Anything reaching outside VOX or touching money is treated as PRIVATE at
  // minimum; the workspace and the ledger are the user's own material.
  const sensitivity: Sensitivity =
    classification.effect === "FINANCIAL" || classification.financial
      ? "SENSITIVE"
      : classification.effect === "ACT" || classification.effect === "WRITE"
        ? "PRIVATE"
        : "INTERNAL";

  // Only an action that goes and looks at the world needs current information.
  const freshness: Freshness = classification.untrustedOutput ? "REALTIME" : "STATIC";

  const reasoningDepth: ReasoningDepth =
    classification.reversibility === "IRREVERSIBLE" || classification.financial
      ? "HIGH"
      : classification.effect === "READ"
        ? "LOW"
        : "MEDIUM";

  return {
    sensitivity,
    freshness,
    // Every classified action IS a tool or handler call.
    needsTools: true,
    // Both registries return structured output that a caller parses.
    needsStructuredOutput: true,
    needsVision: registry === "tool" && typeof actionId === "string" && VISION_REQUIRING_TOOLS.has(actionId),
    reasoningDepth,
    latencyBudget: classification.financial ? "EXTENDED" : "STANDARD",
    costBudget: classification.financial ? "MODERATE" : "FREE",
  };
}
