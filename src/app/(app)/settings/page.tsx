import { getCurrentUser } from "@/lib/auth/session";
import { listPermissions } from "@/lib/permissions/service";
import { listRecentEvents } from "@/lib/observability/events";
import { getAIProvider } from "@/lib/ai";
import { getResearchProvider } from "@/lib/research";
import { SettingsClient } from "@/components/settings/SettingsClient";

export default async function SettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [permissions, events] = await Promise.all([
    listPermissions(user.id),
    listRecentEvents(user.id, 30),
  ]);
  const aiProvider = getAIProvider();
  const researchProvider = getResearchProvider();

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
      <p className="mt-1 text-sm text-muted">Account, permissions, providers, and your data.</p>

      <SettingsClient
        userEmail={user.email}
        aiProviderId={aiProvider.id}
        aiModel={aiProvider.defaultModel}
        researchProviderId={researchProvider.id}
        initialPermissions={permissions.map((p) => ({ ...p, createdAt: p.createdAt.toISOString() }))}
        events={events.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }))}
      />
    </div>
  );
}
