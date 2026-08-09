import { describe, it, expect } from "vitest";
import { z } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/api/helpers";
import { PermissionDeniedError } from "@/lib/permissions/service";
import { createMemorySchema, createTaskSchema, loginSchema } from "@/lib/validation/schemas";

// Route handlers call `cookies()` (next/headers), which only works inside a
// real Next.js request context — so the HTTP-integration path for these
// routes is covered by manual verification against the running dev server
// (see DEVELOPMENT.md). What's unit-testable, and exercised here, is the
// shared error-mapping and validation layer every route relies on.
describe("API error handling", () => {
  it("maps ApiError to its declared HTTP status and message", async () => {
    const res = apiErrorResponse(new ApiError(404, "Memory not found."));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Memory not found.");
  });

  it("maps PermissionDeniedError to 403 with capability details", async () => {
    const res = apiErrorResponse(new PermissionDeniedError("integration.example.send", "ACT"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.capability).toBe("integration.example.send");
    expect(body.requiredLevel).toBe("ACT");
  });

  it("maps a ZodError to 400 with per-field issues", async () => {
    const result = createMemorySchema.safeParse({ content: "", category: "NOT_REAL" });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("expected failure");

    const res = apiErrorResponse(result.error);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
  });

  it("maps unrecognized errors to a generic 500 without leaking internal detail", async () => {
    const res = apiErrorResponse(new Error("db connection string leaked: file:///secret"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error.");
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  it("handles non-Error throws (e.g. a raw string) without crashing", async () => {
    const res = apiErrorResponse("some raw thrown string");
    expect(res.status).toBe(500);
  });
});

describe("request validation schemas", () => {
  it("rejects an empty memory content and an invalid category", () => {
    const result = createMemorySchema.safeParse({ content: "", category: "MADE_UP" });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed memory payload with optional fields omitted", () => {
    const result = createMemorySchema.safeParse({ content: "A fact", category: "FACT" });
    expect(result.success).toBe(true);
  });

  it("coerces a date string for task due dates", () => {
    const result = createTaskSchema.safeParse({ title: "Ship it", dueDate: "2026-12-01" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.dueDate).toBeInstanceOf(Date);
  });

  it("rejects malformed login payloads (bad email, empty password)", () => {
    expect(loginSchema.safeParse({ email: "not-an-email", password: "" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.com", password: "x" }).success).toBe(true);
  });
});

describe("ApiError / zod interop", () => {
  it("a schema failure thrown as-is is recognized as a ZodError by apiErrorResponse", async () => {
    const schema = z.object({ n: z.number() });
    try {
      schema.parse({ n: "not a number" });
      throw new Error("expected parse to throw");
    } catch (error) {
      const res = apiErrorResponse(error);
      expect(res.status).toBe(400);
    }
  });
});
