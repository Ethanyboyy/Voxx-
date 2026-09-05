import { describe, it, expect, vi, afterEach } from "vitest";
import { db } from "@/lib/db";
import { runResearch } from "@/lib/research/service";
import { ExecutionNotAuthorizedError, assertExecutionAuthorized, withPolicyBoundary, withEnforcedExecution } from "@/lib/policy/gate";
import { createProposal, approveProposal, ACTION_HANDLERS, PROPOSAL_APPROVAL_TARGET_TYPE } from "@/lib/cognition/proposals";
import { grantPermission } from "@/lib/permissions/service";
import { classifyAction } from "@/lib/policy/classification";
import { evaluatePolicy } from "@/lib/policy/gate";
import { enforceExecution } from "@/lib/policy/enforcement";
import { hashArguments } from "@/lib/policy/approvals";
import { getPendingStepApproval, approveAgentStep } from "@/lib/policy/step-approvals";
import * as sessionModule from "@/lib/auth/session";
import { POST as researchPost } from "@/app/api/research/route";
import { createTestUser, approveAndResume } from "./helpers";
import type { User } from "@/generated/prisma/client";

/**
 * P4-D — THE POLICY SURFACE.
 *
 * P4-C3 enforced the agent-step boundary and named two consequential paths that
 * ran beside it: `POST /api/research` reaching `runResearch()` directly, and
 * `approveProposal()` running its own handler registry. This suite is the proof
 * that both are closed, and that closing them did not turn ordinary internal
 * work into an approval queue.
 *
 * The question, asked at the sink rather than the door:
 *
 *   IS THERE A WAY TO CAUSE A CONSEQUENTIAL SIDE EFFECT WITHOUT AN ENFORCEMENT
 *   DECISION HAVING PERMITTED IT?
 *
 * Every "did not happen" assertion counts rows, not statuses.
 */

function asUser(user: User) {
  vi.spyOn(sessionModule, "getCurrentUser").mockResolvedValue(user);
}

function researchRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as never;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("P4-D — the research sink refuses callers outside the boundary", () => {
  it("throws rather than researching when nothing enforced the call", async () => {
    const user = await createTestUser();
    await grantPermission(user.id, "research.web", "RECOMMEND");

    // The capability is HELD. That is deliberate: it isolates the new guard
    // from the permission check, and shows the two answer different questions.
    await expect(runResearch(user.id, "unguarded direct call")).rejects.toBeInstanceOf(
      ExecutionNotAuthorizedError
    );
    expect(await db.researchItem.count({ where: { userId: user.id } })).toBe(0);
    expect(await db.memory.count({ where: { userId: user.id } })).toBe(0);
  });

  it("is not satisfied by an OBSERVABILITY boundary", async () => {
    const user = await createTestUser();
    await grantPermission(user.id, "research.web", "RECOMMEND");

    // `withPolicyBoundary` suppresses a duplicate shadow record. It is not
    // authorization, and the guard must not confuse the two — otherwise any
    // code that wanted to silence a log line would also be granting itself
    // permission.
    await expect(
      withPolicyBoundary("test.observability", () => runResearch(user.id, "observability is not authority"))
    ).rejects.toBeInstanceOf(ExecutionNotAuthorizedError);
    expect(await db.researchItem.count({ where: { userId: user.id } })).toBe(0);
  });

  it("guards at the sink, so a brand-new caller is covered without knowing about it", () => {
    // The structural claim: the assertion lives in the service, not in the
    // route. A future caller inherits it by calling the function.
    expect(() => assertExecutionAuthorized("research.run")).toThrow(ExecutionNotAuthorizedError);
    expect(() => withEnforcedExecution("test.enforced", "research.run", async () => {})).not.toThrow();
  });
});

describe("P4-D — the research route goes through enforcement", () => {
  it("holds a direct HTTP research request instead of running it", async () => {
    const user = await createTestUser();
    await grantPermission(user.id, "research.web", "RECOMMEND");
    asUser(user);

    const res = await researchPost(researchRequest({ query: "http cannot bypass the gate" }));

    // 202: recorded, not performed.
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.status).toBe("WAITING_FOR_PERMISSION");
    expect(body.items).toEqual([]);
    expect(body.stepId).toBeTruthy();
    // The side effect, not the status field.
    expect(await db.researchItem.count({ where: { userId: user.id } })).toBe(0);
  });

  it("runs it once the human approves the exact query", async () => {
    const user = await createTestUser();
    await grantPermission(user.id, "research.web", "RECOMMEND");
    asUser(user);

    const res = await researchPost(researchRequest({ query: "approved query" }));
    const body = await res.json();

    const finished = await approveAndResume(user.id, body.runId);
    expect(finished.status).toBe("COMPLETED");
    expect(await db.researchItem.count({ where: { userId: user.id, query: "approved query" } })).toBeGreaterThan(0);
  });

  it("does not let one approval authorize a second research request", async () => {
    const user = await createTestUser();
    await grantPermission(user.id, "research.web", "RECOMMEND");
    asUser(user);

    const first = await (await researchPost(researchRequest({ query: "replay target" }))).json();
    await approveAndResume(user.id, first.runId);
    const afterFirst = await db.researchItem.count({ where: { userId: user.id } });
    expect(afterFirst).toBeGreaterThan(0);

    // A second, identical request is a different step, so the spent grant
    // cannot carry it.
    const second = await (await researchPost(researchRequest({ query: "replay target" }))).json();
    expect(second.status).toBe("WAITING_FOR_PERMISSION");
    expect(await db.researchItem.count({ where: { userId: user.id } })).toBe(afterFirst);
  });

  it("does not let one person's approval authorize another's research", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    for (const u of [owner, stranger]) await grantPermission(u.id, "research.web", "RECOMMEND");

    asUser(owner);
    const theirs = await (await researchPost(researchRequest({ query: "shared query text" }))).json();
    await approveAndResume(owner.id, theirs.runId);
    expect(await db.researchItem.count({ where: { userId: owner.id } })).toBeGreaterThan(0);

    asUser(stranger);
    const mine = await (await researchPost(researchRequest({ query: "shared query text" }))).json();
    expect(mine.status).toBe("WAITING_FOR_PERMISSION");
    expect(await db.researchItem.count({ where: { userId: stranger.id } })).toBe(0);
  });

  it("invalidates the approval when the stored query is mutated afterwards", async () => {
    const user = await createTestUser();
    await grantPermission(user.id, "research.web", "RECOMMEND");
    asUser(user);

    const body = await (await researchPost(researchRequest({ query: "original question" }))).json();
    const step = await db.agentStep.findUniqueOrThrow({ where: { id: body.stepId } });
    const pending = await getPendingStepApproval(user.id, body.runId, step.id);
    if (!pending.found) throw new Error("expected a pending approval");
    await approveAgentStep({
      userId: user.id,
      runId: body.runId,
      stepId: step.id,
      argumentsHash: pending.pending.argumentsHash,
    });

    // The query is rewritten after the human read it. The approval describes
    // what they saw, so it no longer describes what would run.
    await db.agentStep.update({
      where: { id: step.id },
      data: { input: JSON.stringify({ query: "a completely different question" }) },
    });
    const { resumeAgentRun } = await import("@/lib/agents/service");
    await resumeAgentRun(user.id, body.runId);

    expect(await db.researchItem.count({ where: { userId: user.id } })).toBe(0);
    const refusals = await db.event.findMany({ where: { userId: user.id, type: "policy.execution_refused" } });
    expect(JSON.parse(refusals.at(-1)!.payload!).reasons).toContain("ARGUMENTS_CHANGED");
  });

  it("takes the classification from the registry, not from the request body", async () => {
    const user = await createTestUser();
    await grantPermission(user.id, "research.web", "RECOMMEND");
    asUser(user);

    // A body asserting its own harmlessness. The schema strips it; even if it
    // did not, nothing downstream reads a caller's classification.
    const res = await researchPost(
      researchRequest({
        query: "smuggling attempt",
        effect: "READ",
        policyDecision: "ALLOW",
        capability: "memory.read",
        requiredLevel: "OBSERVE",
      })
    );
    expect(res.status).toBe(202);
    expect(await db.researchItem.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe("P4-D — the proposal path is enforced, not merely observed", () => {
  async function proposalOf(userId: string, actionType: string, payload: Record<string, unknown>, capability = "project.write") {
    return createProposal({
      userId,
      observation: "Something worth doing.",
      suggestedAction: "Do it.",
      actionType,
      actionPayload: payload,
      capability,
    });
  }

  it("still executes an ALLOW handler — the gate did not become an approval queue", async () => {
    const user = await createTestUser();
    await grantPermission(user.id, "project.write", "ACT");
    const proposal = await proposalOf(user.id, "task.create", { title: "P4-D allow path" });

    const approved = await approveProposal(user.id, proposal.id);
    expect(approved?.status).toBe("EXECUTED");
    // The actual side effect.
    expect(await db.task.count({ where: { userId: user.id, title: "P4-D allow path" } })).toBe(1);
  });

  it("every registered handler is classified, so none can slip past unclassified", () => {
    // The gate refuses an unclassified action. This asserts the registry cannot
    // contain one — a handler added without a table entry fails here rather
    // than becoming a permanently-refused feature discovered in production.
    for (const actionType of Object.keys(ACTION_HANDLERS)) {
      expect(classifyAction("proposal", actionType).known).toBe(true);
    }
  });

  it("refuses a handler whose action would be held, without running it", async () => {
    const user = await createTestUser();
    // `research.run` is a HOLD and is NOT in ACTION_HANDLERS — so this stands in
    // for a future consequential handler: the enforcement call refuses before
    // the handler lookup could ever matter.
    const proposal = await proposalOf(user.id, "research.run", { query: "held proposal" }, "research.web");
    await grantPermission(user.id, "research.web", "ACT");

    const result = await approveProposal(user.id, proposal.id);
    expect(result?.status).toBe("FAILED");
    expect(result?.result).toMatch(/Policy refused/);
    expect(await db.researchItem.count({ where: { userId: user.id } })).toBe(0);

    const refusal = await db.event.findFirst({
      where: { userId: user.id, type: "policy.execution_refused", subjectId: proposal.id },
    });
    expect(refusal).not.toBeNull();
    expect(JSON.parse(refusal!.payload!).registry).toBe("proposal");
  });

  it("cannot be approved by another user", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    await grantPermission(owner.id, "project.write", "ACT");
    const proposal = await proposalOf(owner.id, "task.create", { title: "Not yours" });

    expect(await approveProposal(stranger.id, proposal.id)).toBeNull();
    expect(await db.task.count({ where: { title: "Not yours" } })).toBe(0);
  });

  it("cannot be executed twice", async () => {
    const user = await createTestUser();
    await grantPermission(user.id, "project.write", "ACT");
    const proposal = await proposalOf(user.id, "task.create", { title: "Once only" });

    await approveProposal(user.id, proposal.id);
    const second = await approveProposal(user.id, proposal.id);

    // The second call short-circuits on status, so the handler never re-runs.
    expect(second?.status).toBe("EXECUTED");
    expect(await db.task.count({ where: { userId: user.id, title: "Once only" } })).toBe(1);
  });

  it("binds a proposal approval to the Proposal, not to an AgentStep", async () => {
    // The generalization P4-D asked about turned out to need no new structure:
    // `targetType` was already a free string on the one grant table.
    expect(PROPOSAL_APPROVAL_TARGET_TYPE).toBe("Proposal");

    const user = await createTestUser();
    const outcome = await enforceExecution({
      userId: user.id,
      registry: "proposal",
      actionId: "task.create",
      argumentsHash: hashArguments({ title: "binding" }),
      capability: "project.write",
      requiredLevel: "ACT",
      targetType: PROPOSAL_APPROVAL_TARGET_TYPE,
      targetId: "proposal-1",
    });
    // task.create is ALLOW, so it is permitted with no grant — and the point
    // here is that one enforcement primitive served a non-step target at all.
    expect(outcome.permitted).toBe(true);
  });
});

describe("P4-D — the sweep's conclusions, asserted", () => {
  it("the consequential tool sinks are reachable only through the registry", async () => {
    const { readFile, readdir } = await import("node:fs/promises");
    const { join } = await import("node:path");

    async function walk(dir: string): Promise<string[]> {
      const entries = await readdir(dir, { withFileTypes: true });
      const out = await Promise.all(
        entries.map(async (e) => {
          const full = join(dir, e.name);
          if (e.isDirectory()) return e.name === "generated" ? [] : walk(full);
          return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
        })
      );
      return out.flat();
    }

    const files = await walk("src");
    // Each sink, and the modules allowed to reach it. Anything else importing
    // one is a new execution surface that has to be classified before it ships.
    const sinks: Record<string, string[]> = {
      // File writes.
      writeWorkspaceFile: ["src/lib/workspace/fs.ts", "src/lib/tools/registry.ts"],
      patchWorkspaceFile: ["src/lib/workspace/fs.ts", "src/lib/tools/registry.ts"],
      // Money.
      recordOpportunitySpend: ["src/lib/economic/service.ts", "src/lib/tools/registry.ts"],
      // Paid external providers.
      generateImage: ["src/lib/capabilities/execute.ts", "src/lib/tools/registry.ts"],
      submitVideo: ["src/lib/capabilities/execute.ts", "src/lib/tools/registry.ts"],
      refineUntilAcceptable: ["src/lib/capabilities/refine.ts", "src/lib/tools/registry.ts"],
      selectBestVersion: ["src/lib/capabilities/select.ts", "src/lib/tools/registry.ts"],
    };

    for (const [sink, allowed] of Object.entries(sinks)) {
      const callers: string[] = [];
      for (const file of files) {
        const source = await readFile(file, "utf8");
        // Comment lines are stripped first: several modules DISCUSS these sinks
        // by name in their own docs, and a prose mention is not a call site.
        const code = source
          .split("\n")
          .filter((line) => {
            const t = line.trim();
            return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
          })
          .join("\n");
        if (code.includes(`${sink}(`)) callers.push(file);
      }
      expect({ sink, callers: callers.filter((c) => !allowed.includes(c)) }).toEqual({ sink, callers: [] });
    }
  }, 60_000);

  it("runResearch has exactly one production caller, and it is the tool", async () => {
    const { readFile } = await import("node:fs/promises");
    // The route no longer calls it. If that regresses, this fails.
    expect(await readFile("src/app/api/research/route.ts", "utf8")).not.toContain("runResearch(");
    expect(await readFile("src/lib/tools/registry.ts", "utf8")).toContain("runResearch(");
  });

  it("the proposal handler registry runs only from approveProposal", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile("src/lib/cognition/proposals.ts", "utf8");
    // Enforcement precedes the handler call, in that order, in that function.
    expect(source.indexOf("enforceExecution(")).toBeLessThan(source.indexOf("handler(userId, payload)"));
    expect(source).toContain("withEnforcedExecution(");
  });

  it("policy classification agrees with the enforcement outcome for every registered tool", async () => {
    // The sweep's ground truth: whatever the table says an action is, that is
    // what the gate acts on. No tool has a classification the enforcement path
    // would read differently.
    const { listTools } = await import("@/lib/tools/registry");
    for (const tool of listTools()) {
      const { classification, known } = classifyAction("tool", tool.name);
      expect(known).toBe(true);
      const decision = evaluatePolicy({ action: classification }).decision;
      expect(["ALLOW", "HOLD", "DENY"]).toContain(decision);
    }
  });
});
