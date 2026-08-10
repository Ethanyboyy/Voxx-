"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

interface CatalogEntry {
  service: string;
  category: string;
  displayName: string;
  description: string;
  readCapability: string;
  writeCapability: string | null;
  requiredEnvVars: string[];
  writeEnabledByDefault: boolean;
  notes?: string;
}

interface ConnectionRow {
  id: string;
  readEnabled: boolean;
  writeEnabled: boolean;
  statusReason: string | null;
  lastSyncedAt: string | null;
}

interface ConnectionEntry {
  catalog: CatalogEntry;
  status: string;
  hasCredential: boolean;
  cachedItemCount: number;
  isConfigured: boolean;
  connection: ConnectionRow | null;
}

interface SuggestedProposal {
  id: string;
  observation: string;
  suggestedAction: string;
  actionPayload: string;
  confidence: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  EMAIL_CALENDAR: "Email & Calendar",
  FINANCIAL: "Financial",
  TASKS_NOTES: "Tasks & Notes",
  HEALTH_FITNESS: "Health & Fitness",
  LOCATION_MAPS: "Location & Maps",
  SHOPPING: "Shopping",
  ETSY: "Etsy",
  PRINT_ON_DEMAND: "Print on Demand",
};

const STATUS_TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  NOT_CONNECTED: "neutral",
  PROPOSED: "accent",
  AWAITING_APPROVAL: "warning",
  CONNECTING: "warning",
  CONNECTED: "success",
  PAUSED: "neutral",
  REVOKED: "danger",
  ERROR: "danger",
};

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export function ConnectionsHubClient({
  initialConnections,
  initialProposals,
}: {
  initialConnections: ConnectionEntry[];
  initialProposals: SuggestedProposal[];
}) {
  const [entries, setEntries] = useState(initialConnections);
  const [proposals, setProposals] = useState(initialProposals);
  const [busyService, setBusyService] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, string>>({});

  function setMessage(key: string, message: string) {
    setMessages((prev) => ({ ...prev, [key]: message }));
  }

  async function refreshConnections() {
    const res = await fetch("/api/connections");
    if (!res.ok) return;
    const data = await res.json();
    setEntries(data.connections);
  }

  async function handleApproveProposal(proposal: SuggestedProposal) {
    setBusyService(proposal.id);
    const { ok, data } = await postJson(`/api/proposals/${proposal.id}/approve`);
    setBusyService(null);
    if (!ok) {
      setMessage(
        proposal.id,
        data.capability
          ? `Needs "${data.capability}" granted at ${data.requiredLevel} first — turn on Read access for this connection below, then approve again.`
          : data.error ?? "Approval failed."
      );
      return;
    }
    setProposals((prev) => prev.filter((p) => p.id !== proposal.id));
    await refreshConnections();
  }

  async function handleDenyProposal(proposal: SuggestedProposal) {
    setBusyService(proposal.id);
    await postJson(`/api/proposals/${proposal.id}/deny`, { reason: "Declined from Connections Hub" });
    setBusyService(null);
    setProposals((prev) => prev.filter((p) => p.id !== proposal.id));
  }

  async function handleGrantAccess(service: string, access: { read?: boolean; write?: boolean }) {
    setBusyService(service);
    const { ok, data } = await postJson(`/api/connections/${service}/grant-access`, access);
    setBusyService(null);
    if (!ok) {
      setMessage(service, data.error ?? "Could not grant access.");
      return;
    }
    setMessage(service, data.connection?.statusReason ?? "");
    await refreshConnections();
  }

  async function handleLifecycle(service: string, action: "pause" | "resume" | "revoke") {
    setBusyService(service);
    const { ok, data } = await postJson(`/api/connections/${service}/${action}`);
    setBusyService(null);
    if (!ok) {
      setMessage(service, data.error ?? "Action failed.");
      return;
    }
    await refreshConnections();
  }

  async function handleDeleteCache(service: string) {
    setBusyService(service);
    const { ok, data } = await postJson(`/api/connections/${service}/delete-cache`);
    setBusyService(null);
    if (!ok) {
      setMessage(service, data.error ?? "Could not delete cached data.");
      return;
    }
    await refreshConnections();
  }

  async function handleSuggest(service: string) {
    setBusyService(service);
    const { ok, data } = await postJson("/api/connections", { service });
    setBusyService(null);
    if (!ok) {
      setMessage(service, data.error ?? "Could not suggest connection.");
      return;
    }
    setProposals((prev) => [
      ...prev,
      {
        id: data.proposal.id,
        observation: data.proposal.observation,
        suggestedAction: data.proposal.suggestedAction,
        actionPayload: data.proposal.actionPayload,
        confidence: data.proposal.confidence,
      },
    ]);
    await refreshConnections();
  }

  const grouped = entries.reduce<Record<string, ConnectionEntry[]>>((acc, entry) => {
    const key = entry.catalog.category;
    acc[key] = acc[key] ?? [];
    acc[key].push(entry);
    return acc;
  }, {});

  return (
    <div className="mt-6 flex flex-col gap-8">
      <section>
        <h2 className="text-sm font-semibold text-foreground">Suggested Connections</h2>
        {proposals.length === 0 ? (
          <div className="mt-2">
            <EmptyState
              title="Nothing suggested right now"
              description="VOX explains why before suggesting a connection — nothing is authorized automatically."
            />
          </div>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {proposals.map((proposal) => (
              <li key={proposal.id}>
                <Card>
                  <CardContent className="flex flex-col gap-2 pt-4">
                    <p className="text-sm text-foreground">{proposal.suggestedAction}</p>
                    <p className="text-xs text-muted">{proposal.observation}</p>
                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={() => handleApproveProposal(proposal)} disabled={busyService === proposal.id}>
                        Approve Connection
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDenyProposal(proposal)} disabled={busyService === proposal.id}>
                        Dismiss
                      </Button>
                    </div>
                    {messages[proposal.id] ? <p className="text-xs text-warning">{messages[proposal.id]}</p> : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {Object.entries(grouped).map(([category, categoryEntries]) => (
        <section key={category}>
          <h2 className="text-sm font-semibold text-foreground">{CATEGORY_LABELS[category] ?? category}</h2>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {categoryEntries.map((entry) => {
              const service = entry.catalog.service;
              const busy = busyService === service;
              return (
                <Card key={service}>
                  <CardHeader>
                    <CardTitle>{entry.catalog.displayName}</CardTitle>
                    <Badge tone={STATUS_TONE[entry.status] ?? "neutral"}>{entry.status.toLowerCase().replace(/_/g, " ")}</Badge>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-3">
                    <p className="text-sm text-muted">{entry.catalog.description}</p>
                    {entry.catalog.notes ? <p className="text-xs text-warning">{entry.catalog.notes}</p> : null}
                    {!entry.isConfigured ? (
                      <p className="text-xs text-muted">
                        Not configured — no real credentials are set for this service yet.
                      </p>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant={entry.connection?.readEnabled ? "secondary" : "primary"}
                        onClick={() => handleGrantAccess(service, { read: !entry.connection?.readEnabled })}
                        disabled={busy || entry.status === "REVOKED"}
                      >
                        {entry.connection?.readEnabled ? "Read: on" : "Turn on read access"}
                      </Button>
                      {entry.catalog.writeCapability ? (
                        <Button
                          size="sm"
                          variant={entry.connection?.writeEnabled ? "secondary" : "primary"}
                          onClick={() => handleGrantAccess(service, { write: !entry.connection?.writeEnabled })}
                          disabled={busy || entry.status === "REVOKED"}
                        >
                          {entry.connection?.writeEnabled ? "Write: on" : "Turn on write access"}
                        </Button>
                      ) : (
                        <Badge tone="neutral">read-only</Badge>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {entry.status === "NOT_CONNECTED" ? (
                        <Button size="sm" variant="secondary" onClick={() => handleSuggest(service)} disabled={busy}>
                          Suggest this connection
                        </Button>
                      ) : null}
                      {entry.status === "CONNECTED" ? (
                        <Button size="sm" variant="secondary" onClick={() => handleLifecycle(service, "pause")} disabled={busy}>
                          Pause
                        </Button>
                      ) : null}
                      {entry.status === "PAUSED" ? (
                        <Button size="sm" variant="secondary" onClick={() => handleLifecycle(service, "resume")} disabled={busy}>
                          Resume
                        </Button>
                      ) : null}
                      {entry.status !== "NOT_CONNECTED" && entry.status !== "REVOKED" ? (
                        <Button size="sm" variant="danger" onClick={() => handleLifecycle(service, "revoke")} disabled={busy}>
                          Revoke
                        </Button>
                      ) : null}
                      {entry.cachedItemCount > 0 ? (
                        <Button size="sm" variant="ghost" onClick={() => handleDeleteCache(service)} disabled={busy}>
                          Delete cached data ({entry.cachedItemCount})
                        </Button>
                      ) : null}
                    </div>

                    {entry.connection?.statusReason ? (
                      <p className="text-xs text-muted">{entry.connection.statusReason}</p>
                    ) : null}
                    {messages[service] ? <p className="text-xs text-warning">{messages[service]}</p> : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
