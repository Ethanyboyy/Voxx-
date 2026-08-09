import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/lib/db";
import {
  checkCapability,
  enforceCapability,
  grantPermission,
  revokePermission,
  listPermissions,
  PermissionDeniedError,
} from "@/lib/permissions/service";
import { createTestUser } from "./helpers";

describe("permission system", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("allows OBSERVE and ANALYZE by default with no Permission row", async () => {
    const observe = await checkCapability(userId, "some.capability", "OBSERVE");
    const analyze = await checkCapability(userId, "some.capability", "ANALYZE");
    expect(observe.allowed).toBe(true);
    expect(analyze.allowed).toBe(true);
    expect(observe.isDefault).toBe(true);
  });

  it("denies RECOMMEND/ASK/ACT by default", async () => {
    const recommend = await checkCapability(userId, "integration.example.send", "RECOMMEND");
    const act = await checkCapability(userId, "integration.example.send", "ACT");
    expect(recommend.allowed).toBe(false);
    expect(act.allowed).toBe(false);
  });

  it("enforceCapability throws PermissionDeniedError for a denied capability", async () => {
    await expect(enforceCapability(userId, "integration.example.send", "ACT")).rejects.toBeInstanceOf(
      PermissionDeniedError
    );
  });

  it("records an audit Event for consequential (RECOMMEND+) checks, granted or denied", async () => {
    const before = await db.event.count({ where: { userId, type: "permission.check.denied" } });
    await enforceCapability(userId, "integration.example.send", "ACT").catch(() => undefined);
    const after = await db.event.count({ where: { userId, type: "permission.check.denied" } });
    expect(after).toBe(before + 1);
  });

  it("does not audit-log plain OBSERVE/ANALYZE checks", async () => {
    const before = await db.event.count({ where: { userId } });
    await enforceCapability(userId, "research.web", "ANALYZE");
    const after = await db.event.count({ where: { userId } });
    expect(after).toBe(before);
  });

  it("grantPermission allows a previously-denied capability and is reflected in listPermissions", async () => {
    await grantPermission(userId, "integration.example.send", "ACT");
    const check = await checkCapability(userId, "integration.example.send", "ACT");
    expect(check.allowed).toBe(true);

    const permissions = await listPermissions(userId);
    const entry = permissions.find((p) => p.capability === "integration.example.send");
    expect(entry?.granted).toBe(true);
    expect(entry?.level).toBe("ACT");
  });

  it("revokePermission removes a previously-granted elevated capability", async () => {
    await grantPermission(userId, "integration.other.send", "ACT");
    expect((await checkCapability(userId, "integration.other.send", "ACT")).allowed).toBe(true);

    await revokePermission(userId, "integration.other.send");
    expect((await checkCapability(userId, "integration.other.send", "ACT")).allowed).toBe(false);
  });

  it("granting/revoking writes audit events", async () => {
    const grantEvents = await db.event.count({ where: { userId, type: "permission.granted" } });
    const revokeEvents = await db.event.count({ where: { userId, type: "permission.revoked" } });
    expect(grantEvents).toBeGreaterThan(0);
    expect(revokeEvents).toBeGreaterThan(0);
  });
});
