import { describe, it, expect } from "vitest";
import { getCrossDomainSnapshot, summarizeCrossDomainSnapshot } from "@/lib/orchestrator/service";
import { createProposal } from "@/lib/cognition/proposals";
import { createTestUser } from "./helpers";

describe("orchestrator: cross-domain snapshot", () => {
  it("returns a real, mostly-empty snapshot for a fresh user — never fabricates activity", async () => {
    const user = await createTestUser();
    const snapshot = await getCrossDomainSnapshot(user.id);

    expect(snapshot.brainState.state).toBe("idle");
    expect(snapshot.pendingProposalCount).toBe(0);
    expect(snapshot.lab.suits).toBe(0);
    expect(snapshot.lab.activeExperiments).toBe(0);
    expect(snapshot.lab.mostRecentSuitCodename).toBeNull();
    expect(snapshot.activeObjective).toBeNull();
  });

  it("reflects a real pending proposal in the count and the brain state", async () => {
    const user = await createTestUser();
    await createProposal({
      userId: user.id,
      observation: "Test observation",
      suggestedAction: "Do the thing",
      actionType: "memory.create_relation",
      actionPayload: {},
      capability: "test.capability",
    });

    const snapshot = await getCrossDomainSnapshot(user.id);
    expect(snapshot.pendingProposalCount).toBe(1);
    // A pending proposal is one of the real signals getBrainState() surfaces as "waiting".
    expect(snapshot.brainState.state).toBe("waiting");
  });

  it("summarizeCrossDomainSnapshot returns empty string when there is nothing worth surfacing", async () => {
    const user = await createTestUser();
    const snapshot = await getCrossDomainSnapshot(user.id);
    expect(summarizeCrossDomainSnapshot(snapshot)).toBe("");
  });

  it("summarizeCrossDomainSnapshot mentions the real pending-proposal count when present", async () => {
    const user = await createTestUser();
    await createProposal({
      userId: user.id,
      observation: "Test observation",
      suggestedAction: "Do the thing",
      actionType: "memory.create_relation",
      actionPayload: {},
      capability: "test.capability",
    });

    const snapshot = await getCrossDomainSnapshot(user.id);
    const summary = summarizeCrossDomainSnapshot(snapshot);
    expect(summary).toContain("1 proposal(s) awaiting the user's approval");
  });
});
