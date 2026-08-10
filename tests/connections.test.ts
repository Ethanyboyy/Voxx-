import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { db } from "@/lib/db";
import {
  listConnections,
  getConnection,
  proposeConnection,
  approveConnection,
  grantAccess,
  pauseConnection,
  resumeConnection,
  revokeConnection,
  deleteCachedData,
  storeCredential,
  getDecryptedCachedItems,
} from "@/lib/connections/service";
import { createProposal, approveProposal } from "@/lib/cognition/proposals";
import { PermissionDeniedError, checkCapability, grantPermission } from "@/lib/permissions/service";
import { getCatalogEntry } from "@/lib/integrations/catalog";
import { StubConnectionProvider, getConnectionProvider } from "@/lib/integrations/stub";
import { encryptField } from "@/lib/security/crypto";
import { createTestUser } from "./helpers";

describe("Connections Hub", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("listConnections surfaces every catalog service, defaulting to NOT_CONNECTED with no row", async () => {
    const connections = await listConnections(userId);
    expect(connections.length).toBeGreaterThanOrEqual(13);
    const notion = connections.find((c) => c.catalog.service === "NOTION");
    expect(notion?.status).toBe("NOT_CONNECTED");
    expect(notion?.connection).toBeNull();
    expect(notion?.isConfigured).toBe(false);
  });

  it("proposeConnection creates a PROPOSED connection row", async () => {
    const connection = await proposeConnection(userId, "NOTION", "You mentioned Notion recently.");
    expect(connection.status).toBe("PROPOSED");
    expect(connection.statusReason).toBe("You mentioned Notion recently.");
  });

  it("approveConnection moves a connection to AWAITING_APPROVAL without granting any access", async () => {
    const connection = await approveConnection(userId, "NOTION");
    expect(connection.status).toBe("AWAITING_APPROVAL");
    expect(connection.readEnabled).toBe(false);
    expect(connection.writeEnabled).toBe(false);

    const readCheck = await checkCapability(userId, getCatalogEntry("NOTION")!.readCapability, "RECOMMEND");
    expect(readCheck.allowed).toBe(false);
  });

  it("grantAccess grants the real Permission at RECOMMEND (read) / ACT (write) and ends at ERROR since no provider is configured", async () => {
    const entry = getCatalogEntry("TODOIST")!;
    const connection = await grantAccess(userId, "TODOIST", { read: true, write: true });

    expect(connection.status).toBe("ERROR");
    expect(connection.statusReason).toMatch(/not configured/i);
    expect(connection.readEnabled).toBe(true);
    expect(connection.writeEnabled).toBe(true);

    expect((await checkCapability(userId, entry.readCapability, "RECOMMEND")).allowed).toBe(true);
    expect((await checkCapability(userId, entry.writeCapability!, "ACT")).allowed).toBe(true);
  });

  it("grantAccess throws when requesting write on a read-only-only service", async () => {
    await expect(grantAccess(userId, "QUICKBOOKS", { write: true })).rejects.toThrow(/no write mode/i);
  });

  it("pauseConnection and resumeConnection transition status without touching grants", async () => {
    await grantAccess(userId, "ETSY", { read: true });
    const paused = await pauseConnection(userId, "ETSY");
    expect(paused?.status).toBe("PAUSED");

    const resumed = await resumeConnection(userId, "ETSY");
    expect(resumed?.status).toBe("CONNECTED");

    const entry = getCatalogEntry("ETSY")!;
    expect((await checkCapability(userId, entry.readCapability, "RECOMMEND")).allowed).toBe(true);
  });

  it("revokeConnection destroys the credential row, revokes both grants, and clears enabled flags", async () => {
    const entry = getCatalogEntry("PRINTFUL")!;
    await grantAccess(userId, "PRINTFUL", { read: true, write: true });
    const connectionBefore = await getConnection(userId, "PRINTFUL");
    await storeCredential(connectionBefore!.id, { accessToken: "fake-token-for-test" });
    expect(await db.connectionCredential.findUnique({ where: { connectionId: connectionBefore!.id } })).not.toBeNull();

    const revoked = await revokeConnection(userId, "PRINTFUL");
    expect(revoked?.status).toBe("REVOKED");
    expect(revoked?.readEnabled).toBe(false);
    expect(revoked?.writeEnabled).toBe(false);
    expect(await db.connectionCredential.findUnique({ where: { connectionId: connectionBefore!.id } })).toBeNull();
    expect((await checkCapability(userId, entry.readCapability, "RECOMMEND")).allowed).toBe(false);
    expect((await checkCapability(userId, entry.writeCapability!, "ACT")).allowed).toBe(false);
  });

  it("deleteCachedData removes cached items independent of revoke, and cached payloads round-trip through encryption", async () => {
    const connection = await proposeConnection(userId, "PRINTIFY");
    await db.connectionCachedItem.create({
      data: {
        connectionId: connection.id,
        externalId: "order-1",
        kind: "order",
        payload: encryptField(JSON.stringify({ total: "42.00" })),
      },
    });

    const decrypted = await getDecryptedCachedItems(userId, "PRINTIFY");
    expect(decrypted).toHaveLength(1);
    expect(JSON.parse(decrypted[0].payload)).toEqual({ total: "42.00" });

    const result = await deleteCachedData(userId, "PRINTIFY");
    expect(result?.deleted).toBe(1);
    expect(await getDecryptedCachedItems(userId, "PRINTIFY")).toHaveLength(0);

    // Connection itself is untouched by cache deletion.
    const stillThere = await getConnection(userId, "PRINTIFY");
    expect(stillThere?.status).toBe("PROPOSED");
  });

  it("returns null from lifecycle actions when no connection row exists yet", async () => {
    const freshUser = await createTestUser();
    expect(await pauseConnection(freshUser.id, "GOOGLE_FIT")).toBeNull();
    expect(await resumeConnection(freshUser.id, "GOOGLE_FIT")).toBeNull();
    expect(await revokeConnection(freshUser.id, "GOOGLE_FIT")).toBeNull();
    expect(await deleteCachedData(freshUser.id, "GOOGLE_FIT")).toBeNull();
  });

  describe("connection.propose proposal handler", () => {
    it("is permission-gated like every other proposal, and only moves the connection to AWAITING_APPROVAL on success", async () => {
      const proposalUser = await createTestUser();
      const entry = getCatalogEntry("GOOGLE_CALENDAR")!;
      await proposeConnection(proposalUser.id, "GOOGLE_CALENDAR", "You have upcoming events VOX could see.");

      const proposal = await createProposal({
        userId: proposalUser.id,
        observation: "You have upcoming events VOX could see.",
        suggestedAction: "Connect Google Calendar",
        actionType: "connection.propose",
        actionPayload: { service: "GOOGLE_CALENDAR" },
        capability: entry.readCapability,
        requiredLevel: "RECOMMEND",
      });

      await expect(approveProposal(proposalUser.id, proposal.id)).rejects.toBeInstanceOf(PermissionDeniedError);
      expect((await getConnection(proposalUser.id, "GOOGLE_CALENDAR"))?.status).toBe("PROPOSED");

      await grantPermission(proposalUser.id, entry.readCapability, "RECOMMEND");
      const executed = await approveProposal(proposalUser.id, proposal.id);
      expect(executed?.status).toBe("EXECUTED");
      expect(executed?.result).toMatch(/awaiting your approval/i);

      const connection = await getConnection(proposalUser.id, "GOOGLE_CALENDAR");
      expect(connection?.status).toBe("AWAITING_APPROVAL");
      // Approving the suggestion never grants real access by itself.
      expect(connection?.readEnabled).toBe(false);
    });
  });

  describe("StubConnectionProvider", () => {
    const ENV_VAR = "GOOGLE_MAPS_API_KEY";
    const original = process.env[ENV_VAR];

    afterEach(() => {
      if (original === undefined) delete process.env[ENV_VAR];
      else process.env[ENV_VAR] = original;
    });

    it("reports isConfigured: false with no env vars set, and throws on any connect attempt", () => {
      delete process.env[ENV_VAR];
      const provider = getConnectionProvider("GOOGLE_MAPS");
      expect(provider.isConfigured).toBe(false);
      expect(() => provider.getAuthorizationUrl("state")).toThrow();
      expect(provider.exchangeCode("code")).rejects.toThrow();
    });

    it("reports isConfigured: true only once every required env var is present", () => {
      process.env[ENV_VAR] = "fake-key-for-test";
      const provider = new StubConnectionProvider("GOOGLE_MAPS");
      expect(provider.isConfigured).toBe(true);
      // Still never a real connect — the class itself always throws.
      expect(() => provider.getAuthorizationUrl("state")).toThrow();
    });

    it("Apple Health has no required env vars, so it can never report isConfigured: true", () => {
      const provider = getConnectionProvider("APPLE_HEALTH");
      expect(provider.isConfigured).toBe(false);
    });
  });
});
