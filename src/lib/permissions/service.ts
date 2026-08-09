import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import type { CapabilityLevel } from "@/generated/prisma/enums";

const LEVEL_ORDER: CapabilityLevel[] = ["OBSERVE", "ANALYZE", "RECOMMEND", "ASK", "ACT"];

function rank(level: CapabilityLevel): number {
  return LEVEL_ORDER.indexOf(level);
}

/** Default policy when no explicit Permission row exists: read-only levels are allowed, everything else is denied. */
const DEFAULT_GRANTED_LEVEL: CapabilityLevel = "ANALYZE";

export class PermissionDeniedError extends Error {
  constructor(
    public readonly capability: string,
    public readonly requiredLevel: CapabilityLevel
  ) {
    super(`Capability "${capability}" requires level ${requiredLevel}, which is not granted.`);
    this.name = "PermissionDeniedError";
  }
}

export interface CapabilityCheck {
  allowed: boolean;
  effectiveLevel: CapabilityLevel;
  isDefault: boolean;
}

export async function checkCapability(
  userId: string,
  capability: string,
  requiredLevel: CapabilityLevel
): Promise<CapabilityCheck> {
  const permission = await db.permission.findUnique({
    where: { userId_capability: { userId, capability } },
  });

  if (!permission || !permission.granted) {
    const effectiveLevel = permission?.granted ? permission.level : DEFAULT_GRANTED_LEVEL;
    return {
      allowed: rank(effectiveLevel) >= rank(requiredLevel),
      effectiveLevel,
      isDefault: !permission,
    };
  }

  return {
    allowed: rank(permission.level) >= rank(requiredLevel),
    effectiveLevel: permission.level,
    isDefault: false,
  };
}

/**
 * Throws {@link PermissionDeniedError} when the capability isn't granted at
 * the required level. Always writes an audit Event, whether allowed or
 * denied, for any level above ANALYZE — VOX must never act consequentially
 * in silence.
 */
export async function enforceCapability(
  userId: string,
  capability: string,
  requiredLevel: CapabilityLevel
): Promise<void> {
  const result = await checkCapability(userId, capability, requiredLevel);
  const consequential = rank(requiredLevel) >= rank("RECOMMEND");

  if (consequential) {
    await recordEvent({
      userId,
      type: result.allowed ? "permission.check.allowed" : "permission.check.denied",
      payload: { capability, requiredLevel, effectiveLevel: result.effectiveLevel },
      consequential: true,
    });
  }

  if (!result.allowed) {
    throw new PermissionDeniedError(capability, requiredLevel);
  }
}

export async function grantPermission(userId: string, capability: string, level: CapabilityLevel) {
  const permission = await db.permission.upsert({
    where: { userId_capability: { userId, capability } },
    create: { userId, capability, level, granted: true, grantedAt: new Date() },
    update: { level, granted: true, grantedAt: new Date(), revokedAt: null },
  });
  await recordEvent({
    userId,
    type: "permission.granted",
    payload: { capability, level },
    consequential: true,
  });
  return permission;
}

export async function revokePermission(userId: string, capability: string) {
  const permission = await db.permission.upsert({
    where: { userId_capability: { userId, capability } },
    create: { userId, capability, level: "OBSERVE", granted: false, revokedAt: new Date() },
    update: { granted: false, revokedAt: new Date() },
  });
  await recordEvent({
    userId,
    type: "permission.revoked",
    payload: { capability },
    consequential: true,
  });
  return permission;
}

export async function listPermissions(userId: string) {
  return db.permission.findMany({ where: { userId }, orderBy: { capability: "asc" } });
}
