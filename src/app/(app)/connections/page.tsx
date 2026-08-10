import { getCurrentUser } from "@/lib/auth/session";
import { listConnections } from "@/lib/connections/service";
import { listProposals } from "@/lib/cognition/proposals";
import { ConnectionsHubClient } from "@/components/connections/ConnectionsHubClient";

export default async function ConnectionsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [connections, proposals] = await Promise.all([
    listConnections(user.id),
    listProposals(user.id, "PROPOSED"),
  ]);
  const connectionProposals = proposals.filter((p) => p.actionType === "connection.propose");

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Connections</h1>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        The trust boundary for everything outside VOX. Nothing here is connected to a real account —
        every connection below is scaffolding: proposing, approving, and granting access all work, but
        no real credentials exist yet, so every connect attempt ends in &quot;not configured&quot; rather
        than actually reaching an external service.
      </p>
      <ConnectionsHubClient
        initialConnections={connections.map((c) => ({
          catalog: c.catalog,
          status: c.status,
          hasCredential: c.hasCredential,
          cachedItemCount: c.cachedItemCount,
          isConfigured: c.isConfigured,
          connection: c.connection
            ? {
                id: c.connection.id,
                readEnabled: c.connection.readEnabled,
                writeEnabled: c.connection.writeEnabled,
                statusReason: c.connection.statusReason,
                lastSyncedAt: c.connection.lastSyncedAt?.toISOString() ?? null,
              }
            : null,
        }))}
        initialProposals={connectionProposals.map((p) => ({
          id: p.id,
          observation: p.observation,
          suggestedAction: p.suggestedAction,
          actionPayload: p.actionPayload,
          confidence: p.confidence,
        }))}
      />
    </div>
  );
}
