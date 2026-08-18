import { describe, it, expect, beforeAll } from "vitest";
import { createSuit } from "@/lib/lab/suits";
import { createComponent } from "@/lib/lab/components";
import { proposeExperiment } from "@/lib/lab/engineeringProposals";
import { approveProposal, denyProposal } from "@/lib/cognition/proposals";
import { grantPermission } from "@/lib/permissions/service";
import { listExperiments } from "@/lib/lab/experiments";
import { createTestUser } from "./helpers";
import type { SuitStatsInput } from "@/lib/lab/suits";

const SAMPLE_STATS: SuitStatsInput = {
  stealth: 70, durability: 50, mobility: 60, stretchiness: 55, weightKg: 4, thermalLoadC: 30,
  protection: 45, environmentalResistance: 50, manufacturingComplexity: 55, estimatedBuildHours: 120,
  estimatedCostUsd: 28000, flexibility: 55, impactResistance: 40, visibility: 25, noiseProfile: 20,
  sensorCapacity: 50, energyRequirementW: 16, maintenanceComplexity: 40,
};

describe("engineering proposals: structured Lab reasoning through the real Proposal engine", () => {
  let userId: string;
  let suitId: string;
  let componentId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
    const suit = await createSuit({ userId, codename: "Proposal Test Suit", archetype: "Tactical", stats: SAMPLE_STATS });
    suitId = suit.id;
    const component = await createComponent({
      suitId,
      name: "Experimental Web Shooter",
      riskLevel: "HIGH",
      realityStatus: "CONCEPT",
      powerDrawW: 40,
      costUsd: 900,
    });
    componentId = component.id;
  });

  it("proposeExperiment creates a real PROPOSED proposal — never a LabExperiment directly", async () => {
    const proposal = await proposeExperiment({
      userId,
      suitId,
      componentId,
      title: "Validate Experimental Web Shooter",
      hypothesis: "Reducing nozzle diameter by 10% increases web tensile strength without raising power draw.",
      bottleneck: "The web shooter is unvalidated and flagged HIGH risk.",
      objective: "Establish whether the shooter performs as recorded before relying on it.",
      approach: "Run a controlled test against the recorded 40W draw and log the outcome.",
      risk: "Recorded risk level is HIGH.",
      costEstimateUsd: 900,
      confidence: "HYPOTHETICAL",
    });

    expect(proposal.status).toBe("PROPOSED");
    expect(proposal.actionType).toBe("lab.create_experiment");
    expect(proposal.capability).toBe("lab.experiment.write");
    expect(proposal.requiredLevel).toBe("RECOMMEND");
    expect(proposal.confidence).toBe("LOW");
    expect(proposal.observation).toContain("HIGH risk");
    expect(proposal.suggestedAction).toContain("Estimated cost: $900");

    const payload = JSON.parse(proposal.actionPayload);
    expect(payload.title).toBe("Validate Experimental Web Shooter");
    expect(payload.componentId).toBe(componentId);
    expect(payload.suitId).toBe(suitId);

    // No LabExperiment exists yet — proposing is not executing.
    const experiments = await listExperiments(userId);
    expect(experiments.find((e) => e.title === "Validate Experimental Web Shooter")).toBeUndefined();
  });

  it("approving without the capability granted throws and creates no experiment", async () => {
    const user = await createTestUser();
    const proposal = await proposeExperiment({
      userId: user.id,
      title: "Ungranted test",
      hypothesis: "Some hypothesis.",
      bottleneck: "Some bottleneck.",
      objective: "Some objective.",
      approach: "Some approach.",
    });

    await expect(approveProposal(user.id, proposal.id)).rejects.toThrow(/requires level RECOMMEND/);

    const experiments = await listExperiments(user.id);
    expect(experiments.find((e) => e.title === "Ungranted test")).toBeUndefined();
  });

  it("approving a granted proposal runs the real handler and creates the actual LabExperiment", async () => {
    const user = await createTestUser();
    const suit = await createSuit({ userId: user.id, codename: "Grant Test Suit", archetype: "Combat", stats: SAMPLE_STATS });
    const component = await createComponent({ suitId: suit.id, name: "Kinetic Dampener", riskLevel: "MODERATE" });

    const proposal = await proposeExperiment({
      userId: user.id,
      suitId: suit.id,
      componentId: component.id,
      title: "Validate Kinetic Dampener",
      hypothesis: "The dampener reduces peak impact load by at least 20%.",
      bottleneck: "The dampener has not been tested under load.",
      objective: "Confirm the dampener's recorded impact reduction.",
      approach: "Run a controlled impact test and log the result.",
      confidence: "ESTIMATED",
    });

    await grantPermission(user.id, "lab.experiment.write", "RECOMMEND");
    const executed = await approveProposal(user.id, proposal.id);

    expect(executed?.status).toBe("EXECUTED");
    expect(executed?.result).toContain("Validate Kinetic Dampener");

    const experiments = await listExperiments(user.id);
    const created = experiments.find((e) => e.title === "Validate Kinetic Dampener");
    expect(created).toBeDefined();
    expect(created?.componentId).toBe(component.id);
    expect(created?.suitId).toBe(suit.id);
    expect(created?.confidence).toBe("ESTIMATED");
  });

  it("denying a proposal never creates a LabExperiment", async () => {
    const user = await createTestUser();
    const proposal = await proposeExperiment({
      userId: user.id,
      title: "Should never execute",
      hypothesis: "Irrelevant.",
      bottleneck: "Irrelevant.",
      objective: "Irrelevant.",
      approach: "Irrelevant.",
    });

    const denied = await denyProposal(user.id, proposal.id, "Not a priority right now.");
    expect(denied?.status).toBe("DENIED");

    const experiments = await listExperiments(user.id);
    expect(experiments.find((e) => e.title === "Should never execute")).toBeUndefined();
  });
});
