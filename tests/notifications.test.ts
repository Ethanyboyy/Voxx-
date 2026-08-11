import { describe, it, expect, beforeAll } from "vitest";
import {
  getNotificationPreference,
  updateNotificationPreference,
  notify,
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "@/lib/notifications/service";
import { createTestUser } from "./helpers";

describe("proactive notifications", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await createTestUser();
    userId = user.id;
  });

  it("creates a default preference row on first access", async () => {
    const pref = await getNotificationPreference(userId);
    expect(pref.enabled).toBe(true);
    expect(pref.minPriority).toBe("LOW");
  });

  it("notify() creates a notification when preferences allow it", async () => {
    const notification = await notify({ userId, title: "Test", body: "Something happened.", priority: "NORMAL" });
    expect(notification).not.toBeNull();
    const list = await listNotifications(userId);
    expect(list.some((n) => n.id === notification!.id)).toBe(true);
  });

  it("notify() is a no-op when notifications are disabled — the delivery choke point, never bypassed", async () => {
    await updateNotificationPreference(userId, { enabled: false });
    const notification = await notify({ userId, title: "Should not appear", body: "x" });
    expect(notification).toBeNull();
    await updateNotificationPreference(userId, { enabled: true });
  });

  it("notify() suppresses anything below the configured minimum priority", async () => {
    await updateNotificationPreference(userId, { minPriority: "HIGH" });
    const low = await notify({ userId, title: "low", body: "x", priority: "LOW" });
    expect(low).toBeNull();
    const high = await notify({ userId, title: "high", body: "x", priority: "HIGH" });
    expect(high).not.toBeNull();
    await updateNotificationPreference(userId, { minPriority: "LOW" });
  });

  it("notify() suppresses NORMAL priority during quiet hours but never suppresses HIGH", async () => {
    const currentHour = new Date().getHours();
    await updateNotificationPreference(userId, {
      quietHoursStart: currentHour,
      quietHoursEnd: (currentHour + 1) % 24,
    });
    const suppressed = await notify({ userId, title: "quiet", body: "x", priority: "NORMAL" });
    expect(suppressed).toBeNull();
    const urgent = await notify({ userId, title: "urgent", body: "x", priority: "HIGH" });
    expect(urgent).not.toBeNull();
    await updateNotificationPreference(userId, { quietHoursStart: null, quietHoursEnd: null });
  });

  it("markNotificationRead and markAllNotificationsRead update read state, scoped to the owner", async () => {
    const otherUser = await createTestUser();
    const notification = await notify({ userId, title: "mark me", body: "x" });
    expect(await markNotificationRead(otherUser.id, notification!.id)).toBeNull();

    const marked = await markNotificationRead(userId, notification!.id);
    expect(marked!.read).toBe(true);

    await notify({ userId, title: "another", body: "x" });
    await markAllNotificationsRead(userId);
    const unread = await listNotifications(userId, true);
    expect(unread.length).toBe(0);
  });
});
