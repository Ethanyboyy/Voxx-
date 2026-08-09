"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

const LEVELS = ["OBSERVE", "ANALYZE", "RECOMMEND", "ASK", "ACT"] as const;

interface PermissionItem {
  id: string;
  capability: string;
  level: string;
  granted: boolean;
}
interface EventItem {
  id: string;
  type: string;
  consequential: boolean;
  createdAt: string;
}

export function SettingsClient({
  userEmail,
  aiProviderId,
  aiModel,
  researchProviderId,
  initialPermissions,
  events,
}: {
  userEmail: string;
  aiProviderId: string;
  aiModel: string;
  researchProviderId: string;
  initialPermissions: PermissionItem[];
  events: EventItem[];
}) {
  const router = useRouter();
  const [permissions, setPermissions] = useState(initialPermissions);
  const [capability, setCapability] = useState("");
  const [level, setLevel] = useState<string>("RECOMMEND");
  const [confirmDelete, setConfirmDelete] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function grant() {
    if (!capability.trim()) return;
    const res = await fetch("/api/permissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability, level }),
    });
    if (res.ok) {
      const data = await res.json();
      setPermissions((prev) => [data.permission, ...prev.filter((p) => p.capability !== data.permission.capability)]);
      setCapability("");
    }
  }

  async function revoke(cap: string) {
    const res = await fetch("/api/permissions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ capability: cap }),
    });
    if (res.ok) {
      const data = await res.json();
      setPermissions((prev) => prev.map((p) => (p.capability === cap ? data.permission : p)));
    }
  }

  async function deleteAllData() {
    if (confirmDelete !== "DELETE") return;
    setDeleting(true);
    const res = await fetch("/api/account", { method: "DELETE" });
    setDeleting(false);
    if (res.ok) {
      router.push("/setup");
      router.refresh();
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-foreground">{userEmail}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Providers</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col gap-2 text-sm">
            <li className="flex justify-between">
              <span className="text-muted">AI provider</span>
              <span className="text-foreground">
                {aiProviderId} ({aiModel})
              </span>
            </li>
            <li className="flex justify-between">
              <span className="text-muted">Research provider</span>
              <span className="text-foreground">{researchProviderId}</span>
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Permissions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            VOX defaults to OBSERVE/ANALYZE for everything. Capabilities above that (RECOMMEND, ASK, ACT) are
            denied until you explicitly grant them here.
          </p>
          <div className="flex gap-2">
            <Input
              value={capability}
              onChange={(e) => setCapability(e.target.value)}
              placeholder="capability key, e.g. integration.example.send"
            />
            <Select value={level} onChange={(e) => setLevel(e.target.value)} className="w-auto">
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </Select>
            <Button size="sm" onClick={grant} disabled={!capability.trim()}>
              Grant
            </Button>
          </div>
          {permissions.length === 0 ? (
            <EmptyState title="No custom permissions set" description="Every capability is still on its default level." />
          ) : (
            <ul className="flex flex-col gap-2">
              {permissions.map((p) => (
                <li key={p.id} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
                  <div>
                    <span className="text-foreground">{p.capability}</span>
                    <Badge className="ml-2">{p.level}</Badge>
                    <Badge className="ml-2" tone={p.granted ? "success" : "danger"}>
                      {p.granted ? "granted" : "revoked"}
                    </Badge>
                  </div>
                  {p.granted ? (
                    <Button size="sm" variant="ghost" onClick={() => revoke(p.capability)}>
                      Revoke
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Audit log</CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <EmptyState title="No recorded events yet" />
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex justify-between">
                  <span className="text-foreground">{e.type}</span>
                  <span className="text-muted">{new Date(e.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your data</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div>
            <p className="text-sm text-muted">Export everything VOX has stored in your Memory system as JSON.</p>
            {/* Plain anchor: this targets an API route (file download), not a page. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/api/memories/export" className="mt-1 inline-block text-sm font-medium text-accent">
              Download memory export
            </a>
          </div>
          <div className="rounded-lg border border-danger/30 p-4">
            <p className="text-sm font-medium text-danger">Delete all data</p>
            <p className="mt-1 text-sm text-muted">
              Permanently deletes your account and everything VOX has stored about you. This cannot be undone. Type
              DELETE to confirm.
            </p>
            <div className="mt-2 flex gap-2">
              <Input value={confirmDelete} onChange={(e) => setConfirmDelete(e.target.value)} placeholder="DELETE" />
              <Button variant="danger" size="sm" disabled={confirmDelete !== "DELETE" || deleting} onClick={deleteAllData}>
                {deleting ? "Deleting..." : "Delete everything"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
