import { describe, it, expect, beforeAll } from "vitest";
import { buildSystemPrompt, createConversation, addMessage, getConversation } from "@/lib/chat/service";
import { createMemory } from "@/lib/memory/service";
import { createTestUser } from "./helpers";

describe("chat context assembly", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("returns an explicit 'none yet' prompt and empty trace when there are no memories", async () => {
    const user = await createTestUser();
    const { prompt, trace } = await buildSystemPrompt(user.id, "hello");
    expect(prompt).toContain("none yet");
    expect(trace.memoriesUsed).toHaveLength(0);
  });

  it("ranks by semantic relevance and records exactly what fed the prompt in the trace", async () => {
    await createMemory({ userId, content: "Ethan runs a online shop", category: "FACT" });
    await createMemory({ userId, content: "Ethan enjoys long distance running", category: "PREFERENCE" });

    const { prompt, trace } = await buildSystemPrompt(userId, "how is the online shop business doing?");
    expect(prompt).toContain("online shop");
    expect(trace.memoriesUsed.length).toBeGreaterThan(0);
    expect(trace.memoriesUsed[0].content).toContain("online shop");
    expect(trace.memoriesUsed[0].similarity).toBeGreaterThan(0);
  });

  it("always includes CONFIRMED facts even if not topically similar to the query", async () => {
    const user = await createTestUser();
    await createMemory({ userId: user.id, content: "Ethan's business is called Pikachu's Card Corner", category: "FACT", confidence: "CONFIRMED" });

    const { trace } = await buildSystemPrompt(user.id, "what's a good recipe for banana bread?");
    expect(trace.memoriesUsed.some((m) => m.content.includes("Pikachu's Card Corner"))).toBe(true);
  });

  it("addMessage persists structured meta (e.g. a context trace) and getConversation returns it decodable", async () => {
    const conversation = await createConversation(userId, "Test conversation");
    await addMessage(conversation.id, "ASSISTANT", "Here's my answer.", {
      meta: { context: { memoriesUsed: [{ id: "m1", content: "snippet", confidence: "LOW", similarity: 0.5 }], assumptions: [] } },
    });

    const loaded = await getConversation(userId, conversation.id);
    const assistantMessage = loaded?.messages.find((m) => m.role === "ASSISTANT");
    expect(assistantMessage?.meta).toBeTruthy();
    const parsed = JSON.parse(assistantMessage!.meta!);
    expect(parsed.context.memoriesUsed[0].content).toBe("snippet");
  });
});
