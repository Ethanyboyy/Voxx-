"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { HolographicPanel, LabStatusBadge } from "@/components/lab/primitives";
import { NewSuitForm } from "@/components/lab/NewSuitForm";

interface SuitListItem {
  id: string;
  codename: string;
  designation: string;
  archetype: string;
  status: string;
  colorPrimary: string;
  colorSecondary: string;
  stats: { stealth: number; durability: number; mobility: number; weightKg: number; estimatedCostUsd: number } | null;
}

export function SuitBayClient({
  initialSuits,
  projects,
}: {
  initialSuits: SuitListItem[];
  projects: { id: string; name: string }[];
}) {
  const [suits, setSuits] = useState(initialSuits);
  const [query, setQuery] = useState("");
  const [archetype, setArchetype] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const router = useRouter();

  const archetypes = useMemo(() => Array.from(new Set(suits.map((s) => s.archetype))).sort(), [suits]);

  const filtered = suits.filter((s) => {
    if (archetype !== "all" && s.archetype !== archetype) return false;
    if (query && !s.codename.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  function toggleSelect(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 4 ? [...prev, id] : prev));
  }

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search suits…"
          className="max-w-xs"
        />
        <Select value={archetype} onChange={(e) => setArchetype(e.target.value)} className="max-w-[180px]">
          <option value="all">All archetypes</option>
          {archetypes.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <div className="flex-1" />
        {selected.length >= 2 ? (
          <Button size="sm" variant="secondary" onClick={() => router.push(`/lab/suits/compare?ids=${selected.join(",")}`)}>
            Compare ({selected.length})
          </Button>
        ) : null}
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New Suit"}
        </Button>
      </div>

      {showForm ? (
        <NewSuitForm
          projects={projects}
          onCreated={(suit) => {
            setSuits((prev) => [
              {
                id: suit.id,
                codename: suit.codename,
                designation: suit.designation,
                archetype: suit.archetype,
                status: suit.status,
                colorPrimary: suit.colorPrimary,
                colorSecondary: suit.colorSecondary,
                stats: null,
              },
              ...prev,
            ]);
            setShowForm(false);
            router.push(`/lab/suits/${suit.id}`);
          }}
        />
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState title="No suits found" description="Adjust your filters, or create a new design." />
      ) : (
        <p className="text-xs text-muted-foreground">
          {filtered.length} suit{filtered.length === 1 ? "" : "s"} · select up to 4 to compare
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((s) => (
          <div key={s.id} className="relative">
            <button
              type="button"
              onClick={() => toggleSelect(s.id)}
              className={`absolute right-2 top-2 z-10 h-5 w-5 rounded border ${selected.includes(s.id) ? "border-accent bg-accent" : "border-border bg-surface"}`}
              aria-label={`Select ${s.codename} for comparison`}
              aria-pressed={selected.includes(s.id)}
            />
            <Link href={`/lab/suits/${s.id}`}>
              <HolographicPanel corners className="h-full p-4 transition-colors hover:bg-surface-hover">
                <div
                  className="mb-3 h-20 w-full rounded-lg"
                  style={{
                    background: `linear-gradient(135deg, ${s.colorPrimary}33, ${s.colorSecondary}66)`,
                    border: `1px solid ${s.colorPrimary}55`,
                  }}
                />
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">{s.codename}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {s.designation} · {s.archetype}
                    </p>
                  </div>
                  <LabStatusBadge status={s.status} />
                </div>
                {s.stats ? (
                  <div className="lab-mono mt-3 grid grid-cols-3 gap-1 text-[10px] text-muted">
                    <span>STL {s.stats.stealth}</span>
                    <span>DUR {s.stats.durability}</span>
                    <span>MOB {s.stats.mobility}</span>
                  </div>
                ) : null}
              </HolographicPanel>
            </Link>
          </div>
        ))}
      </div>
    </div>
  );
}
