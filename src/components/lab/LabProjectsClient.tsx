"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select, Label } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { HolographicPanel, LabStatusBadge } from "@/components/lab/primitives";

export interface LabProjectListItem {
  id: string;
  name: string;
  description: string | null;
  status: string;
  counts: {
    suits: number;
    gadgets: number;
    webProfiles: number;
    simulations: number;
    experiments: number;
  };
}

const STATUS_OPTIONS = ["ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"];

export function LabProjectsClient({ initialProjects }: { initialProjects: LabProjectListItem[] }) {
  const [projects, setProjects] = useState(initialProjects);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const router = useRouter();

  const filtered = projects.filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects…" className="max-w-xs" />
        <div className="flex-1" />
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New Project"}
        </Button>
      </div>

      {showForm ? (
        <NewProjectForm
          onCreated={(project) => {
            setProjects((prev) => [
              {
                id: project.id,
                name: project.name,
                description: project.description,
                status: project.status,
                counts: { suits: 0, gadgets: 0, webProfiles: 0, simulations: 0, experiments: 0 },
              },
              ...prev,
            ]);
            setShowForm(false);
            router.push(`/lab/projects/${project.id}`);
          }}
        />
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState title="No projects found" description="Adjust your search, or start a new project." />
      ) : (
        <p className="text-xs text-muted-foreground">
          {filtered.length} project{filtered.length === 1 ? "" : "s"}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((p) => (
          <Link key={p.id} href={`/lab/projects/${p.id}`}>
            <HolographicPanel corners className="h-full p-4 transition-colors hover:bg-surface-hover">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold text-foreground">{p.name}</p>
                <LabStatusBadge status={p.status} />
              </div>
              {p.description ? <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{p.description}</p> : null}
              <div className="lab-mono mt-3 grid grid-cols-3 gap-1 text-[10px] text-muted">
                <span>SUITS {p.counts.suits}</span>
                <span>GADGETS {p.counts.gadgets}</span>
                <span>WEB {p.counts.webProfiles}</span>
                <span>SIM {p.counts.simulations}</span>
                <span>EXP {p.counts.experiments}</span>
              </div>
            </HolographicPanel>
          </Link>
        ))}
      </div>
    </div>
  );
}

function NewProjectForm({
  onCreated,
}: {
  onCreated: (project: { id: string; name: string; description: string | null; status: string }) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/lab/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: description || undefined, status }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      onCreated(data.project);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to create project.");
    }
  }

  return (
    <HolographicPanel corners className="p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Urban Recon Initiative" />
        </div>
        <div>
          <Label>Status</Label>
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label>Description</Label>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Project goals, scope…" />
        </div>
      </div>
      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      <Button className="mt-4" onClick={handleSubmit} disabled={busy}>
        {busy ? "Creating…" : "Create Project"}
      </Button>
    </HolographicPanel>
  );
}
