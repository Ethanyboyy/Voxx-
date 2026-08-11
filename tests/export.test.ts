import { describe, it, expect, beforeAll } from "vitest";
import { exportAllData } from "@/lib/export/service";
import { createMemory } from "@/lib/memory/service";
import { createProject } from "@/lib/projects/service";
import { proposeConnection, storeCredential } from "@/lib/connections/service";
import { createTestUser } from "./helpers";

describe("full data export", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("includes real data from every subsystem", async () => {
    await createMemory({ userId, content: "Export test memory", category: "FACT" });
    await createProject({ userId, name: "Export test project" });

    const data = await exportAllData(userId);
    expect(data.exportedAt).toBeTruthy();
    expect(data.memories.some((m) => m.content === "Export test memory")).toBe(true);
    expect(data.projects.some((p) => p.name === "Export test project")).toBe(true);
    expect(data.knowledgeGraph).toHaveProperty("nodes");
    expect(data.knowledgeGraph).toHaveProperty("connections");
    expect(Array.isArray(data.conversations)).toBe(true);
    expect(Array.isArray(data.agentRuns)).toBe(true);
    expect(data.notificationPreference).toBeTruthy();
  });

  it("never includes connection credential secrets", async () => {
    const connection = await proposeConnection(userId, "NOTION", "test");
    await storeCredential(connection.id, { accessToken: "super-secret-token-value" });

    const data = await exportAllData(userId);
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain("super-secret-token-value");
    expect(serialized).not.toContain("encryptedPayload");

    const notion = data.connections.find((c) => c.service === "NOTION");
    expect(notion).toBeDefined();
    expect(notion).not.toHaveProperty("credential");
  });
});
