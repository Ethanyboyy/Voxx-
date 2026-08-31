import { describe, it, expect } from "vitest";
import { getTool, listTools } from "@/lib/tools/registry";
import { createTestUser } from "./helpers";

describe("tool registry", () => {
  it("lists every registered tool with a discoverable shape", () => {
    const tools = listTools();
    expect(tools.length).toBeGreaterThan(0);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.capability).toBeTruthy();
      expect(tool.requiredLevel).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
    }
    expect(tools.map((t) => t.name)).toContain("memory.search");
    expect(tools.map((t) => t.name)).toContain("task.create");
  });

  it("getTool returns undefined for an unregistered name", () => {
    expect(getTool("not.a.real.tool")).toBeUndefined();
  });

  it("external/integration tools require RECOMMEND or above — never default-allowed", () => {
    for (const tool of listTools()) {
      if (tool.category === "external") {
        expect(["RECOMMEND", "ASK", "ACT"], `${tool.name} is external`).toContain(tool.requiredLevel);
      }
    }
  });

  it("gates the capability tools on egress and spend, not on how cheap they are", () => {
    // Media generation spends money at a third party AND uploads user content.
    expect(getTool("media.image.generate")!.requiredLevel).toBe("ACT");
    expect(getTool("media.video.generate")!.requiredLevel).toBe("ACT");
    // Visual QA only spends tokens — but it still uploads the user's image to
    // a third-party API, so it must not sit at the default-granted ANALYZE.
    expect(getTool("qa.visual_review")!.requiredLevel).toBe("RECOMMEND");
    expect(getTool("qa.visual_review")!.category).toBe("external");
  });

  it("calendar tools report a clear 'not configured' error instead of faking a result", async () => {
    const user = await createTestUser();
    const listEvents = getTool("calendar.list_events");
    expect(listEvents).toBeDefined();
    await expect(listEvents!.execute(user.id, { rangeDays: 7 } as never)).rejects.toThrow(/not connected/i);

    const createEvent = getTool("calendar.create_event");
    expect(createEvent).toBeDefined();
    await expect(
      createEvent!.execute(user.id, { title: "x", startsAt: "2026-01-01", endsAt: "2026-01-01" } as never)
    ).rejects.toThrow(/not connected/i);
  });
});
