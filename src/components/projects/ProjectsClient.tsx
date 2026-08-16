"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

interface ProjectItem {
  id: string;
  name: string;
  description: string | null;
  status: string;
}

const STATUS_TONE: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  ACTIVE: "accent",
  PAUSED: "warning",
  COMPLETED: "success",
  ARCHIVED: "neutral",
};

export function ProjectsClient({ initialProjects }: { initialProjects: ProjectItem[] }) {
  const [projects, setProjects] = useState(initialProjects);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return;
    setBusy(true);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, description: description || undefined }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      setProjects((prev) => [data.project, ...prev]);
      setName("");
      setDescription("");
    }
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>New project</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" />
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this project about? (optional)"
            rows={2}
          />
          <Button size="sm" onClick={handleCreate} disabled={busy || !name.trim()} className="self-start">
            Create project
          </Button>
        </CardContent>
      </Card>

      {projects.length === 0 ? (
        <EmptyState title="No projects yet" description="Create your first project to start tracking goals, tasks, and decisions." />
      ) : (
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {projects.map((p) => (
            <li key={p.id}>
              <Link href={`/projects/${p.id}`}>
                <Card className="vox-lift vox-press h-full">
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-foreground">{p.name}</p>
                      <Badge tone={STATUS_TONE[p.status] ?? "neutral"}>{p.status.toLowerCase()}</Badge>
                    </div>
                    {p.description ? <p className="mt-1 text-sm text-muted">{p.description}</p> : null}
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
