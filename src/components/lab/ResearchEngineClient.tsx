"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Textarea, Select, Label } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { HolographicPanel, LabSectionLabel, ConfidenceTag } from "@/components/lab/primitives";

export interface ResearchListItem {
  id: string;
  title: string;
  category: string;
  source: string | null;
  sourceDate: string | null;
  confidence: string;
  relevance: number;
  notes: string | null;
  projectName: string | null;
  updatedAt: string;
}

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

export function RelevanceBar({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-hover">
        <div
          className="h-full rounded-full bg-gradient-to-r from-accent-blue to-accent"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="lab-mono w-7 shrink-0 text-right text-[11px] text-muted-foreground">{Math.round(pct)}</span>
    </div>
  );
}

export function ResearchEngineClient({
  initialItems,
  projects,
}: {
  initialItems: ResearchListItem[];
  projects: { id: string; name: string }[];
}) {
  const [items, setItems] = useState(initialItems);
  const [category, setCategory] = useState<"all" | (typeof CATEGORIES)[number]>("all");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const router = useRouter();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        (item.source ?? "").toLowerCase().includes(q) ||
        (item.notes ?? "").toLowerCase().includes(q)
      );
    });
  }, [items, category, search]);

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="lab-mono flex flex-wrap items-center gap-1 rounded-full border border-border bg-surface p-0.5 text-[11px]">
          <button
            type="button"
            onClick={() => setCategory("all")}
            className={`rounded-full px-3 py-1 font-semibold uppercase tracking-wider transition-colors ${
              category === "all"
                ? "bg-accent-muted text-accent shadow-[0_0_10px_-4px_var(--accent)]"
                : "text-muted-foreground hover:text-foreground"
            }`}
            aria-pressed={category === "all"}
          >
            All
          </button>
        </div>
        <Select
          value={category}
          onChange={(e) => setCategory(e.target.value as "all" | (typeof CATEGORIES)[number])}
          className="max-w-[220px]"
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {formatCategory(c)}
            </option>
          ))}
        </Select>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, source, notes…"
          className="max-w-xs"
        />
        <div className="flex-1" />
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New Research Item"}
        </Button>
      </div>

      {showForm ? (
        <NewResearchItemForm
          projects={projects}
          onCreated={(item) => {
            setItems((prev) => [
              {
                id: item.id,
                title: item.title,
                category: item.category,
                source: item.source,
                sourceDate: item.sourceDate,
                confidence: item.confidence,
                relevance: item.relevance,
                notes: item.notes,
                projectName: projects.find((p) => p.id === item.projectId)?.name ?? null,
                updatedAt: item.updatedAt,
              },
              ...prev,
            ]);
            setShowForm(false);
            router.refresh();
          }}
        />
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          title="No research recorded yet"
          description="Track materials, physics, or engineering findings as you go — sources, confidence, and relevance all live here."
        />
      ) : filtered.length === 0 ? (
        <EmptyState title="No matching research" description="Try a different category or search term." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => (
            <Link key={item.id} href={`/lab/research/${item.id}`}>
              <HolographicPanel corners className="vox-lift h-full p-4 transition-colors hover:border-[var(--border-strong)] hover:bg-surface-hover">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="lab-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {formatCategory(item.category)}
                    </p>
                    <p className="font-semibold text-foreground">{item.title}</p>
                  </div>
                  <ConfidenceTag confidence={item.confidence} />
                </div>
                {item.notes ? <p className="mt-2 line-clamp-2 text-xs text-muted">{item.notes}</p> : null}
                <div className="mt-3 flex items-center justify-between">
                  <RelevanceBar value={item.relevance} />
                  <span className="text-[11px] text-muted-foreground">
                    {item.source ? item.source : "No source"}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>{item.projectName ? item.projectName : "No project"}</span>
                  <span>{new Date(item.updatedAt).toLocaleDateString()}</span>
                </div>
              </HolographicPanel>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NewResearchItemForm({
  projects,
  onCreated,
}: {
  projects: { id: string; name: string }[];
  onCreated: (item: {
    id: string;
    title: string;
    category: string;
    source: string | null;
    sourceDate: string | null;
    confidence: string;
    relevance: number;
    notes: string | null;
    projectId: string | null;
    updatedAt: string;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("MATERIALS");
  const [source, setSource] = useState("");
  const [sourceDate, setSourceDate] = useState("");
  const [confidence, setConfidence] = useState<(typeof CONFIDENCE_OPTIONS)[number]>("ESTIMATED");
  const [relevance, setRelevance] = useState(50);
  const [notes, setNotes] = useState("");
  const [projectId, setProjectId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!title.trim()) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/lab/research", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        category,
        source: source.trim() || undefined,
        sourceDate: sourceDate ? new Date(sourceDate).toISOString() : undefined,
        confidence,
        relevance,
        notes: notes.trim() || undefined,
        projectId: projectId || undefined,
      }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      onCreated({ ...data.item, projectId: data.item.projectId ?? null });
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to create research item.");
    }
  }

  return (
    <HolographicPanel corners className="p-4">
      <LabSectionLabel>New Research Item</LabSectionLabel>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Kevlar-graphene weave tensile study" />
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
          <Select value={confidence} onChange={(e) => setConfidence(e.target.value as (typeof CONFIDENCE_OPTIONS)[number])}>
            {CONFIDENCE_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Source (optional)</Label>
          <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Journal of Materials Science" />
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
        {projects.length > 0 ? (
          <div>
            <Label>Project (optional)</Label>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <Label>Notes (optional)</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Findings, caveats, next steps…" />
        </div>
      </div>

      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      <Button className="mt-4" onClick={handleSubmit} disabled={busy}>
        {busy ? "Creating…" : "Create Research Item"}
      </Button>
    </HolographicPanel>
  );
}
