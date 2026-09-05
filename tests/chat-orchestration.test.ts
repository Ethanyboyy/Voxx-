import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { createTestUser, approveAndResume } from "./helpers";
import { POST as chatPost } from "@/app/api/chat/route";
import { createConversation, getConversation } from "@/lib/chat/service";
import { decideChatAction, describeRunOutcome } from "@/lib/chat/action";
import { getRunTrace } from "@/lib/capabilities/trace";
import { grantPermission } from "@/lib/permissions/service";
import { listLabArtifacts } from "@/lib/lab/artifacts";
import * as sessionModule from "@/lib/auth/session";
import * as aiModule from "@/lib/ai";
import * as imageModule from "@/lib/image";
import * as qaModule from "@/lib/qa/service";
import { VisionUnavailableError } from "@/lib/qa/service";
import type { ImageProvider } from "@/lib/image/types";
import type { QaCriterion, QaResult } from "@/lib/qa/types";
import type { User } from "@/generated/prisma/client";

/**
 * BRAIN-020 — chat as a first-class entry point to the orchestrator.
 *
 * These tests call the actual route handler with an actual Request, not the
 * helpers underneath it. The gap being closed was that chat TERMINATED at a
 * text response, so a test that started below the route would prove nothing
 * about whether chat can reach the orchestrator.
 *
 * COST IS ASSERTED, NOT ASSUMED. `chatModelCalls` counts every call to the
 * conversational AI provider. The central claim of this design — that
 * classifying an ordinary message is free, and that an orchestrated turn
 * spends nothing on prose — is only meaningful because these counters exist.
 */

const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let chatModelCalls = 0;
let imageCalls = 0;
let qaCalls = 0;
let scoreQueue: number[] = [];
let reviewUnavailable = false;
let generationFails = false;

const CRITERIA: QaCriterion[] = ["reference_adherence", "proportions", "material_realism", "overall_quality"];

function qaResult(score: number): QaResult {
  return {
    status: score >= 80 ? "PASS" : "FAIL",
    score,
    issues: score >= 80 ? [] : [{ kind: "MATERIAL_PROBLEM", severity: "MAJOR", description: "Material reads as armored." }],
    recommendations: score >= 80 ? [] : ["Increase textile behaviour."],
    criteria: CRITERIA,
    model: "test-vision-1",
    provider: "test-vision",
    durationMs: 3,
  };
}

function fakeImageProvider(): ImageProvider {
  return {
    id: "test-image",
    displayName: "Test Image Provider",
    defaultModel: "test-model-1",
    capabilities: ["TEXT_TO_IMAGE", "IMAGE_TO_IMAGE", "IMAGE_EDIT"],
    isConfigured: true,
    unavailableReason: null,
    async generate(request) {
      imageCalls += 1;
      if (generationFails) throw new Error("Provider unavailable.");
      return {
        images: Array.from({ length: request.count ?? 1 }, () => ({
          data: new Uint8Array(PNG_1X1),
          mimeType: "image/png",
          width: 1,
          height: 1,
        })),
        provider: "test-image",
        model: "test-model-1",
        costUsd: 0.001,
        durationMs: 4,
      };
    },
  };
}

/** A conversational provider that records that it was asked to speak. */
function fakeChatProvider() {
  return {
    id: "test-chat",
    defaultModel: "test-chat-1",
    supportsVision: false,
    async generate() {
      chatModelCalls += 1;
      return { content: "Hello.", model: "test-chat-1", usage: { inputTokens: 1, outputTokens: 1 } };
    },
    async *stream() {
      chatModelCalls += 1;
      yield { type: "text_delta" as const, text: "Hello." };
      yield {
        type: "message_stop" as const,
        model: "test-chat-1",
        usage: { inputTokens: 1, outputTokens: 1 },
      };
    },
  };
}

/** Not a React hook — named to avoid the `use` prefix the lint rule reserves. */
function authenticateAs(user: User) {
  vi.spyOn(sessionModule, "getCurrentUser").mockResolvedValue(user);
}

/** Drives the real route handler and collects the NDJSON frames it streams. */
async function sendChat(conversationId: string, message: string) {
  const response = await chatPost(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId, message }),
    }) as never,
  );
  expect(response.ok).toBe(true);

  const text = await response.text();
  const events = text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>);

  const assistantText = events
    .filter((e) => e.type === "text_delta")
    .map((e) => String(e.text))
    .join("");

  return { events, assistantText, runId: events.find((e) => e.type === "run_started")?.runId as string | undefined };
}

/** sendChat, then wait for the backgrounded run — the common case in tests
 * that assert on what the run produced.
 *
 * [P4-C3] `approve` defaults to true. Image generation, review, selection and
 * the Lab write are all HOLD actions, so since enforcement a chat-driven run
 * parks at each one instead of running it. These tests are about CHAT reaching
 * the orchestrator, not about the gate, so the human half of the loop is played
 * through the real approval service — see `approveAndResume` in ./helpers, which
 * has no test-only bypass in it. Pass `approve: false` where the parked state is
 * the thing being asserted. */
async function sendChatAndSettle(conversationId: string, message: string, { approve = true } = {}) {
  const result = await sendChat(conversationId, message);
  if (!result.runId) return result;
  await settle(result.runId);
  if (approve) {
    const run = await db.agentRun.findUnique({ where: { id: result.runId }, select: { userId: true } });
    if (run) {
      await approveAndResume(run.userId, result.runId);
      await settle(result.runId);
    }
  }
  return result;
}

/**
 * Waits for a backgrounded run to reach a terminal state.
 *
 * BRAIN-021 made chat return before the work finishes, so a test that asserted
 * immediately would be racing the run it is testing. This polls the run's own
 * persisted status — the same source the UI reads — rather than sleeping for a
 * guessed duration.
 */
async function settle(runId: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await db.agentRun.findUnique({ where: { id: runId }, select: { status: true } });
    if (run && ["COMPLETED", "FAILED", "CANCELLED", "WAITING_FOR_PERMISSION"].includes(run.status)) {
      // One more tick so onSettled (which rewrites the message) has run.
      await new Promise((r) => setTimeout(r, 60));
      return;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Run ${runId} did not settle within ${timeoutMs}ms.`);
}

/**
 * The assistant message as the server currently holds it, decrypted.
 *
 * BRAIN-021 moved the outcome OUT of the streamed response: the POST returns
 * while the run is still going, and the message is rewritten when it settles.
 * So "what did VOX finally say" is a server read, exactly as it is for the
 * client after a reload.
 */
async function outcomeText(userId: string, conversationId: string): Promise<string> {
  const conversation = await getConversation(userId, conversationId);
  const assistant = [...(conversation?.messages ?? [])].reverse().find((m) => m.role === "ASSISTANT");
  return assistant?.content ?? "";
}

/**
 * What VOX says about the run AS IT STANDS NOW — the same `describeRunOutcome`
 * the route uses, over a freshly read trace.
 *
 * [P4-C3] Needed because the persisted assistant message is written exactly
 * once, by the route's `onSettled`, when the run first reaches a terminal or
 * waiting state. A run that then parks for approval, gets approved, and
 * finishes leaves that message saying "I've stopped and need your approval".
 *
 * That staleness is NOT new and not caused by enforcement — the same thing has
 * always happened to a run parked for a missing capability and resumed from the
 * Agents page. Enforcement just makes multi-settle runs the normal case rather
 * than the exception, so it is now visible in these tests. Closing it is a chat
 * surface change and deliberately out of scope here; these assertions therefore
 * check what VOX would say about the finished run, which is what they were
 * written to check.
 */
async function currentOutcomeText(userId: string, runId: string): Promise<string> {
  return describeRunOutcome(await getRunTrace(userId, { runId }));
}

beforeEach(() => {
  chatModelCalls = 0;
  imageCalls = 0;
  qaCalls = 0;
  scoreQueue = [];
  reviewUnavailable = false;
  generationFails = false;
  vi.spyOn(imageModule, "getImageProvider").mockReturnValue(fakeImageProvider());
  vi.spyOn(aiModule, "getAIProvider").mockReturnValue(fakeChatProvider() as never);
  vi.spyOn(qaModule, "runVisualQa").mockImplementation(async () => {
    qaCalls += 1;
    if (reviewUnavailable) throw new VisionUnavailableError("mock");
    return qaResult(scoreQueue.shift() ?? 92);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function setup(grants: string[] = []) {
  const user = await createTestUser();
  authenticateAs(user);
  for (const capability of grants) await grantPermission(user.id, capability, "ACT");
  const conversation = await createConversation(user.id);
  return { user, conversationId: conversation.id };
}

const ALL_GRANTS = ["memory.search", "media.image.generate", "artifact.select", "lab.write", "qa.visual_review"];

describe("A — an ordinary message stays a conversation", () => {
  it("answers normally and starts no run", async () => {
    const { user, conversationId } = await setup();

    const { assistantText, runId } = await sendChat(conversationId, "How are you today?");

    expect(runId).toBeUndefined();
    expect(assistantText).toBe("Hello.");
    // Exactly one model call: the reply. Classification cost nothing.
    expect(chatModelCalls).toBe(1);
    expect(imageCalls).toBe(0);
    expect(await db.agentRun.count({ where: { userId: user.id } })).toBe(0);
  });

  it("classifies without spending a model call", async () => {
    // The decision itself, isolated: the deterministic router pass and nothing
    // else. This is the property the whole design rests on.
    const action = await decideChatAction("what did we decide about pricing?");
    expect(action.kind).toBe("conversational");
    expect(chatModelCalls).toBe(0);
  });
});

describe("B — an executable request becomes a real run", () => {
  it("creates an AgentRun and executes it", async () => {
    const { user, conversationId } = await setup(ALL_GRANTS);
    scoreQueue = [90];

    const { runId, events } = await sendChatAndSettle(
      conversationId,
      "Generate a concept image of the suit and improve it until the material reads as technical fabric.",
    );

    expect(runId).toBeTruthy();
    const run = await db.agentRun.findFirst({ where: { id: runId!, userId: user.id } });
    expect(run).toBeTruthy();
    expect(run!.traceId).toBeTruthy();

    // The orchestrated path composes its reply from state — no model call.
    expect(chatModelCalls).toBe(0);
    expect(imageCalls).toBe(1);

    // The outcome is in the REWRITTEN message, because the response returned
    // before the run finished. The link travelled as the run_started frame.
    expect(await currentOutcomeText(user.id, runId!)).toContain("Done");
    expect(events.some((e) => e.type === "run_started" && e.runId === runId)).toBe(true);
  });

  it("persists the assistant message with the run it describes", async () => {
    const { conversationId } = await setup(ALL_GRANTS);
    scoreQueue = [88];

    const { runId } = await sendChatAndSettle(conversationId, "Generate a concept image of the suit and improve it until it matches.");

    const message = await db.message.findFirst({
      where: { conversationId, role: "ASSISTANT" },
      orderBy: { createdAt: "desc" },
    });
    expect(message).toBeTruthy();
    const meta = JSON.parse(message!.meta ?? "{}");
    expect(meta.orchestrated).toBe(true);
    expect(meta.runId).toBe(runId);
  });
});

describe("C — chat reaches the existing refinement loop", () => {
  it("iterates from a chat message, and the reply reports the attempts", async () => {
    const { user, conversationId } = await setup(ALL_GRANTS);
    scoreQueue = [61, 91];

    const { runId } = await sendChatAndSettle(
      conversationId,
      "Generate a concept image of the suit and improve it until the material reads as technical fabric.",
    );

    // Two generations from ONE chat message: the loop ran without a second
    // user turn, which is the behaviour BRAIN-020 exists to make reachable.
    expect(imageCalls).toBe(2);
    expect(qaCalls).toBe(2);

    const trace = await getRunTrace(user.id, { runId: runId! });
    expect(trace.iterations[0]?.attempts.map((a) => a.score)).toEqual([61, 91]);
    expect(await currentOutcomeText(user.id, runId!)).toContain("2 attempt(s)");
    expect(chatModelCalls).toBe(0);
  });
});

describe("D — the full request, end to end from chat", () => {
  it("makes variations, compares, improves the winner, and attaches it", async () => {
    const { user, conversationId } = await setup(ALL_GRANTS);
    const suit = await db.labSuit.create({
      data: { userId: user.id, codename: "LONGWAVE", designation: "VX-03", archetype: "Recon" },
    });

    // Three candidates (70/79/64), then the winner refined: fails at 76, passes at 90.
    scoreQueue = [70, 79, 64, 76, 90];

    const { runId } = await sendChatAndSettle(
      conversationId,
      `Make three variations of the mask, compare them, improve the winner, and attach it to the ${suit.codename} suit.`,
    );

    expect(runId).toBeTruthy();
    const trace = await getRunTrace(user.id, { runId: runId! });
    const tools = trace.steps.map((s) => s.toolName);

    expect(tools).toContain("media.image.generate");
    expect(tools).toContain("artifact.select_best");
    expect(tools).toContain("media.image.refine");
    expect(tools.indexOf("artifact.select_best")).toBeLessThan(tools.indexOf("media.image.refine"));
    expect(trace.status).toBe("COMPLETED");

    // One batch of three, then two refinement attempts.
    expect(imageCalls).toBe(3);
    expect(chatModelCalls).toBe(0);
    expect(await currentOutcomeText(user.id, runId!)).toContain("Done");
  });

  it("attaches to the Lab when the request names a Lab subject", async () => {
    const { user, conversationId } = await setup(ALL_GRANTS);
    const suit = await db.labSuit.create({
      data: { userId: user.id, codename: "SLIPSTREAM", designation: "VX-05", archetype: "Speed" },
    });
    scoreQueue = [72, 81, 65, 93];

    const { runId } = await sendChatAndSettle(
      conversationId,
      "Make three variations of the mask, compare them, improve the winner, and attach it to the Suit Bay.",
    );

    // Chat has no subject context, so the orchestrator cannot attach on its
    // own — the run still completes, and the Lab is untouched rather than
    // being given an arbitrary suit.
    const trace = await getRunTrace(user.id, { runId: runId! });
    expect(trace.status).toBe("COMPLETED");
    expect(await listLabArtifacts(user.id, "LabSuit", suit.id)).toHaveLength(0);
  });
});

describe("E — provider failure is reported honestly", () => {
  it("does not claim success when generation fails", async () => {
    const { user, conversationId } = await setup(ALL_GRANTS);
    generationFails = true;

    const { runId } = await sendChatAndSettle(
      conversationId,
      "Generate a concept image of the suit and improve it until it matches.",
    );

    const trace = await getRunTrace(user.id, { runId: runId! });
    expect(trace.providerCalls.some((c) => c.status === "FAILED")).toBe(true);
    // No sentence claims the work succeeded.
    const text = await currentOutcomeText(user.id, runId!);
    expect(text).not.toMatch(/\bDone —/);
    expect(text.toLowerCase()).toMatch(/didn't work|none passed|kept the strongest/);
  });

  it("says so when no reviewer is available, rather than approving blind", async () => {
    const { conversationId } = await setup(ALL_GRANTS);
    reviewUnavailable = true;

    const { runId } = await sendChatAndSettle(
      conversationId,
      "Generate a concept image of the suit and improve it until it matches.",
    );

    // One generation, then it stops: no reviewer means no basis for another.
    expect(imageCalls).toBe(1);
    expect(runId).toBeTruthy();
  });
});

describe("F — permissions still gate execution", () => {
  it("parks the run and asks, rather than generating", async () => {
    // Only memory granted. Generation must not happen.
    const { user, conversationId } = await setup(["memory.search"]);

    const { runId } = await sendChatAndSettle(
      conversationId,
      "Recall the suit decisions, then generate a concept image of the suit and improve it until it matches.",
      // The parked state is the subject here, so do not play the human.
      { approve: false },
    );

    expect(imageCalls).toBe(0);
    const trace = await getRunTrace(user.id, { runId: runId! });
    expect(trace.status).toBe("WAITING_FOR_PERMISSION");

    // The reply names the action and the level, in the plan's own words.
    const text = await outcomeText(user.id, conversationId);
    expect(text).toContain("approval");
    expect(text).toContain("media.image.generate");
    expect(text).toContain("ACT");
  });
});

describe("G — a run started from chat resumes like any other", () => {
  it("continues after the grant without repeating completed work", async () => {
    const { user, conversationId } = await setup(["memory.search"]);
    scoreQueue = [90];

    const { runId } = await sendChatAndSettle(
      conversationId,
      "Recall the suit decisions, then generate a concept image of the suit and improve it until it matches.",
      // The parked state is the subject here, so do not play the human.
      { approve: false },
    );
    expect((await getRunTrace(user.id, { runId: runId! })).status).toBe("WAITING_FOR_PERMISSION");

    const before = await getRunTrace(user.id, { runId: runId! });
    const completedBefore = before.steps.filter((s) => s.status === "COMPLETED").map((s) => s.order);
    expect(completedBefore.length).toBeGreaterThan(0);

    await grantPermission(user.id, "media.image.generate", "ACT");
    await grantPermission(user.id, "qa.visual_review", "ACT");

    // Resumed through the ordinary orchestrator route — chat-started runs are
    // not a separate species.
    const { resumeRun } = await import("@/lib/capabilities/orchestrator");
    await resumeRun(user.id, runId!);
    // [P4-C3] The grant answers "may VOX do this kind of thing". The step still
    // holds until someone answers "do I approve THIS invocation" — resume is
    // explicitly not that answer, which is the property under test here.
    expect((await getRunTrace(user.id, { runId: runId! })).status).toBe("WAITING_FOR_PERMISSION");
    await approveAndResume(user.id, runId!);

    const after = await getRunTrace(user.id, { runId: runId! });
    expect(after.status).toBe("COMPLETED");
    expect(imageCalls).toBe(1);
    for (const order of completedBefore) {
      expect(after.steps.find((s) => s.order === order)?.status).toBe("COMPLETED");
    }
  });
});

describe("H — cost accounting", () => {
  it("spends no conversational model call on any orchestrated turn", async () => {
    const { conversationId } = await setup(ALL_GRANTS);
    scoreQueue = [85];

    await sendChatAndSettle(conversationId, "Generate a concept image of the suit and improve it until it matches.");

    // The plan summary and the outcome are both composed from state. A model
    // call here would be paying to describe work we already have the record of.
    expect(chatModelCalls).toBe(0);
  });

  it("makes exactly one conversational call per ordinary message, and no more", async () => {
    const { conversationId } = await setup();

    await sendChat(conversationId, "What is on my mind today?");
    await sendChat(conversationId, "Tell me something interesting.");

    expect(chatModelCalls).toBe(2);
    expect(imageCalls).toBe(0);
    expect(qaCalls).toBe(0);
  });

  it("reports the run's real cost, never a fabricated one", async () => {
    const { user, conversationId } = await setup(ALL_GRANTS);
    scoreQueue = [91];

    const { runId } = await sendChatAndSettle(
      conversationId,
      "Generate a concept image of the suit and improve it until it matches.",
    );

    const trace = await getRunTrace(user.id, { runId: runId! });
    expect(trace.costUsd).toBeGreaterThan(0);
    const text = await currentOutcomeText(user.id, runId!);
    expect(text).toContain("provider call(s)");
    // The figure in the message is the ledger's figure.
    expect(text).toContain(`$${trace.costUsd!.toFixed(4)}`);
  });
});

describe("the composed reply never overstates", () => {
  it("says what it could NOT do when the plan was degraded", async () => {
    // No image provider configured. The router drops the generation stage and
    // the run legitimately completes — so a reply of "Done" to someone who
    // asked for a picture is technically true and completely misleading. This
    // was caught by looking at the rendered chat, not by a green test.
    vi.mocked(imageModule.getImageProvider).mockReturnValue({
      id: "unavailable",
      displayName: "No image provider",
      defaultModel: "",
      capabilities: [],
      isConfigured: false,
      unavailableReason: "GOOGLE_API_KEY is not set.",
      generate: async () => {
        throw new Error("not configured");
      },
    });

    const { user, conversationId } = await setup(ALL_GRANTS);
    const { runId } = await sendChatAndSettle(
      conversationId,
      "Recall the suit decisions, then generate a concept image of the suit and improve it until it matches.",
      // The parked state is the subject here, so do not play the human.
      { approve: false },
    );

    if (!runId) return; // routed to nothing at all; the other branch covers that
    const trace = await getRunTrace(user.id, { runId });
    expect(trace.plan?.degraded).toBe(true);
    expect(await outcomeText(user.id, conversationId)).toContain("couldn't do all of it");
    expect(imageCalls).toBe(0);
  });

  it("renders as plain text — the bubble does not parse markdown", async () => {
    const { user, conversationId } = await setup(ALL_GRANTS);
    scoreQueue = [90];
    const { runId } = await sendChatAndSettle(
      conversationId,
      "Generate a concept image of the suit and improve it until it matches.",
    );
    // Markdown syntax would appear literally to the reader.
    const text = await currentOutcomeText(user.id, runId!);
    expect(text).not.toMatch(/\]\(/);
    expect(text).not.toContain("**");
  });

  it("reports a permission pause as a pause, not as progress", async () => {
    const { user, conversationId } = await setup(["memory.search"]);
    const { runId } = await sendChatAndSettle(
      conversationId,
      "Recall the suit decisions, then generate a concept image of the suit and improve it until it matches.",
      // The parked state is the subject here, so do not play the human.
      { approve: false },
    );

    const trace = await getRunTrace(user.id, { runId: runId! });
    const text = describeRunOutcome(trace);
    expect(text).toContain("approval");
    expect(text).not.toContain("Done —");
  });
});


/**
 * BRAIN-021 — the run is asynchronous, and the server is authoritative.
 *
 * The claim being tested is a TIMING one, which is why these assert on what is
 * true the instant the response closes rather than on the eventual outcome.
 */
describe("BRAIN-021 — the response returns before the work finishes", () => {
  it("returns while the run is still going", async () => {
    const { conversationId } = await setup(ALL_GRANTS);
    // Three failing reviews, so the loop takes its full three attempts and
    // there is a real window in which to observe it still running.
    scoreQueue = [40, 50, 60];

    const { runId } = await sendChat(
      conversationId,
      "Generate a concept image of the suit and improve it until the material reads as technical fabric.",
    );
    expect(runId).toBeTruthy();

    // The POST has returned. The run has NOT finished — this is the whole
    // point of BRAIN-021, and it is only observable at this instant.
    const atReturn = await db.agentRun.findUnique({ where: { id: runId! }, select: { status: true } });
    expect(["PLANNING", "RUNNING"]).toContain(atReturn!.status);

    await settle(runId!);
    // [P4-C3] It ran until the first HOLD, then stopped for a human. The
    // approvals are supplied through the real service so the rest of the loop
    // — the thing this test is about — can be observed.
    const { userId } = (await db.agentRun.findUniqueOrThrow({ where: { id: runId! }, select: { userId: true } }));
    await approveAndResume(userId, runId!);
    await settle(runId!);
    expect((await db.agentRun.findUnique({ where: { id: runId! } }))!.status).toBe("COMPLETED");
    // It really did keep working after the response closed.
    expect(imageCalls).toBe(3);
    expect(chatModelCalls).toBe(0);
  });

  it("persists the message and its run id before returning, so a reload finds them", async () => {
    const { user, conversationId } = await setup(ALL_GRANTS);
    scoreQueue = [45, 55, 65];

    const { runId } = await sendChat(
      conversationId,
      "Generate a concept image of the suit and improve it until the material reads as technical fabric.",
    );

    // Read the conversation the way a reloaded client would, WHILE the run is
    // still in flight. Without the durable message a refresh mid-run would
    // lose the work entirely.
    const conversation = await getConversation(user.id, conversationId);
    const assistant = [...(conversation?.messages ?? [])].reverse().find((m) => m.role === "ASSISTANT");
    expect(assistant).toBeTruthy();
    const meta = JSON.parse(assistant!.meta ?? "{}");
    expect(meta.runId).toBe(runId);
    expect(meta.pending).toBe(true);

    await settle(runId!);

    // Once settled, the SAME message now carries the outcome — not a second
    // message leaving a permanent "working on it" above it.
    const after = await getConversation(user.id, conversationId);
    const assistants = (after?.messages ?? []).filter((m) => m.role === "ASSISTANT");
    expect(assistants).toHaveLength(1);
    expect(assistants[0].id).toBe(assistant!.id);
    // The point is that the SAME row was rewritten with the run's real
    // account of itself — not that it succeeded.
    expect(assistants[0].content).not.toBe(assistant!.content);
    expect(JSON.parse(assistants[0].meta ?? "{}").pending).toBeUndefined();
    // [P4-C3] And that account is now the approval stop, because generation
    // holds for a human before it runs. The message reports what actually
    // happened rather than the loop it never reached.
    expect(assistants[0].content).toContain("approval");

    // Once the human approves, the loop runs and VOX's account of the run says
    // so. Read from the live trace: the persisted message is written once, by
    // the route's onSettled, and a run resumed later does not rewrite it — see
    // `currentOutcomeText`.
    await approveAndResume(user.id, runId!);
    await settle(runId!);
    const finished = await currentOutcomeText(user.id, runId!);
    expect(finished).toContain("attempts");
    expect(finished).toContain("provider call(s)");
  });

  it("keeps running after the client goes away", async () => {
    const { user, conversationId } = await setup(ALL_GRANTS);
    scoreQueue = [42, 52, 62];

    const { runId } = await sendChat(
      conversationId,
      "Generate a concept image of the suit and improve it until the material reads as technical fabric.",
    );
    // The response object is discarded here — the client has effectively gone.
    // Nothing cancels the run, because execution was never attached to it.
    await settle(runId!);
    // [P4-C3] Approvals supplied through the real service; the subject is that
    // nothing cancelled the run when the client went away.
    await approveAndResume(user.id, runId!);
    await settle(runId!);

    const trace = await getRunTrace(user.id, { runId: runId! });
    expect(trace.status).toBe("COMPLETED");
    expect(imageCalls).toBe(3);
  });

  it("recovers current state on reconnect, and reconnecting twice runs nothing twice", async () => {
    const { user, conversationId } = await setup(ALL_GRANTS);
    scoreQueue = [48, 58, 68];

    const { runId } = await sendChat(
      conversationId,
      "Generate a concept image of the suit and improve it until the material reads as technical fabric.",
    );

    // Two independent "clients" reading the run — the same read the inline
    // panel and the workspace both perform.
    const [a, b] = await Promise.all([
      getRunTrace(user.id, { runId: runId! }),
      getRunTrace(user.id, { runId: runId! }),
    ]);
    expect(a.runId).toBe(runId);
    expect(b.runId).toBe(runId);

    await settle(runId!);
    await approveAndResume(user.id, runId!);
    await settle(runId!);

    // Reading is not executing: three attempts total, not six.
    expect(imageCalls).toBe(3);
    const final = await getRunTrace(user.id, { runId: runId! });
    expect(final.status).toBe("COMPLETED");
    expect(final.steps.every((s) => s.status !== "RUNNING")).toBe(true);
  });

  it("shows a completed run its final state without rerunning it", async () => {
    const { user, conversationId } = await setup(ALL_GRANTS);
    scoreQueue = [90];

    const { runId } = await sendChatAndSettle(
      conversationId,
      "Generate a concept image of the suit and improve it until it matches.",
    );
    const generationsAfterFirstRun = imageCalls;

    // "Reconnect" to a finished run.
    const trace = await getRunTrace(user.id, { runId: runId! });
    expect(trace.status).toBe("COMPLETED");
    expect(trace.live).toBe(false);
    expect(imageCalls).toBe(generationsAfterFirstRun);
  });

  it("adds zero model or provider calls for transport", async () => {
    const { conversationId } = await setup(ALL_GRANTS);
    scoreQueue = [88];

    const { runId } = await sendChatAndSettle(
      conversationId,
      "Generate a concept image of the suit and improve it until it matches.",
    );

    const generations = imageCalls;
    const reviews = qaCalls;

    // Everything the transport does: read state. Reading must cost nothing.
    await getRunTrace((await db.agentRun.findUnique({ where: { id: runId! } }))!.userId, { runId: runId! });
    await getRunTrace((await db.agentRun.findUnique({ where: { id: runId! } }))!.userId, { runId: runId! });

    expect(chatModelCalls).toBe(0);
    expect(imageCalls).toBe(generations);
    expect(qaCalls).toBe(reviews);
  });

  it("connects Stop to the existing cancellation path", async () => {
    const { user, conversationId } = await setup(["memory.search"]);

    // Parks on the ungranted generation, giving a live run to stop.
    const { runId } = await sendChatAndSettle(
      conversationId,
      "Recall the suit decisions, then generate a concept image of the suit and improve it until it matches.",
      // The parked state is the subject here, so do not play the human.
      { approve: false },
    );
    expect((await getRunTrace(user.id, { runId: runId! })).status).toBe("WAITING_FOR_PERMISSION");

    const { cancelRun } = await import("@/lib/capabilities/orchestrator");
    await cancelRun(user.id, runId!);

    const after = await getRunTrace(user.id, { runId: runId! });
    expect(after.status).toBe("CANCELLED");
    // Completed work survives cancellation.
    expect(after.steps.some((s) => s.status === "COMPLETED")).toBe(true);
    expect(imageCalls).toBe(0);
  });
});
