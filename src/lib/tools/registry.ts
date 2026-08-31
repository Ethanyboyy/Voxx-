import { z } from "zod";
import { createMemory, getSemanticMemories } from "@/lib/memory/service";
import { createProject, createTask, createIdea, createDecision } from "@/lib/projects/service";
import { runResearch } from "@/lib/research/service";
import { proposeConnection } from "@/lib/connections/service";
import { getCatalogEntry } from "@/lib/integrations/catalog";
import { getConnectionProvider } from "@/lib/integrations/stub";
import { createRequirement, nextRequirementCode } from "@/lib/lab/requirements";
import { createQuestion } from "@/lib/lab/questions";
import { recordOpportunitySpend } from "@/lib/economic/service";
import { evaluateSpendPolicy } from "@/lib/economic/policy";
import { recordEvent } from "@/lib/observability/events";
import {
  listDirectory,
  patchWorkspaceFile,
  projectStructure,
  readWorkspaceFile,
  searchWorkspace,
  writeWorkspaceFile,
} from "@/lib/workspace/fs";
import { gitStatus, runValidation, VALIDATION_NAMES, type ValidationName } from "@/lib/workspace/validate";
import { generateImage, submitVideo, reviewArtifact } from "@/lib/capabilities/execute";
import { selectBestVersion, attachArtifactToSubject } from "@/lib/capabilities/select";
import { refineUntilAcceptable } from "@/lib/capabilities/refine";
import { LAB_SUBJECT_TYPES } from "@/lib/lab/artifacts";
import type { ToolDefinition } from "@/lib/tools/types";

/**
 * The general Tool Registry — a discoverable counterpart to the Proposal
 * engine's closed ACTION_HANDLERS map (src/lib/cognition/proposals.ts).
 * Every tool wraps an *existing* service function (never duplicates logic)
 * and is gated by the same enforceCapability() used everywhere in VOX — the
 * executor (src/lib/agents/executor.ts) is the only caller, and it checks
 * capability before every single tool.execute(), no exceptions.
 *
 * Real external tools (calendar.*) resolve through the exact same
 * StubConnectionProvider used by the Connections Hub — they report a clear
 * "not configured" error rather than faking a result, until real vendor
 * credentials exist. This is the "build the architecture, not a fake
 * connection" instruction from the Phase 3/4 directive, applied at the tool
 * layer instead of just the Connections Hub layer.
 */
const REGISTRY: Record<string, ToolDefinition<never>> = {};

function register<TInput>(tool: ToolDefinition<TInput>) {
  REGISTRY[tool.name] = tool as unknown as ToolDefinition<never>;
}

register({
  name: "memory.search",
  description: "Search VOX's memory of the user by meaning (semantic similarity), returning the most relevant memories.",
  category: "memory",
  capability: "memory.read",
  requiredLevel: "OBSERVE",
  inputSchema: z.object({ query: z.string().min(1).max(2000), limit: z.number().int().min(1).max(20).optional() }),
  execute: async (userId, input) => {
    const results = await getSemanticMemories(userId, input.query, input.limit ?? 8);
    return {
      output: results.map((m) => ({ id: m.id, content: m.content, category: m.category, confidence: m.confidence })),
      summary: `Found ${results.length} relevant ${results.length === 1 ? "memory" : "memories"}.`,
    };
  },
});

register({
  name: "memory.create",
  description: "Record a new memory about the user.",
  category: "memory",
  capability: "memory.write",
  requiredLevel: "ANALYZE",
  inputSchema: z.object({
    content: z.string().min(1).max(10_000),
    category: z.enum(["FACT", "PREFERENCE", "GOAL", "PROJECT", "EXPERIENCE", "IDEA", "OBSERVATION", "HYPOTHESIS", "INFERENCE", "TEMPORARY_CONTEXT"]),
    confidence: z.enum(["LOW", "MEDIUM", "HIGH", "CONFIRMED"]).optional(),
  }),
  execute: async (userId, input) => {
    const memory = await createMemory({ userId, content: input.content, category: input.category, confidence: input.confidence });
    return { output: { id: memory.id }, summary: `Remembered: "${input.content.slice(0, 80)}${input.content.length > 80 ? "..." : ""}"` };
  },
});

register({
  name: "task.create",
  description: "Create a task, optionally attached to a project.",
  category: "project",
  capability: "project.write",
  requiredLevel: "RECOMMEND",
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    projectId: z.string().optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH"]).optional(),
  }),
  execute: async (userId, input) => {
    const task = await createTask({ userId, title: input.title, description: input.description, projectId: input.projectId, priority: input.priority });
    return { output: { id: task.id }, summary: `Created task "${task.title}".` };
  },
});

register({
  name: "project.create",
  description: "Create a new project.",
  category: "project",
  capability: "project.write",
  requiredLevel: "RECOMMEND",
  inputSchema: z.object({ name: z.string().min(1).max(200), description: z.string().max(5000).optional() }),
  execute: async (userId, input) => {
    const project = await createProject({ userId, name: input.name, description: input.description });
    return { output: { id: project.id }, summary: `Created project "${project.name}".` };
  },
});

register({
  name: "idea.create",
  description: "Capture an idea, optionally attached to a project.",
  category: "project",
  capability: "project.write",
  requiredLevel: "RECOMMEND",
  inputSchema: z.object({ title: z.string().min(1).max(200), description: z.string().max(5000).optional(), projectId: z.string().optional() }),
  execute: async (userId, input) => {
    const idea = await createIdea({ userId, title: input.title, description: input.description, projectId: input.projectId });
    return { output: { id: idea.id }, summary: `Captured idea "${idea.title}".` };
  },
});

register({
  name: "decision.create",
  description: "Record a decision and the reasoning behind it, optionally attached to a project.",
  category: "project",
  capability: "project.write",
  requiredLevel: "RECOMMEND",
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    chosenOption: z.string().max(500).optional(),
    projectId: z.string().optional(),
  }),
  execute: async (userId, input) => {
    const decision = await createDecision({ userId, title: input.title, description: input.description, chosenOption: input.chosenOption, projectId: input.projectId, status: input.chosenOption ? "DECIDED" : "PENDING" });
    return { output: { id: decision.id }, summary: `Recorded decision "${decision.title}".` };
  },
});

register({
  name: "research.run",
  description: "Run a web research query and return grounded results with sources.",
  category: "research",
  capability: "research.web",
  requiredLevel: "ANALYZE",
  inputSchema: z.object({ query: z.string().min(1).max(500) }),
  execute: async (userId, input, context) => {
    // A supervised run researching in pursuit of an objective keeps that
    // objective on the findings, so the next planning pass for the same goal
    // retrieves them as its own evidence rather than as recent noise.
    const items = await runResearch(userId, input.query, { objectiveId: context?.objectiveId });
    return {
      output: items.map((i) => ({ title: i.title, sourceUrl: i.sourceUrl, summary: i.summary })),
      summary: `Found ${items.length} research ${items.length === 1 ? "result" : "results"} for "${input.query}".`,
    };
  },
});

register({
  name: "connection.suggest",
  description: "Suggest connecting an external service to VOX (never connects it directly — always requires the user's explicit approval).",
  category: "connection",
  capability: "connection.suggest",
  requiredLevel: "RECOMMEND",
  inputSchema: z.object({
    service: z.enum(["GOOGLE_CALENDAR", "GOOGLE_GMAIL", "NOTION", "TODOIST", "CRAFT", "QUICKBOOKS", "PLAID", "APPLE_HEALTH", "GOOGLE_FIT", "GOOGLE_MAPS", "AMAZON_ORDERS", "ETSY", "PRINTFUL", "PRINTIFY"]),
    reason: z.string().max(2000).optional(),
  }),
  execute: async (userId, input) => {
    const connection = await proposeConnection(userId, input.service, input.reason);
    return { output: { service: input.service, status: connection.status }, summary: `Suggested connecting ${connection.displayName} in the Connections Hub.` };
  },
});

register({
  name: "lab.create_requirement",
  description: "Record an engineering requirement in the Spider-Man Laboratory, optionally attached to a suit.",
  category: "project",
  capability: "lab.write",
  requiredLevel: "RECOMMEND",
  inputSchema: z.object({
    title: z.string().min(1).max(200),
    description: z.string().max(5000).optional(),
    suitId: z.string().optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  }),
  execute: async (userId, input) => {
    const code = await nextRequirementCode(userId);
    const requirement = await createRequirement({
      userId,
      suitId: input.suitId,
      code,
      title: input.title,
      description: input.description,
      priority: input.priority,
    });
    return { output: { id: requirement.id, code: requirement.code }, summary: `Recorded requirement ${requirement.code}: "${requirement.title}".` };
  },
});

register({
  name: "lab.create_question",
  description: "Record an open engineering question in the Spider-Man Laboratory, optionally attached to a suit.",
  category: "project",
  capability: "lab.write",
  requiredLevel: "RECOMMEND",
  inputSchema: z.object({
    question: z.string().min(1).max(2000),
    suitId: z.string().optional(),
    importance: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
    currentHypothesis: z.string().max(2000).optional(),
  }),
  execute: async (userId, input) => {
    const question = await createQuestion({
      userId,
      suitId: input.suitId,
      question: input.question,
      importance: input.importance,
      currentHypothesis: input.currentHypothesis,
    });
    return { output: { id: question.id }, summary: `Recorded engineering question: "${question.question.slice(0, 80)}${question.question.length > 80 ? "..." : ""}"` };
  },
});

register({
  name: "economic.record_expense",
  description:
    "Record a real spend against an opportunity's economic ledger. Gated by the economic.spend capability at ACT level AND the user's own autonomous-spend ceiling — a granted capability alone is never sufficient to spend.",
  category: "external",
  capability: "economic.spend",
  requiredLevel: "ACT",
  isExternal: false,
  inputSchema: z.object({
    opportunityId: z.string().min(1),
    amountUsd: z.number().min(0.01).max(1_000_000),
    category: z.string().max(80).optional(),
    notes: z.string().max(2000).optional(),
  }),
  execute: async (userId, input) => {
    // Second, independent gate: even with economic.spend granted at ACT,
    // an amount above the user's configured autonomous ceiling is refused
    // here rather than executed — see src/lib/economic/policy.ts.
    const decision = await evaluateSpendPolicy(userId, input.amountUsd);
    if (!decision.allowed) {
      throw new Error(decision.reason);
    }
    const expense = await recordOpportunitySpend(userId, {
      opportunityId: input.opportunityId,
      amountUsd: input.amountUsd,
      category: input.category,
      notes: input.notes,
    });
    return {
      output: { id: expense.id, amountUsd: expense.amountUsd },
      summary: `Recorded a $${expense.amountUsd.toFixed(2)} expense (within the $${decision.thresholdUsd.toFixed(2)} autonomous limit).`,
    };
  },
});

// --- External tools: real architecture, stubbed execution until real vendor
// credentials exist (see src/lib/integrations/stub.ts). Never fake a result.

function requireConfiguredCalendar() {
  const entry = getCatalogEntry("GOOGLE_CALENDAR");
  const provider = getConnectionProvider("GOOGLE_CALENDAR");
  if (!provider.isConfigured) {
    throw new Error(
      `${entry?.displayName ?? "Google Calendar"} is not connected yet. Approve it in the Connections Hub and grant read/write access once real credentials are configured.`
    );
  }
  return provider;
}

register({
  name: "calendar.list_events",
  description: "List upcoming events from the user's connected Google Calendar.",
  category: "external",
  capability: "integration.google_calendar.read",
  requiredLevel: "RECOMMEND",
  isExternal: true,
  inputSchema: z.object({ rangeDays: z.number().int().min(1).max(30).optional() }),
  execute: async (_userId, _input) => {
    requireConfiguredCalendar();
    // Unreachable until a real Google OAuth client exists — the provider
    // guarantees isConfigured stays false until then (see stub.ts).
    throw new Error("Google Calendar integration is not implemented yet — no real OAuth client is registered.");
  },
});

register({
  name: "calendar.create_event",
  description: "Create an event on the user's connected Google Calendar.",
  category: "external",
  capability: "integration.google_calendar.write",
  requiredLevel: "ACT",
  isExternal: true,
  inputSchema: z.object({ title: z.string().min(1).max(200), startsAt: z.string(), endsAt: z.string() }),
  execute: async (_userId, _input) => {
    requireConfiguredCalendar();
    throw new Error("Google Calendar integration is not implemented yet — no real OAuth client is registered.");
  },
});

// --- Capability tools: image, video and review ------------------------------
//
// PERMISSION MAPPING, continued. Media generation sits at ACT because every
// call SPENDS MONEY at a third party and sends user content to it. That is the
// level VOX already reserves for actions with an external effect, and it means
// a provider key alone is not enough — the user must also grant the capability,
// which is two independent gates on the same decision.
//
// Visual QA sits at RECOMMEND. It was written at ANALYZE on the reasoning that
// it only spends tokens and returns a judgement rather than an artifact — but
// that weighs the WRONG THING. ANALYZE is granted by default, and reviewing an
// image means uploading the user's picture to a third-party API. Category
// "external" is the declaration that a tool sends data out of VOX, and the
// registry's standing rule is that no external tool is default-allowed; QA is
// external by that definition however cheap it is. So it needs a grant, one
// step below the media tools that also spend money.

register({
  name: "media.image.generate",
  description:
    "Generate or edit an image and store it as an artifact version. Supplying reference version ids makes it an edit conditioned on them, and records the lineage.",
  category: "external",
  capability: "media.image.generate",
  requiredLevel: "ACT",
  isExternal: true,
  inputSchema: z.object({
    prompt: z.string().min(1).max(4000),
    label: z.string().max(120).optional(),
    artifactId: z.string().max(64).optional(),
    subjectType: z.string().max(60).optional(),
    subjectId: z.string().max(64).optional(),
    referenceVersionIds: z.array(z.string().max(64)).max(8).optional(),
    count: z.number().int().min(1).max(8).optional(),
    traceId: z.string().max(64).optional(),
  }),
  execute: async (userId, input) => {
    const result = await generateImage({ userId, ...input });
    return {
      output: result,
      summary: `Generated ${result.versions.length} image(s) via ${result.provider} (${result.model}).`,
    };
  },
});

register({
  name: "media.video.generate",
  description:
    "Submit a cinematic video job from a prompt and optional reference frames. Returns the job; video generation is asynchronous.",
  category: "external",
  capability: "media.video.generate",
  requiredLevel: "ACT",
  isExternal: true,
  inputSchema: z.object({
    prompt: z.string().min(1).max(4000),
    label: z.string().max(120).optional(),
    subjectType: z.string().max(60).optional(),
    subjectId: z.string().max(64).optional(),
    referenceVersionIds: z.array(z.string().max(64)).max(8).optional(),
    durationSeconds: z.number().min(1).max(60).optional(),
    cameraMotion: z.string().max(200).optional(),
    traceId: z.string().max(64).optional(),
  }),
  execute: async (userId, input) => {
    const result = await submitVideo({ userId, ...input });
    return {
      output: { providerJobId: result.job.providerJobId, status: result.job.status, capabilityRunId: result.capabilityRunId },
      summary: `Submitted a cinematic job (${result.job.status}).`,
    };
  },
});

register({
  name: "qa.visual_review",
  description:
    "Judge a stored artifact version against the requirements and any reference images. Returns a structured PASS/FAIL with typed issues.",
  category: "external",
  capability: "qa.visual_review",
  requiredLevel: "RECOMMEND",
  isExternal: true,
  inputSchema: z.object({
    requirements: z.string().min(1).max(4000),
    candidateVersionId: z.string().min(1).max(64),
    referenceVersionIds: z.array(z.string().max(64)).max(8).optional(),
    criteria: z.string().max(60).optional(),
    traceId: z.string().max(64).optional(),
  }),
  execute: async (userId, input) => {
    const result = await reviewArtifact({ userId, ...input });
    return {
      // Only the verdict shape — never the reviewer's prose.
      output: { status: result.status, score: result.score, issues: result.issues, recommendations: result.recommendations },
      summary: `Review ${result.status} (${result.score}/100) with ${result.issues.length} issue(s).`,
    };
  },
});

// Selection and attachment both APPROVE a version, and approval is what the
// Lab reads to decide what the Suit Bay renders. That makes them changes to
// what the user sees, not analyses of it — hence ACT, the level VOX already
// reserves for actions that change something. They are `external` because
// selection calls the vision provider to compare candidates.

register({
  name: "artifact.select_best",
  description:
    "Compare every version of an artifact against the requirements and approve the strongest. Returns each candidate's score, not just the winner.",
  category: "external",
  capability: "artifact.select",
  requiredLevel: "ACT",
  isExternal: true,
  inputSchema: z.object({
    artifactId: z.string().min(1).max(64),
    requirements: z.string().min(1).max(4000),
    versionIds: z.array(z.string().max(64)).max(8).optional(),
    referenceVersionIds: z.array(z.string().max(64)).max(8).optional(),
    traceId: z.string().max(64).optional(),
  }),
  execute: async (userId, input) => {
    const result = await selectBestVersion({ userId, ...input });
    return {
      output: {
        artifactId: result.artifactId,
        selectedVersionId: result.selected?.versionId ?? null,
        selectedVersion: result.selected?.version ?? null,
        candidates: result.candidates,
      },
      summary: result.reason,
    };
  },
});

register({
  name: "media.image.refine",
  description:
    "Generate, review and revise an image until it clears the bar or the iteration limit is reached. Each attempt is judged and the next one receives structured revision instructions. Bounded — never an open-ended loop.",
  category: "external",
  capability: "media.image.generate",
  requiredLevel: "ACT",
  isExternal: true,
  inputSchema: z.object({
    requirements: z.string().min(1).max(4000),
    prompt: z.string().max(4000).optional(),
    artifactId: z.string().max(64).optional(),
    label: z.string().max(120).optional(),
    subjectType: z.string().max(60).optional(),
    subjectId: z.string().max(64).optional(),
    referenceVersionIds: z.array(z.string().max(64)).max(8).optional(),
    // Bounded at the schema, not only in code: an input that could ask for a
    // hundred attempts is a spend problem even if the loop would refuse it.
    maxIterations: z.number().int().min(1).max(5).optional(),
    minImprovement: z.number().min(0).max(100).optional(),
    traceId: z.string().max(64).optional(),
  }),
  execute: async (userId, input) => {
    const result = await refineUntilAcceptable({ userId, ...input });
    return {
      output: {
        artifactId: result.artifactId,
        selectedVersionId: result.best?.versionId ?? null,
        selectedVersion: result.best?.version ?? null,
        finalScore: result.best?.qa?.score ?? null,
        stoppedBecause: result.stoppedBecause,
        attempts: result.attempts.map((a) => ({
          attempt: a.attempt,
          version: a.version,
          status: a.qa?.status ?? null,
          score: a.qa?.score ?? null,
          decision: a.decision,
        })),
      },
      summary: `${result.attempts.length} attempt(s), ${result.generations} generation(s): ${result.reason}`,
    };
  },
});

register({
  name: "lab.attach_artifact",
  description:
    "Attach an artifact to a Lab subject (suit, gadget, project, experiment) and approve its current version, so the Lab surfaces it.",
  category: "project",
  capability: "lab.write",
  requiredLevel: "ACT",
  inputSchema: z.object({
    artifactId: z.string().min(1).max(64),
    // A closed set, not a free string: the subject type decides which Lab
    // surface renders the artifact, and an arbitrary value would attach it
    // to nothing while reporting success.
    subjectType: z.enum(LAB_SUBJECT_TYPES),
    subjectId: z.string().min(1).max(64),
    traceId: z.string().max(64).optional(),
  }),
  execute: async (userId, input) => {
    const result = await attachArtifactToSubject({ userId, ...input });
    return {
      output: result,
      summary: `Attached to ${input.subjectType} and approved as version ${result.version}.`,
    };
  },
});

// --- Workspace tools: the execution agent's hands ---------------------------
//
// These are what turn "fix the Suit Bay" from an objective the planner cannot
// express into one it can plan real steps for. They wrap src/lib/workspace/,
// which owns containment and the closed validation set.
//
// PERMISSION MAPPING (the brief's Phase 15, and the reason no second
// hierarchy was created). Every tool below sits on the EXISTING
// OBSERVE < ANALYZE < RECOMMEND < ASK < ACT ladder:
//
//   workspace.read     OBSERVE   Reading project source. Granted by default,
//                                because inspecting the code it is working on
//                                is the least an engineering agent can do, and
//                                secrets are excluded at the path layer rather
//                                than by withholding the capability.
//   workspace.inspect  ANALYZE   Git state. A notch higher because it reveals
//                                what is uncommitted, which is a different
//                                kind of information from the code itself.
//   workspace.validate ANALYZE   Running the project's own checks. Changes
//                                nothing; spends CPU. Granted by default so an
//                                agent can verify its own work without an
//                                approval round-trip for every test run.
//   workspace.write    ACT       Editing files. NOT granted by default. This
//                                is the consequential one, and ACT is exactly
//                                the level VOX already reserves for actions
//                                that change something.
//
// There is deliberately no "run a command" tool at any level — see
// src/lib/workspace/validate.ts for why that is a security boundary rather
// than a permission question.

register({
  name: "workspace.list",
  description: "List the files and directories at a path in the project, one level deep.",
  category: "workspace",
  capability: "workspace.read",
  requiredLevel: "OBSERVE",
  inputSchema: z.object({ path: z.string().min(1).max(400).default(".") }),
  execute: async (_userId, input) => {
    const entries = await listDirectory(input.path);
    return {
      output: entries,
      summary: `${entries.length} entr${entries.length === 1 ? "y" : "ies"} in ${input.path}.`,
    };
  },
});

register({
  name: "workspace.structure",
  description: "Get a bounded overview of the project's directory structure — where things live.",
  category: "workspace",
  capability: "workspace.read",
  requiredLevel: "OBSERVE",
  inputSchema: z.object({ maxDepth: z.number().int().min(1).max(4).optional() }),
  execute: async (_userId, input) => {
    const structure = await projectStructure(input.maxDepth ?? 2);
    return { output: structure, summary: `Mapped ${structure.length} top-level entries.` };
  },
});

register({
  name: "workspace.read",
  description: "Read a text file from the project. Long files are truncated, and the result says so.",
  category: "workspace",
  capability: "workspace.read",
  requiredLevel: "OBSERVE",
  inputSchema: z.object({ path: z.string().min(1).max(400) }),
  execute: async (_userId, input) => {
    const result = await readWorkspaceFile(input.path);
    return {
      output: result,
      summary: `Read ${result.path} (${result.bytes} bytes${result.truncated ? ", truncated" : ""}).`,
    };
  },
});

register({
  name: "workspace.search",
  description: "Search project file contents by regular expression, optionally filtered by a glob.",
  category: "workspace",
  capability: "workspace.read",
  requiredLevel: "OBSERVE",
  inputSchema: z.object({
    pattern: z.string().min(1).max(500),
    directory: z.string().max(400).optional(),
    glob: z.string().max(200).optional(),
  }),
  execute: async (_userId, input) => {
    const matches = await searchWorkspace(input.pattern, { directory: input.directory, glob: input.glob });
    const files = new Set(matches.map((m) => m.path));
    return {
      output: matches,
      summary: `${matches.length} match${matches.length === 1 ? "" : "es"} across ${files.size} file(s).`,
    };
  },
});

register({
  name: "workspace.git_status",
  description: "Show the current branch, which files are modified, and a diff summary.",
  category: "workspace",
  capability: "workspace.inspect",
  requiredLevel: "ANALYZE",
  inputSchema: z.object({}),
  execute: async () => {
    const status = await gitStatus();
    return {
      output: status,
      summary: `On ${status.branch} with ${status.changed.length} changed file(s).`,
    };
  },
});

register({
  name: "workspace.write",
  description: "Write a file in the project, creating it and any parent directories if needed.",
  category: "workspace",
  capability: "workspace.write",
  requiredLevel: "ACT",
  inputSchema: z.object({ path: z.string().min(1).max(400), content: z.string().max(2_000_000) }),
  execute: async (userId, input) => {
    const result = await writeWorkspaceFile(input.path, input.content);
    await recordEvent({
      userId,
      type: "execution.file_changed",
      subjectType: "WorkspaceFile",
      subjectId: result.path,
      payload: { path: result.path, bytes: result.bytes, action: result.created ? "created" : "overwritten" },
      consequential: true,
    });
    return {
      output: result,
      summary: `${result.created ? "Created" : "Wrote"} ${result.path} (${result.bytes} bytes).`,
    };
  },
});

register({
  name: "workspace.patch",
  description:
    "Replace an exact string in a project file. Fails when the text is absent or ambiguous, so a stale view cannot corrupt the file.",
  category: "workspace",
  capability: "workspace.write",
  requiredLevel: "ACT",
  inputSchema: z.object({
    path: z.string().min(1).max(400),
    find: z.string().min(1).max(100_000),
    replace: z.string().max(100_000),
    replaceAll: z.boolean().optional(),
  }),
  execute: async (userId, input) => {
    const result = await patchWorkspaceFile(input.path, input.find, input.replace, { replaceAll: input.replaceAll });
    await recordEvent({
      userId,
      type: "execution.file_changed",
      subjectType: "WorkspaceFile",
      subjectId: result.path,
      payload: { path: result.path, replacements: result.replacements, action: "patched" },
      consequential: true,
    });
    return { output: result, summary: `Patched ${result.path} (${result.replacements} replacement(s)).` };
  },
});

register({
  name: "workspace.validate",
  description:
    "Run one of the project's own checks: typecheck, lint, test, or build. A failing check is a result, not an error.",
  category: "workspace",
  capability: "workspace.validate",
  requiredLevel: "ANALYZE",
  inputSchema: z.object({ check: z.enum(VALIDATION_NAMES as [string, ...string[]]) }),
  execute: async (userId, input) => {
    const name = input.check as ValidationName;
    await recordEvent({
      userId,
      type: "execution.validation_started",
      subjectType: "WorkspaceValidation",
      subjectId: name,
      payload: { check: name },
    });

    const result = await runValidation(name);

    await recordEvent({
      userId,
      // Distinct types rather than one event with a boolean, so the Brain's
      // activity feed and the signal map can treat a red check differently
      // from a green one without parsing payloads.
      type: result.passed ? "execution.validation_passed" : "execution.validation_failed",
      subjectType: "WorkspaceValidation",
      subjectId: name,
      payload: { check: name, durationMs: result.durationMs, exitCode: result.exitCode, timedOut: result.timedOut },
      consequential: !result.passed,
    });

    return {
      output: result,
      summary: result.passed
        ? `${result.label} passed in ${(result.durationMs / 1000).toFixed(1)}s.`
        : `${result.label} FAILED${result.timedOut ? " (timed out)" : ""} after ${(result.durationMs / 1000).toFixed(1)}s.`,
    };
  },
});

export function getTool(name: string): ToolDefinition<never> | undefined {
  return REGISTRY[name];
}

export function listTools(): ToolDefinition<never>[] {
  return Object.values(REGISTRY);
}
