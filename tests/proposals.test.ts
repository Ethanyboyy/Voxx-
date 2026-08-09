import { describe, it, expect, beforeAll } from "vitest";
import { createProposal, approveProposal, denyProposal, listProposals } from "@/lib/cognition/proposals";
import { PermissionDeniedError, grantPermission } from "@/lib/permissions/service";
import { createTestUser } from "./helpers";

describe("cognition proposal engine", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("always starts PROPOSED — nothing executes at creation time", async () => {
    const proposal = await createProposal({
      userId,
      observation: "Observed something.",
      suggestedAction: "Do something.",
      actionType: "task.create",
      actionPayload: { title: "Follow up" },
      capability: "cognition.proposal.test",
    });
    expect(proposal.status).toBe("PROPOSED");

    const listed = await listProposals(userId);
    expect(listed.some((p) => p.id === proposal.id)).toBe(true);
  });

  it("approveProposal denies execution when the capability isn't granted (default policy)", async () => {
    const proposal = await createProposal({
      userId,
      observation: "Observed something consequential.",
      suggestedAction: "Do the consequential thing.",
      actionType: "task.create",
      actionPayload: { title: "Should not be created" },
      capability: "cognition.proposal.gated-action",
      requiredLevel: "RECOMMEND",
    });

    await expect(approveProposal(userId, proposal.id)).rejects.toBeInstanceOf(PermissionDeniedError);

    const stillProposed = await listProposals(userId);
    const found = stillProposed.find((p) => p.id === proposal.id);
    expect(found?.status).toBe("PROPOSED");
  });

  it("approveProposal executes the registered handler once granted, and records a result", async () => {
    await grantPermission(userId, "cognition.proposal.create-task", "RECOMMEND");
    const proposal = await createProposal({
      userId,
      observation: "Noticed a follow-up is needed.",
      connection: "Connected it to the open item.",
      implication: "Possible implication: this will be forgotten.",
      suggestedAction: "Create a follow-up task.",
      actionType: "task.create",
      actionPayload: { title: "Proposal-created task" },
      capability: "cognition.proposal.create-task",
      requiredLevel: "RECOMMEND",
    });

    const executed = await approveProposal(userId, proposal.id);
    expect(executed?.status).toBe("EXECUTED");
    expect(executed?.result).toContain("Proposal-created task");
    expect(executed?.resolvedAt).toBeInstanceOf(Date);
  });

  it("approveProposal marks FAILED for an unregistered actionType, after permission passes", async () => {
    await grantPermission(userId, "cognition.proposal.unknown-action", "RECOMMEND");
    const proposal = await createProposal({
      userId,
      observation: "x",
      suggestedAction: "y",
      actionType: "integration.nonexistent.send",
      actionPayload: {},
      capability: "cognition.proposal.unknown-action",
      requiredLevel: "RECOMMEND",
    });

    const result = await approveProposal(userId, proposal.id);
    expect(result?.status).toBe("FAILED");
    expect(result?.result).toMatch(/no handler/i);
  });

  it("denyProposal marks DENIED and records the reason without executing anything", async () => {
    const proposal = await createProposal({
      userId,
      observation: "x",
      suggestedAction: "y",
      actionType: "task.create",
      actionPayload: { title: "Should never exist" },
      capability: "cognition.proposal.deny-test",
    });

    const denied = await denyProposal(userId, proposal.id, "not relevant right now");
    expect(denied?.status).toBe("DENIED");
    expect(denied?.result).toBe("not relevant right now");
  });

  it("approving or denying an already-resolved proposal is a no-op", async () => {
    const proposal = await createProposal({
      userId,
      observation: "x",
      suggestedAction: "y",
      actionType: "task.create",
      actionPayload: { title: "no-op test" },
      capability: "cognition.proposal.noop-test",
    });
    await denyProposal(userId, proposal.id);

    const secondDeny = await denyProposal(userId, proposal.id, "second reason");
    expect(secondDeny?.status).toBe("DENIED");
    expect(secondDeny?.result).not.toBe("second reason");
  });

  it("returns null for a proposal that doesn't exist or isn't the caller's", async () => {
    expect(await approveProposal(userId, "not-a-real-id")).toBeNull();
    expect(await denyProposal(userId, "not-a-real-id")).toBeNull();

    const otherUser = await createTestUser();
    const proposal = await createProposal({
      userId: otherUser.id,
      observation: "x",
      suggestedAction: "y",
      actionType: "task.create",
      actionPayload: { title: "not yours" },
      capability: "cognition.proposal.cross-user",
    });
    expect(await approveProposal(userId, proposal.id)).toBeNull();
  });
});
