import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { createMemory, listMemories, getSemanticMemories } from "@/lib/memory/service";
import { createMemoryRelation, listMemoryRelations, supersedeMemory } from "@/lib/memory/relations";
import { checkForContradictions, parseContradictionResponse } from "@/lib/memory/contradictions";
import { ensureMemoryEmbedding } from "@/lib/memory/embeddings";
import type { AIProvider, GenerateResult, StreamEvent } from "@/lib/ai/types";
import { createTestUser } from "./helpers";

describe("semantic memory retrieval", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("computes and caches an embedding when a memory is created", async () => {
    const memory = await createMemory({ userId, content: "Ethan owns a Pokemon trading card shop", category: "FACT" });
    const row = await db.memoryEmbedding.findUnique({ where: { memoryId: memory.id } });
    expect(row).not.toBeNull();
    expect(row?.dimensions).toBeGreaterThan(0);
    expect(JSON.parse(row?.vector ?? "[]")).toHaveLength(row?.dimensions ?? 0);
  });

  it("ensureMemoryEmbedding is idempotent for an unchanged provider", async () => {
    const memory = await createMemory({ userId, content: "Idempotent embedding check", category: "FACT" });
    const first = await ensureMemoryEmbedding(memory.id, "Idempotent embedding check");
    const second = await ensureMemoryEmbedding(memory.id, "Idempotent embedding check");
    expect(first).toEqual(second);
  });

  it("ranks semantically relevant memories above unrelated ones", async () => {
    const user = await createTestUser();
    await createMemory({ userId: user.id, content: "Ethan runs a Pokemon trading card shop", category: "FACT" });
    await createMemory({ userId: user.id, content: "Ethan enjoys cooking pasta on weekends", category: "PREFERENCE" });

    const results = await getSemanticMemories(user.id, "how is the Pokemon card business doing?", 5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("Pokemon");
  });

  it("re-embeds a memory when its content is updated", async () => {
    const memory = await createMemory({ userId, content: "Original content about tea", category: "FACT" });
    const before = await db.memoryEmbedding.findUnique({ where: { memoryId: memory.id } });

    const { updateMemory } = await import("@/lib/memory/service");
    await updateMemory(userId, memory.id, { content: "Completely different content about spreadsheets" });
    const after = await db.memoryEmbedding.findUnique({ where: { memoryId: memory.id } });

    expect(after?.vector).not.toBe(before?.vector);
  });
});

describe("memory relations and supersession", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("creates an explicit relation between two memories", async () => {
    const a = await createMemory({ userId, content: "Memory A", category: "FACT" });
    const b = await createMemory({ userId, content: "Memory B", category: "FACT" });

    const relation = await createMemoryRelation({ userId, fromMemoryId: a.id, toMemoryId: b.id, type: "RELATES_TO" });
    expect(relation?.type).toBe("RELATES_TO");

    const relations = await listMemoryRelations(userId, a.id);
    expect(relations.some((r) => r.id === relation?.id)).toBe(true);
  });

  it("returns null when either memory doesn't belong to the user", async () => {
    const a = await createMemory({ userId, content: "Owner-only A", category: "FACT" });
    const otherUser = await createTestUser();
    const foreign = await createMemory({ userId: otherUser.id, content: "Not yours", category: "FACT" });

    const relation = await createMemoryRelation({ userId, fromMemoryId: a.id, toMemoryId: foreign.id, type: "RELATES_TO" });
    expect(relation).toBeNull();
  });

  it("supersession marks the old memory and excludes it from default retrieval", async () => {
    const oldMemory = await createMemory({ userId, content: "Old preference: prefers tea", category: "PREFERENCE" });
    const newMemory = await createMemory({ userId, content: "Updated preference: prefers coffee now", category: "PREFERENCE" });

    await supersedeMemory(userId, newMemory.id, oldMemory.id, "user corrected this");

    const active = await listMemories(userId);
    expect(active.some((m) => m.id === oldMemory.id)).toBe(false);
    expect(active.some((m) => m.id === newMemory.id)).toBe(true);

    const withSuperseded = await listMemories(userId, { includeSuperseded: true });
    const supersededRow = withSuperseded.find((m) => m.id === oldMemory.id);
    expect(supersededRow?.supersededAt).toBeInstanceOf(Date);
  });
});

class FakeContradictionAIProvider implements AIProvider {
  readonly id = "fake";
  readonly defaultModel = "fake-1";
  constructor(private readonly response: { contradicts: boolean; explanation: string }) {}

  async generate(): Promise<GenerateResult> {
    return {
      content: JSON.stringify(this.response),
      toolCalls: [],
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 10 },
      model: this.defaultModel,
      provider: this.id,
    };
  }

  async *stream(): AsyncGenerator<StreamEvent, void, unknown> {
    yield { type: "message_stop", stopReason: "end_turn", usage: { inputTokens: 0, outputTokens: 0 }, model: this.defaultModel };
  }
}

describe("contradiction detection", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("parseContradictionResponse extracts a well-formed JSON verdict", () => {
    expect(parseContradictionResponse('{"contradicts": true, "explanation": "conflict"}')).toEqual({
      contradicts: true,
      explanation: "conflict",
    });
  });

  it("parseContradictionResponse tolerates surrounding prose", () => {
    const text = 'Sure, here is my answer:\n{"contradicts": false, "explanation": "no conflict"}\nThanks!';
    expect(parseContradictionResponse(text)).toEqual({ contradicts: false, explanation: "no conflict" });
  });

  it("parseContradictionResponse returns null for malformed or missing-field text", () => {
    expect(parseContradictionResponse("not json at all")).toBeNull();
    expect(parseContradictionResponse('{"explanation": "missing the boolean"}')).toBeNull();
  });

  it("creates a Proposal (never a direct MemoryRelation) when the model reports a contradiction", async () => {
    const a = await createMemory({ userId, content: "Ethan's favorite drink is tea", category: "PREFERENCE" });
    const b = await createMemory({ userId, content: "Ethan's favorite drink is coffee", category: "PREFERENCE" });

    const fakeProvider = new FakeContradictionAIProvider({ contradicts: true, explanation: "Conflicting favorite drink." });
    const proposals = await checkForContradictions(userId, a.id, { aiProvider: fakeProvider });

    expect(proposals.length).toBeGreaterThan(0);
    const proposal = proposals[0]!;
    expect(proposal.status).toBe("PROPOSED");
    expect(proposal.actionType).toBe("memory.create_relation");
    expect(JSON.parse(proposal.actionPayload)).toMatchObject({ type: "CONTRADICTS" });

    const relations = await listMemoryRelations(userId, b.id);
    expect(relations.some((r) => r.type === "CONTRADICTS")).toBe(false); // not written directly
  });

  it("creates no proposal when the model reports no contradiction", async () => {
    const a = await createMemory({ userId, content: "Ethan likes hiking on weekends variant one", category: "PREFERENCE" });
    const b = await createMemory({ userId, content: "Ethan likes hiking on weekends variant two", category: "PREFERENCE" });
    void b;

    const fakeProvider = new FakeContradictionAIProvider({ contradicts: false, explanation: "" });
    const proposals = await checkForContradictions(userId, a.id, { aiProvider: fakeProvider });
    expect(proposals).toHaveLength(0);
  });

  it("with the default mock provider (unparseable echo), safely creates no proposal", async () => {
    const a = await createMemory({ userId, content: "Distinctive statement one about scheduling", category: "FACT" });
    await createMemory({ userId, content: "Distinctive statement two about scheduling", category: "FACT" });

    const proposals = await checkForContradictions(userId, a.id);
    expect(proposals).toHaveLength(0);
  });
});
