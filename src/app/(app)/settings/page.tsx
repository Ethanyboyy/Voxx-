import { getCurrentUser } from "@/lib/auth/session";
import { listPermissions } from "@/lib/permissions/service";
import { listRecentEvents } from "@/lib/observability/events";
import { getNotificationPreference } from "@/lib/notifications/service";
import { getAIProvider } from "@/lib/ai";
import { getResearchProvider } from "@/lib/research";
import { listConnections } from "@/lib/connections/service";
import { db } from "@/lib/db";
import { SettingsClient } from "@/components/settings/SettingsClient";

async function probeDatabase(): Promise<boolean> {
  try {
    await db.user.count();
    return true;
  } catch {
    return false;
  }
}

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [permissions, events, notificationPreference, connections, dbReachable] = await Promise.all([
    listPermissions(user.id),
    listRecentEvents(user.id, 30),
    getNotificationPreference(user.id),
    listConnections(user.id),
    probeDatabase(),
  ]);
  const aiProvider = getAIProvider();
  const researchProvider = getResearchProvider();

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <p className="vox-eyebrow">Configuration</p>
      <h1 className="vox-headline mt-1 text-2xl sm:text-3xl">System Configuration</h1>
      <p className="mt-1.5 text-sm text-muted">Account, system health, permissions, and your data.</p>

      <SettingsClient
        userEmail={user.email}
        aiProviderId={aiProvider.id}
        aiModel={aiProvider.defaultModel}
        aiConfigured={aiProvider.id !== "mock"}
        researchProviderId={researchProvider.id}
        researchConfigured={process.env.VOX_RESEARCH_PROVIDER === "anthropic" && Boolean(process.env.ANTHROPIC_API_KEY)}
        dbReachable={dbReachable}
        connectionsConnected={connections.filter((c) => c.status === "CONNECTED").length}
        connectionsTotal={connections.length}
        initialPermissions={permissions.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }))}
        events={events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }))}
        initialNotificationPreference={{
          enabled: notificationPreference.enabled,
          quietHoursStart: notificationPreference.quietHoursStart,
          quietHoursEnd: notificationPreference.quietHoursEnd,
          minPriority: notificationPreference.minPriority,
        }}
      />
    </div>
  );
}
