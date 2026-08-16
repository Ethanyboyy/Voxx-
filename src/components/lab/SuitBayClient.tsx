"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { HolographicPanel, LabStatusBadge, RealityStatusTag } from "@/components/lab/primitives";
import { HolographicModel } from "@/components/lab/HolographicModel";
import { LazyMount } from "@/components/lab/LazyMount";
import { NewSuitForm } from "@/components/lab/NewSuitForm";
import type {
  ArmorLevel,
  MaskLensStyle,
  MaterialLanguage,
  PatternStyle,
  Silhouette,
} from "@/components/lab/three/suitDesign";

interface SuitListItem {
  id: string;
  codename: string;
  designation: string;
  archetype: string;
  status: string;
  realityStatus?: string;
  modelUrl?: string | null;
  colorPrimary: string;
  colorSecondary: string;
  silhouette?: string;
  materialLanguage?: string;
  patternStyle?: string;
  armorLevel?: string;
  maskLensStyle?: string;
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
                realityStatus: suit.realityStatus,
                colorPrimary: suit.colorPrimary,
                colorSecondary: suit.colorSecondary,
                silhouette: suit.silhouette,
                materialLanguage: suit.materialLanguage,
                patternStyle: suit.patternStyle,
                armorLevel: suit.armorLevel,
                maskLensStyle: suit.maskLensStyle,
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
              <HolographicPanel corners className="vox-lift h-full p-4">
                <div className="mb-2 flex items-center justify-center overflow-hidden rounded-[var(--radius-sm)]" style={{ height: 140 }}>
                  <LazyMount
                    placeholder={
                      <div
                        className="h-full w-full rounded-[var(--radius-sm)]"
                        style={{
                          background: `linear-gradient(135deg, ${s.colorPrimary}33, ${s.colorSecondary}66)`,
                          border: `1px solid ${s.colorPrimary}55`,
                        }}
                      />
                    }
                  >
                    <HolographicModel
                      colorPrimary={s.colorPrimary}
                      colorSecondary={s.colorSecondary}
                      silhouette={s.silhouette as Silhouette}
                      materialLanguage={s.materialLanguage as MaterialLanguage}
                      patternStyle={s.patternStyle as PatternStyle}
                      armorLevel={s.armorLevel as ArmorLevel}
                      maskLensStyle={s.maskLensStyle as MaskLensStyle}
                      modelUrl={s.modelUrl}
                      size={140}
                      controls={false}
                    />
                  </LazyMount>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">{s.codename}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {s.designation} · {s.archetype}
                    </p>
                  </div>
                  <LabStatusBadge status={s.status} />
                </div>
                <div className="mt-2">
                  <RealityStatusTag status={s.realityStatus ?? "CONCEPT"} />
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
