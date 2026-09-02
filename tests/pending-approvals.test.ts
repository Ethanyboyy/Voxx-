import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import {
  listPendingApprovals,
  listPendingApprovalsBySource,
  countPendingApprovals,
  PENDING_APPROVAL_SOURCES,
  type PendingApproval,
} from "@/lib/policy/pending-approvals";
import { ACTION_HANDLERS, createProposal, approveProposal } from "@/lib/cognition/proposals";
import { PROPOSAL_ACTION_CLASSIFICATIONS, classifyAction } from "@/lib/policy/classification";
import { grantPermission } from "@/lib/permissions/service";
import { createTestUser } from "./helpers";

/** Every table the projection reads, counted, so mutation can be ruled out. */
async function dbCensus(userId: string) {
  const [agentRuns, agentSteps, supervisorRuns, proposals, connections, experiments, events] = await Promise.all([
    db.agentRun.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    db.agentStep.findMany({ where: { run: { userId } }, orderBy: { id: "asc" } }),
    db.supervisorRun.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    db.proposal.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    db.connection.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    db.experiment.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    db.event.count({ where: { userId } }),
  ]);
  return { agentRuns, agentSteps, supervisorRuns, proposals, connections, experiments, events };
}

function byId(approvals: PendingApproval[], id: string): PendingApproval {
  const found = approvals.find((a) => a.id === id);
  if (!found) throw new Error(`No pending approval ${id}. Present: ${approvals.map((a) => a.id).join(", ")}`);
  return found;
}

describe("P3 — PendingApproval projection", () => {
  describe("an empty world", () => {
    it("projects nothing when nothing is waiting", async () => {
      const user = await createTestUser();
      expect(await listPendingApprovals(user.id)).toEqual([]);
      const counts = await countPendingApprovals(user.id);
      expect(counts.total).toBe(0);
      // Every source present and zeroed, so a reader never has to guess whether
      // an absent key means "none waiting" or "source not checked".
      for (const source of PENDING_APPROVAL_SOURCES) expect(counts[source]).toBe(0);
    });
  });

  describe("each existing waiting state maps to exactly one entry", () => {
    let userId: string;
    let ids: Record<string, string>;

    beforeAll(async () => {
      const user = await createTestUser();
      userId = user.id;

      // 1. AgentRun.WAITING_FOR_PERMISSION, with a real parked step.
      const run = await db.agentRun.create({
        data: { userId, objective: "Write a file into the workspace.", status: "WAITING_FOR_PERMISSION" },
      });
      await db.agentStep.create({
        data: {
          runId: run.id,
          order: 0,
          description: "Write the config file.",
          toolName: "workspace.write",
          status: "WAITING_FOR_PERMISSION",
          capability: "workspace.write",
          requiredLevel: "ACT",
        },
      });

      // 2. SupervisorRun.WAITING_FOR_APPROVAL.
      const objective = await db.objective.create({
        data: { userId, title: "Ship the approval queue", description: "P3" },
      });
      const supervisorRun = await db.supervisorRun.create({
        data: { userId, objectiveId: objective.id, status: "WAITING_FOR_APPROVAL" },
      });

      // 3. Proposal.PROPOSED — through the real service, not a raw insert.
      const proposal = await createProposal({
        userId,
        observation: "Two notes describe the same decision.",
        suggestedAction: "Link the two memories.",
        actionType: "memory.create_relation",
        actionPayload: { fromMemoryId: "a", toMemoryId: "b" },
        capability: "memory.write",
      });

      // 4. Connection.AWAITING_APPROVAL.
      const connection = await db.connection.create({
        data: {
          userId,
          category: "EMAIL_CALENDAR",
          service: "GOOGLE_CALENDAR",
          displayName: "Google Calendar",
          status: "AWAITING_APPROVAL",
          readCapability: "integration.google_calendar.read",
          writeCapability: "integration.google_calendar.write",
          statusReason: "Waiting for you to grant access.",
        },
      });

      // 5. Experiment.executionStatus = AWAITING_HUMAN — the economic boundary.
      const experiment = await db.experiment.create({
        data: {
          userId,
          hypothesis: "A cheaper channel converts as well as the current one.",
          executionStatus: "AWAITING_HUMAN",
          lastDecision: "SCALE",
          lastDecisionReason: "SCALE_THRESHOLD_MET — VOX cannot deploy capital.",
          lastDecisionAt: new Date(),
        },
      });

      ids = {
        run: run.id,
        supervisorRun: supervisorRun.id,
        proposal: proposal.id,
        connection: connection.id,
        experiment: experiment.id,
        objective: objective.id,
      };
    });

    it("normalises five sources into one list", async () => {
      const approvals = await listPendingApprovals(userId);
      expect(approvals).toHaveLength(5);
      expect(new Set(approvals.map((a) => a.source))).toEqual(new Set(PENDING_APPROVAL_SOURCES));

      const counts = await countPendingApprovals(userId);
      expect(counts.total).toBe(5);
      for (const source of PENDING_APPROVAL_SOURCES) expect(counts[source]).toBe(1);
    });

    it("maps AGENT_RUN from the parked STEP, not the run", async () => {
      const approval = byId(await listPendingApprovals(userId), `AGENT_RUN:${ids.run}`);
      expect(approval.entityId).toBe(ids.run);
      // The underlying status verbatim — not flattened to a shared word.
      expect(approval.status).toBe("WAITING_FOR_PERMISSION");
      expect(approval.actionType).toBe("workspace.write");
      expect(approval.summary).toBe("Write the config file.");
      expect(approval.requiredCapability).toBe("workspace.write");
      expect(approval.requiredLevel).toBe("ACT");
      expect(approval.targetType).toBe("AgentRun");
      expect(approval.actionable).toBe(true);
    });

    it("maps SUPERVISOR_RUN to its objective, with no invented action", async () => {
      const approval = byId(await listPendingApprovals(userId), `SUPERVISOR_RUN:${ids.supervisorRun}`);
      expect(approval.status).toBe("WAITING_FOR_APPROVAL");
      expect(approval.summary).toBe("Ship the approval queue");
      expect(approval.targetType).toBe("Objective");
      expect(approval.targetId).toBe(ids.objective);
      // A plan is not one registry action, so nothing is claimed about it.
      expect(approval.actionType).toBeUndefined();
      expect(approval.classification).toBeUndefined();
      expect(approval.policyDecision).toBeUndefined();
    });

    it("maps PROPOSAL with its own capability and required level", async () => {
      const approval = byId(await listPendingApprovals(userId), `PROPOSAL:${ids.proposal}`);
      expect(approval.status).toBe("PROPOSED");
      expect(approval.actionType).toBe("memory.create_relation");
      expect(approval.summary).toBe("Link the two memories.");
      expect(approval.requiredCapability).toBe("memory.write");
      expect(approval.requiredLevel).toBe("RECOMMEND");
      expect(approval.reason).toBe("Two notes describe the same decision.");
    });

    it("maps CONNECTION to the read capability being requested", async () => {
      const approval = byId(await listPendingApprovals(userId), `CONNECTION:${ids.connection}`);
      expect(approval.status).toBe("AWAITING_APPROVAL");
      expect(approval.actionType).toBe("GOOGLE_CALENDAR");
      expect(approval.summary).toBe("Google Calendar");
      expect(approval.requiredCapability).toBe("integration.google_calendar.read");
      expect(approval.reason).toBe("Waiting for you to grant access.");
    });

    it("maps ECONOMIC_EXPERIMENT, passing the engine's own reason through verbatim", async () => {
      const approval = byId(await listPendingApprovals(userId), `ECONOMIC_EXPERIMENT:${ids.experiment}`);
      expect(approval.status).toBe("AWAITING_HUMAN");
      expect(approval.summary).toBe("A cheaper channel converts as well as the current one.");
      // The projection never restates an economic decision in its own words.
      expect(approval.reason).toBe("SCALE_THRESHOLD_MET — VOX cannot deploy capital.");
      expect(approval.targetType).toBe("Experiment");
    });

    it("preserves stable, namespaced, unique identifiers", async () => {
      const approvals = await listPendingApprovals(userId);
      expect(new Set(approvals.map((a) => a.id)).size).toBe(approvals.length);
      for (const approval of approvals) {
        expect(approval.id).toBe(`${approval.source}:${approval.entityId}`);
      }
      // Stable across calls, not regenerated per read.
      expect((await listPendingApprovals(userId)).map((a) => a.id)).toEqual(approvals.map((a) => a.id));
    });

    it("filters by source without changing the projection", async () => {
      const all = await listPendingApprovals(userId);
      for (const source of PENDING_APPROVAL_SOURCES) {
        expect(await listPendingApprovalsBySource(userId, source)).toEqual(all.filter((a) => a.source === source));
      }
    });

    it("is deterministic — repeated reads return an identical, identically ordered list", async () => {
      const first = await listPendingApprovals(userId);
      for (let i = 0; i < 5; i++) {
        expect(await listPendingApprovals(userId)).toEqual(first);
      }
      // Timestamps here collide (same test, same clock), so this also pins the
      // id tiebreak rather than only the time ordering.
      const times = first.map((a) => a.requestedAt.getTime());
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    });

    it("mutates nothing: not the rows it reads, not the event log", async () => {
      const before = await dbCensus(userId);
      await listPendingApprovals(userId);
      await countPendingApprovals(userId);
      await listPendingApprovalsBySource(userId, "PROPOSAL");
      expect(await dbCensus(userId)).toEqual(before);
    });

    it("writes no policy event — reading the queue is not a shadow evaluation", async () => {
      const before = await db.event.count({ where: { userId, type: "policy.shadow_evaluated" } });
      await listPendingApprovals(userId);
      expect(await db.event.count({ where: { userId, type: "policy.shadow_evaluated" } })).toBe(before);
    });

    it("scopes to the user — another account's waiting work is invisible", async () => {
      const stranger = await createTestUser();
      expect(await listPendingApprovals(stranger.id)).toEqual([]);
    });
  });

  describe("workflow states that are not approval requests stay out", () => {
    it("ignores running, planning, resolved and terminal states", async () => {
      const user = await createTestUser();
      const userId = user.id;
      const objective = await db.objective.create({ data: { userId, title: "Unrelated work" } });

      await db.agentRun.create({ data: { userId, objective: "Running.", status: "RUNNING" } });
      await db.agentRun.create({ data: { userId, objective: "Planning.", status: "PLANNING" } });
      await db.agentRun.create({ data: { userId, objective: "Done.", status: "COMPLETED" } });
      await db.supervisorRun.create({ data: { userId, objectiveId: objective.id, status: "RUNNING" } });
      await db.supervisorRun.create({ data: { userId, objectiveId: objective.id, status: "BLOCKED" } });
      await db.connection.create({
        data: {
          userId,
          category: "EMAIL_CALENDAR",
          service: "GOOGLE_CALENDAR",
          displayName: "Connected already",
          status: "CONNECTED",
          readCapability: "integration.google_calendar.read",
        },
      });
      // ConnectionStatus.PROPOSED is a SUGGESTION, not a grant request: the
      // Connections Hub moves PROPOSED -> AWAITING_APPROVAL, and only the
      // latter is what a human is being asked to decide.
      await db.connection.create({
        data: {
          userId,
          category: "EMAIL_CALENDAR",
          service: "GOOGLE_GMAIL",
          displayName: "Merely suggested",
          status: "PROPOSED",
          readCapability: "integration.google_gmail.read",
        },
      });
      await db.experiment.create({
        data: { userId, hypothesis: "Live experiment.", executionStatus: "RUNNING" },
      });
      await db.experiment.create({
        data: { userId, hypothesis: "Killed experiment.", executionStatus: "KILLED" },
      });
      await db.experiment.create({
        data: { userId, hypothesis: "Draft experiment.", executionStatus: "DRAFT" },
      });

      expect(await listPendingApprovals(userId)).toEqual([]);
    });

    it("drops a proposal from the queue once it is resolved, through the real path", async () => {
      const user = await createTestUser();
      await grantPermission(user.id, "project.write", "RECOMMEND");
      const proposal = await createProposal({
        userId: user.id,
        observation: "Worth following up.",
        suggestedAction: "Create a task.",
        actionType: "task.create",
        actionPayload: { title: "Follow up" },
        capability: "project.write",
      });

      expect((await listPendingApprovals(user.id)).map((a) => a.entityId)).toContain(proposal.id);

      // The EXISTING approval mechanism, untouched by P3.
      const approved = await approveProposal(user.id, proposal.id);
      expect(approved?.status).toBe("EXECUTED");

      // The projection follows the underlying state; it does not hold its own.
      expect(await listPendingApprovals(user.id)).toEqual([]);
    });
  });

  describe("policy information is surfaced, never fabricated", () => {
    it("attaches the classification and the decision the gate WOULD make", async () => {
      const user = await createTestUser();
      const run = await db.agentRun.create({
        data: { userId: user.id, objective: "Spend.", status: "WAITING_FOR_PERMISSION" },
      });
      await db.agentStep.create({
        data: {
          runId: run.id,
          order: 0,
          description: "Record the expense.",
          toolName: "economic.record_expense",
          status: "WAITING_FOR_PERMISSION",
          capability: "economic.spend",
          requiredLevel: "ACT",
        },
      });

      const approval = byId(await listPendingApprovals(user.id), `AGENT_RUN:${run.id}`);
      expect(approval.classification).toEqual(classifyAction("tool", "economic.record_expense").classification);
      expect(approval.classification?.financial).toBe(true);
      expect(approval.classification?.reversibility).toBe("IRREVERSIBLE");
      // Shown, not enforced. A DENY here stops nothing — P2/P2.1 is shadow-only
      // and P4 owns enforcement.
      expect(approval.policyDecision).toBe("DENY");
    });

    it("omits classification entirely for an action id no registry knows", async () => {
      const user = await createTestUser();
      const run = await db.agentRun.create({
        data: { userId: user.id, objective: "Unknown tool.", status: "WAITING_FOR_PERMISSION" },
      });
      await db.agentStep.create({
        data: {
          runId: run.id,
          order: 0,
          description: "Do something unregistered.",
          toolName: "tool.that.does.not.exist",
          status: "WAITING_FOR_PERMISSION",
          capability: "unknown",
          requiredLevel: "ACT",
        },
      });

      const approval = byId(await listPendingApprovals(user.id), `AGENT_RUN:${run.id}`);
      expect(approval.actionType).toBe("tool.that.does.not.exist");
      // The conservative UNKNOWN_ACTION default is how the GATE fails safe. It
      // is not a statement about this action, so it is not reported as one.
      expect(approval.classification).toBeUndefined();
      expect(approval.policyDecision).toBeUndefined();
    });

    it("uses the proposal registry for proposals, not the tool registry", async () => {
      const user = await createTestUser();
      const proposal = await createProposal({
        userId: user.id,
        observation: "o",
        suggestedAction: "Create a task.",
        // Present in BOTH registries. The projection must read the proposal one.
        actionType: "task.create",
        actionPayload: { title: "t" },
        capability: "project.write",
      });
      const approval = byId(await listPendingApprovals(user.id), `PROPOSAL:${proposal.id}`);
      expect(approval.classification).toEqual(PROPOSAL_ACTION_CLASSIFICATIONS["task.create"]);
    });

    it("marks an AgentRun with no parked step as un-actionable rather than hiding it", async () => {
      const user = await createTestUser();
      // A data inconsistency: the run says it is waiting, no step agrees.
      const run = await db.agentRun.create({
        data: { userId: user.id, objective: "Inconsistent run.", status: "WAITING_FOR_PERMISSION" },
      });
      const approval = byId(await listPendingApprovals(user.id), `AGENT_RUN:${run.id}`);
      expect(approval.actionable).toBe(false);
      expect(approval.requiredCapability).toBeUndefined();
      expect(approval.requiredLevel).toBeUndefined();
      // Falls back to the run's own objective rather than inventing a summary.
      expect(approval.summary).toBe("Inconsistent run.");
    });

    it("leaves optional metadata absent rather than defaulted", async () => {
      const user = await createTestUser();
      await db.experiment.create({
        data: {
          userId: user.id,
          hypothesis: "Parked with no recorded reason.",
          executionStatus: "AWAITING_HUMAN",
        },
      });
      const [approval] = await listPendingApprovals(user.id);
      expect(approval.reason).toBeUndefined();
      expect(approval.actionType).toBeUndefined();
      expect(approval.requiredCapability).toBeUndefined();
      // requestedAt still real: it falls back to the row's own updatedAt.
      expect(approval.requestedAt).toBeInstanceOf(Date);
    });
  });

  describe("proposal registry coverage (H-4 is NOT resolved by this)", () => {
    it("every registered handler has a policy classification", () => {
      const unclassified = Object.keys(ACTION_HANDLERS).filter(
        (actionType) => !classifyAction("proposal", actionType).known
      );
      expect(unclassified).toEqual([]);
    });

    it("has no classification for a handler that does not exist", () => {
      const orphans = Object.keys(PROPOSAL_ACTION_CLASSIFICATIONS).filter(
        (actionType) => !Object.prototype.hasOwnProperty.call(ACTION_HANDLERS, actionType)
      );
      expect(orphans).toEqual([]);
    });

    it("still rejects an unknown actionType at approval time", async () => {
      const user = await createTestUser();
      await grantPermission(user.id, "cognition.test", "RECOMMEND");
      const proposal = await createProposal({
        userId: user.id,
        observation: "o",
        suggestedAction: "Do something nobody implemented.",
        actionType: "not.a.registered.handler",
        actionPayload: {},
        capability: "cognition.test",
      });
      const result = await approveProposal(user.id, proposal.id);
      expect(result?.status).toBe("FAILED");
      expect(result?.result).toContain("No handler registered");
      // And it leaves the queue, because its underlying status changed.
      expect(await listPendingApprovals(user.id)).toEqual([]);
    });
  });
});
