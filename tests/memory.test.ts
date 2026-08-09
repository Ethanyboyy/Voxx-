import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import { createMemory, listMemories, getMemory, updateMemory, deleteMemory, exportMemories } from "@/lib/memory/service";
import { createTestUser } from "./helpers";

describe("memory service", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("creates a memory and stores content encrypted at rest", async () => {
    const memory = await createMemory({
      userId,
      content: "Ethan owns a Pokemon card shop",
      category: "FACT",
      confidence: "HIGH",
    });

    expect(memory.content).toBe("Ethan owns a Pokemon card shop");
    expect(memory.confidence).toBe("HIGH");

    const raw = await db.memory.findUniqueOrThrow({ where: { id: memory.id } });
    expect(raw.content).not.toBe("Ethan owns a Pokemon card shop");
    expect(raw.content.split(":").length).toBe(3); // iv:authTag:ciphertext
  });

  it("defaults confidence to MEDIUM and never silently promotes to CONFIRMED", async () => {
    const memory = await createMemory({ userId, content: "Might be relevant later", category: "INFERENCE" });
    expect(memory.confidence).toBe("MEDIUM");
    expect(memory.category).toBe("INFERENCE");
  });

  it("lists memories for the owning user only, most recent first", async () => {
    const otherUser = await createTestUser();
    await createMemory({ userId: otherUser.id, content: "Not visible to userId", category: "FACT" });
    const a = await createMemory({ userId, content: "First", category: "FACT" });
    const b = await createMemory({ userId, content: "Second", category: "FACT" });

    const memories = await listMemories(userId);
    expect(memories.some((m) => m.content === "Not visible to userId")).toBe(false);
    const ids = memories.map((m) => m.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
  });

  it("filters by category, confidence, and free-text search", async () => {
    await createMemory({ userId, content: "Prefers dark roast coffee", category: "PREFERENCE", confidence: "CONFIRMED" });
    const byCategory = await listMemories(userId, { category: "PREFERENCE" });
    expect(byCategory.every((m) => m.category === "PREFERENCE")).toBe(true);

    const byConfidence = await listMemories(userId, { confidence: "CONFIRMED" });
    expect(byConfidence.every((m) => m.confidence === "CONFIRMED")).toBe(true);

    const bySearch = await listMemories(userId, { search: "dark roast" });
    expect(bySearch.some((m) => m.content.includes("dark roast"))).toBe(true);
  });

  it("gets a single memory scoped to its owner", async () => {
    const memory = await createMemory({ userId, content: "Scoped fetch test", category: "FACT" });
    const otherUser = await createTestUser();

    expect(await getMemory(userId, memory.id)).not.toBeNull();
    expect(await getMemory(otherUser.id, memory.id)).toBeNull();
  });

  it("updates content and confidence explicitly (never implicitly)", async () => {
    const memory = await createMemory({ userId, content: "Draft note", category: "IDEA", confidence: "LOW" });
    const updated = await updateMemory(userId, memory.id, { content: "Confirmed note", confidence: "CONFIRMED" });

    expect(updated?.content).toBe("Confirmed note");
    expect(updated?.confidence).toBe("CONFIRMED");

    // Untouched fields survive a partial update.
    const untouched = await updateMemory(userId, memory.id, { provenance: "user confirmed in chat" });
    expect(untouched?.content).toBe("Confirmed note");
    expect(untouched?.provenance).toBe("user confirmed in chat");
  });

  it("returns null when updating a memory that doesn't belong to the user", async () => {
    const memory = await createMemory({ userId, content: "Owner-only", category: "FACT" });
    const otherUser = await createTestUser();
    const result = await updateMemory(otherUser.id, memory.id, { content: "hijacked" });
    expect(result).toBeNull();
  });

  it("deletes a memory and reports false for a memory that isn't there", async () => {
    const memory = await createMemory({ userId, content: "To be deleted", category: "FACT" });
    expect(await deleteMemory(userId, memory.id)).toBe(true);
    expect(await getMemory(userId, memory.id)).toBeNull();
    expect(await deleteMemory(userId, memory.id)).toBe(false);
  });

  it("exports memories in plaintext for the owning user", async () => {
    const user = await createTestUser();
    await createMemory({ userId: user.id, content: "Export me", category: "FACT" });
    const exported = await exportMemories(user.id);
    expect(exported.some((m) => m.content === "Export me")).toBe(true);
  });

  it("attaches a MemorySource when provided", async () => {
    const memory = await createMemory({
      userId,
      content: "From a conversation",
      category: "FACT",
      source: { type: "CONVERSATION", reference: "chat about shop" },
    });
    expect(memory.source).toEqual(
      expect.objectContaining({ type: "CONVERSATION", reference: "chat about shop" })
    );
  });
});
