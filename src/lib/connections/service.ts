import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { grantPermission, revokePermission } from "@/lib/permissions/service";
import { encryptField, decryptField } from "@/lib/security/crypto";
import { CONNECTION_CATALOG, getCatalogEntry } from "@/lib/integrations/catalog";
import { getConnectionProvider } from "@/lib/integrations/stub";
import type { ConnectionService } from "@/generated/prisma/enums";

/**
 * Connections Hub — the trust/control layer every external integration must
 * pass through. See SECURITY.md and PHASE_2_ARCHITECTURE.md. Every function
 * here operates on a single user's Connection rows; nothing in this module
 * can drive a connection to CONNECTED, since that requires a real
 * ConnectionProvider (see src/lib/integrations/stub.ts, which every service
 * currently resolves to).
 */

/** Merges the static catalog with any existing Connection rows so every service always shows up, even before a row exists. */
export async function listConnections(userId: string) {
  const rows = await db.connection.findMany({
    where: { userId },
    include: { credential: { select: { id: true, expiresAt: true } }, cachedItems: { select: { id: true } } },
  });
  const byService = new Map(rows.map((row) => [row.service, row]));

  return CONNECTION_CATALOG.map((entry) => {
    const row = byService.get(entry.service);
    const provider = getConnectionProvider(entry.service);
    return {
      catalog: entry,
      connection: row ?? null,
      status: row?.status ?? "NOT_CONNECTED",
      hasCredential: Boolean(row?.credential),
      cachedItemCount: row?.cachedItems.length ?? 0,
      isConfigured: provider.isConfigured,
    };
  });
}

export async function getConnection(userId: string, service: ConnectionService) {
  return db.connection.findUnique({ where: { userId_service: { userId, service } } });
}

async function ensureConnectionRow(userId: string, service: ConnectionService) {
  const entry = getCatalogEntry(service);
  if (!entry) throw new Error(`Unknown connection service "${service}".`);

  return db.connection.upsert({
    where: { userId_service: { userId, service } },
    create: {
      userId,
      service,
      category: entry.category,
      displayName: entry.displayName,
      readCapability: entry.readCapability,
      writeCapability: entry.writeCapability,
    },
    update: {},
  });
}

/**
 * Marks a connection as PROPOSED — VOX recommending it, not connecting it.
 * This is what the `connection.propose` Proposal action handler calls; a
 * human can also trigger it directly from "Suggested Connections" in the UI.
 */
export async function proposeConnection(userId: string, service: ConnectionService, reason?: string) {
  const connection = await ensureConnectionRow(userId, service);
  const updated = await db.connection.update({
    where: { id: connection.id },
    data: { status: "PROPOSED", statusReason: reason ?? connection.statusReason },
  });
  await recordEvent({
    userId,
    type: "connection.proposed",
    subjectType: "Connection",
    subjectId: updated.id,
    payload: { service, reason },
  });
  return updated;
}

/**
 * The user approving a proposed (or freshly suggested) connection. This only
 * moves status to AWAITING_APPROVAL — it grants no access. Access is a
 * separate, explicit step (grantAccess) so "I approve considering this" and
 * "I grant read/write" stay distinct.
 */
export async function approveConnection(userId: string, service: ConnectionService) {
  const connection = await ensureConnectionRow(userId, service);
  const updated = await db.connection.update({
    where: { id: connection.id },
    data: { status: "AWAITING_APPROVAL" },
  });
  await recordEvent({
    userId,
    type: "connection.approved",
    subjectType: "Connection",
    subjectId: updated.id,
    payload: { service },
    consequential: true,
  });
  return updated;
}

/**
 * Grants read and/or write access via the same Permission system used
 * everywhere else in VOX (grantPermission/enforceCapability) — read requires
 * RECOMMEND, write requires ACT (see SECURITY.md), both outside the
 * default-allow band so nothing here is ever silently on. Then attempts the
 * actual provider connect, which — for every service today — fails with
 * "not configured" rather than reaching CONNECTED, since every provider is a
 * StubConnectionProvider until real vendor credentials are supplied.
 */
export async function grantAccess(
  userId: string,
  service: ConnectionService,
  access: { read?: boolean; write?: boolean }
) {
  const entry = getCatalogEntry(service);
  if (!entry) throw new Error(`Unknown connection service "${service}".`);
  const connection = await ensureConnectionRow(userId, service);

  if (access.read) {
    await grantPermission(userId, entry.readCapability, "RECOMMEND");
  }
  if (access.write) {
    if (!entry.writeCapability) throw new Error(`${entry.displayName} has no write mode.`);
    await grantPermission(userId, entry.writeCapability, "ACT");
  }

  const updated = await db.connection.update({
    where: { id: connection.id },
    data: {
      readEnabled: access.read ? true : connection.readEnabled,
      writeEnabled: access.write ? true : connection.writeEnabled,
      status: "CONNECTING",
    },
  });
  await recordEvent({
    userId,
    type: "connection.access_granted",
    subjectType: "Connection",
    subjectId: updated.id,
    payload: { service, read: Boolean(access.read), write: Boolean(access.write) },
    consequential: true,
  });

  const provider = getConnectionProvider(service);
  if (!provider.isConfigured) {
    const failed = await db.connection.update({
      where: { id: connection.id },
      data: { status: "ERROR", statusReason: `${entry.displayName} is not configured yet — no real credentials are set.` },
    });
    await recordEvent({
      userId,
      type: "connection.connect_failed",
      subjectType: "Connection",
      subjectId: updated.id,
      payload: { service, reason: "not_configured" },
    });
    return failed;
  }

  // Unreachable today (isConfigured is always false), but kept explicit
  // rather than silently swallowed — a real provider would exchange a code
  // here, encrypt it, and flip status to CONNECTED.
  throw new Error(`${entry.displayName}: no real OAuth flow implemented yet.`);
}

export async function pauseConnection(userId: string, service: ConnectionService) {
  const connection = await getConnection(userId, service);
  if (!connection) return null;
  const updated = await db.connection.update({ where: { id: connection.id }, data: { status: "PAUSED" } });
  await recordEvent({
    userId,
    type: "connection.paused",
    subjectType: "Connection",
    subjectId: updated.id,
    payload: { service },
  });
  return updated;
}

export async function resumeConnection(userId: string, service: ConnectionService) {
  const connection = await getConnection(userId, service);
  if (!connection) return null;
  const updated = await db.connection.update({ where: { id: connection.id }, data: { status: "CONNECTED" } });
  await recordEvent({
    userId,
    type: "connection.resumed",
    subjectType: "Connection",
    subjectId: updated.id,
    payload: { service },
  });
  return updated;
}

/**
 * Revokes access: revokes both Permission grants, destroys the
 * ConnectionCredential row outright (not a flag — the secret is actually
 * gone), and sets status REVOKED. Cached data is left untouched — deleting
 * history is a separate, explicit action (deleteCachedData).
 */
export async function revokeConnection(userId: string, service: ConnectionService) {
  const entry = getCatalogEntry(service);
  const connection = await getConnection(userId, service);
  if (!connection || !entry) return null;

  await revokePermission(userId, entry.readCapability);
  if (entry.writeCapability) {
    await revokePermission(userId, entry.writeCapability);
  }
  await db.connectionCredential.deleteMany({ where: { connectionId: connection.id } });

  const updated = await db.connection.update({
    where: { id: connection.id },
    data: { status: "REVOKED", readEnabled: false, writeEnabled: false, statusReason: null },
  });
  await recordEvent({
    userId,
    type: "connection.revoked",
    subjectType: "Connection",
    subjectId: updated.id,
    payload: { service },
    consequential: true,
  });
  return updated;
}

/** Deletes cached external data for a connection, independent of its connect/revoke state. */
export async function deleteCachedData(userId: string, service: ConnectionService) {
  const connection = await getConnection(userId, service);
  if (!connection) return null;

  const { count } = await db.connectionCachedItem.deleteMany({ where: { connectionId: connection.id } });
  await recordEvent({
    userId,
    type: "connection.cache_deleted",
    subjectType: "Connection",
    subjectId: connection.id,
    payload: { service, count },
  });
  return { deleted: count };
}

/** Decrypts and returns a connection's cached items — for completeness/inspection, not currently used by any UI since no connection can be CONNECTED yet. */
export async function getDecryptedCachedItems(userId: string, service: ConnectionService) {
  const connection = await getConnection(userId, service);
  if (!connection) return [];
  const items = await db.connectionCachedItem.findMany({ where: { connectionId: connection.id } });
  return items.map((item) => ({ ...item, payload: decryptField(item.payload) }));
}

/** Encrypts and stores a credential payload for a connection — only reachable once a real provider successfully exchanges a code (see grantAccess). */
export async function storeCredential(
  connectionId: string,
  payload: Record<string, unknown>,
  expiresAt?: Date
) {
  return db.connectionCredential.upsert({
    where: { connectionId },
    create: { connectionId, encryptedPayload: encryptField(JSON.stringify(payload)), expiresAt },
    update: { encryptedPayload: encryptField(JSON.stringify(payload)), expiresAt },
  });
}
