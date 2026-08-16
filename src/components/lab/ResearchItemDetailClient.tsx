"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select, Label } from "@/components/ui/Field";
import { HolographicPanel, LabSectionLabel, ConfidenceTag } from "@/components/lab/primitives";
import { RelevanceBar } from "@/components/lab/ResearchEngineClient";

const CATEGORIES = [
  "MATERIALS",
  "TEXTILES",
  "POLYMERS",
  "COMPOSITES",
  "ROBOTICS",
  "WEARABLE_TECHNOLOGY",
  "SENSORS",
  "PHYSICS",
  "BIOMECHANICS",
  "THERMAL_MANAGEMENT",
  "MANUFACTURING",
  "PROTECTIVE_EQUIPMENT",
] as const;

const CONFIDENCE_OPTIONS = ["VERIFIED", "ESTIMATED", "HYPOTHETICAL", "UNKNOWN"] as const;

function formatCategory(category: string) {
  return category
    .toLowerCase()
    .split("_")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

export interface ResearchItemDetail {
  id: string;
  title: string;
  category: string;
  source: string | null;
  sourceDate: string | null;
  confidence: string;
  relevance: number;
  notes: string | null;
  project: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export function ResearchItemDetailClient({ item }: { item: ResearchItemDetail }) {
  const router = useRouter();
  const [current, setCurrent] = useState(item);
  const [editing, setEditing] = useState(false);

  const [title, setTitle] = useState(item.title);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>(item.category as (typeof CATEGORIES)[number]);
  const [source, setSource] = useState(item.source ?? "");
  const [sourceDate, setSourceDate] = useState(item.sourceDate ? item.sourceDate.slice(0, 10) : "");
  const [confidence, setConfidence] = useState<(typeof CONFIDENCE_OPTIONS)[number]>(
    item.confidence as (typeof CONFIDENCE_OPTIONS)[number]
  );
  const [relevance, setRelevance] = useState(item.relevance);
  const [notes, setNotes] = useState(item.notes ?? "");

  const [saveBusy, setSaveBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function resetFields(next: ResearchItemDetail) {
    setTitle(next.title);
    setCategory(next.category as (typeof CATEGORIES)[number]);
    setSource(next.source ?? "");
    setSourceDate(next.sourceDate ? next.sourceDate.slice(0, 10) : "");
    setConfidence(next.confidence as (typeof CONFIDENCE_OPTIONS)[number]);
    setRelevance(next.relevance);
    setNotes(next.notes ?? "");
  }

  async function handleSave() {
    if (!title.trim()) {
      setSaveError("Title is required.");
      return;
    }
    setSaveBusy(true);
    setSaveError(null);
    const res = await fetch(`/api/lab/research/${current.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        category,
        source: source.trim() || undefined,
        sourceDate: sourceDate ? new Date(sourceDate).toISOString() : undefined,
        confidence,
        relevance,
        notes: notes.trim() || undefined,
      }),
    });
    setSaveBusy(false);
    if (res.ok) {
      const data = await res.json();
      const next: ResearchItemDetail = {
        ...current,
        title: data.item.title,
        category: data.item.category,
        source: data.item.source,
        sourceDate: data.item.sourceDate,
        confidence: data.item.confidence,
        relevance: data.item.relevance,
        notes: data.item.notes,
        updatedAt: data.item.updatedAt,
      };
      setCurrent(next);
      resetFields(next);
      setEditing(false);
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setSaveError(data.error ?? "Failed to save changes.");
    }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this research item? This cannot be undone.")) return;
    setDeleteBusy(true);
    setDeleteError(null);
    const res = await fetch(`/api/lab/research/${current.id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/lab/research");
      router.refresh();
    } else {
      setDeleteBusy(false);
      const data = await res.json().catch(() => ({}));
      setDeleteError(data.error ?? "Failed to delete research item.");
    }
  }

  return (
    <div className="vox-panel-in flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="lab-mono text-xs uppercase tracking-wider text-muted-foreground">
              {formatCategory(current.category)}
            </p>
            <ConfidenceTag confidence={current.confidence} />
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{current.title}</h1>
          {current.project ? (
            <p className="mt-1 text-sm text-muted">
              Project:{" "}
              <Link href={`/lab/projects/${current.project.id}`} className="text-accent hover:underline">
                {current.project.name}
              </Link>
            </p>
          ) : null}
          <Link href="/lab/research" className="mt-1 inline-block text-xs text-muted-foreground hover:text-foreground">
            ← Back to Research Engine
          </Link>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              if (!editing) resetFields(current);
              setEditing((v) => !v);
              setSaveError(null);
            }}
          >
            {editing ? "Cancel" : "Edit"}
          </Button>
          <Button size="sm" variant="danger" onClick={handleDelete} disabled={deleteBusy}>
            {deleteBusy ? "Deleting…" : "Delete"}
          </Button>
        </div>
      </div>

      {deleteError ? <p className="text-sm text-danger">{deleteError}</p> : null}

      {editing ? (
        <HolographicPanel corners className="p-4">
          <LabSectionLabel>Edit Research Item</LabSectionLabel>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label>Title</Label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={category} onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {formatCategory(c)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Confidence</Label>
              <Select
                value={confidence}
                onChange={(e) => setConfidence(e.target.value as (typeof CONFIDENCE_OPTIONS)[number])}
              >
                {CONFIDENCE_OPTIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>Source (optional)</Label>
              <Input value={source} onChange={(e) => setSource(e.target.value)} />
            </div>
            <div>
              <Label>Source date (optional)</Label>
              <Input type="date" value={sourceDate} onChange={(e) => setSourceDate(e.target.value)} />
            </div>
            <div>
              <Label>Relevance ({relevance})</Label>
              <input
                type="range"
                min={0}
                max={100}
                value={relevance}
                onChange={(e) => setRelevance(Number(e.target.value))}
                className="w-full accent-[var(--accent)]"
              />
            </div>
            <div className="sm:col-span-2">
              <Label>Notes (optional)</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} />
            </div>
          </div>
          {saveError ? <p className="mt-2 text-sm text-danger">{saveError}</p> : null}
          <Button className="mt-4" onClick={handleSave} disabled={saveBusy}>
            {saveBusy ? "Saving…" : "Save Changes"}
          </Button>
        </HolographicPanel>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="flex flex-col gap-4">
            <HolographicPanel className="p-4">
              <LabSectionLabel>Notes</LabSectionLabel>
              <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">
                {current.notes ? current.notes : "No notes recorded."}
              </p>
            </HolographicPanel>
          </div>

          <div className="flex flex-col gap-4">
            <HolographicPanel className="p-4">
              <LabSectionLabel>Details</LabSectionLabel>
              <div className="mt-3 space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Source</span>
                  <span className="text-foreground">{current.source ?? "—"}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Source date</span>
                  <span className="lab-mono text-foreground">
                    {current.sourceDate ? new Date(current.sourceDate).toLocaleDateString() : "—"}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Relevance</span>
                  <RelevanceBar value={current.relevance} />
                </div>
                <div className="flex items-center justify-between border-t border-border pt-2">
                  <span className="text-muted-foreground">Confidence</span>
                  <ConfidenceTag confidence={current.confidence} />
                </div>
              </div>
            </HolographicPanel>

            <HolographicPanel className="p-4">
              <LabSectionLabel>Record</LabSectionLabel>
              <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                <p>Created {new Date(current.createdAt).toLocaleString()}</p>
                <p>Updated {new Date(current.updatedAt).toLocaleString()}</p>
              </div>
            </HolographicPanel>
          </div>
        </div>
      )}
    </div>
  );
}
