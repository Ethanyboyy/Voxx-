import { db } from "@/lib/db";
import type { NotificationPriority } from "@/generated/prisma/enums";

const PRIORITY_RANK: Record<NotificationPriority, number> = { LOW: 0, NORMAL: 1, HIGH: 2 };

export async function getNotificationPreference(userId: string) {
  const existing = await db.notificationPreference.findUnique({ where: { userId } });
  if (existing) return existing;
  return db.notificationPreference.create({ data: { userId } });
}

export interface UpdateNotificationPreferenceInput {
  enabled?: boolean;
  quietHoursStart?: number | null;
  quietHoursEnd?: number | null;
  minPriority?: NotificationPriority;
}

export async function updateNotificationPreference(userId: string, updates: UpdateNotificationPreferenceInput) {
  await getNotificationPreference(userId); // ensure a row exists
  return db.notificationPreference.update({ where: { userId }, data: updates });
}

function isQuietHours(pref: { quietHoursStart: number | null; quietHoursEnd: number | null }): boolean {
  if (pref.quietHoursStart == null || pref.quietHoursEnd == null) return false;
  const hour = new Date().getHours();
  const { quietHoursStart: start, quietHoursEnd: end } = pref;
  // Supports overnight ranges (e.g. 22 -> 7).
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

export interface NotifyInput {
  userId: string;
  title: string;
  body: string;
  priority?: NotificationPriority;
  sourceType?: string;
  sourceId?: string;
  projectId?: string;
}

/**
 * The proactive-intelligence delivery layer (§7): the only place that turns
 * "VOX noticed something" into something the user actually sees. Always
 * checks NotificationPreference first — a detector (pattern detection,
 * agent completion, etc.) calling this never bypasses the user's own
 * controls, matching the same posture as enforceCapability() for actions.
 */
export async function notify(input: NotifyInput) {
  const pref = await getNotificationPreference(input.userId);
  const priority = input.priority ?? "NORMAL";
  if (!pref.enabled) return null;
  if (PRIORITY_RANK[priority] < PRIORITY_RANK[pref.minPriority]) return null;
  if (isQuietHours(pref) && priority !== "HIGH") return null;

  return db.notification.create({
    data: {
      userId: input.userId,
      title: input.title,
      body: input.body,
      priority,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      projectId: input.projectId,
    },
  });
}

export async function listNotifications(userId: string, unreadOnly = false) {
  return db.notification.findMany({
    where: { userId, read: unreadOnly ? false : undefined },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
}

export async function markNotificationRead(userId: string, id: string) {
  const existing = await db.notification.findFirst({ where: { id, userId } });
  if (!existing) return null;
  return db.notification.update({ where: { id }, data: { read: true } });
}

export async function markAllNotificationsRead(userId: string) {
  await db.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
}
