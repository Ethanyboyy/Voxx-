"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { HolographicPanel, LabStatusBadge } from "@/components/lab/primitives";
import { NewGadgetForm } from "@/components/lab/NewGadgetForm";

interface GadgetListItem {
  id: string;
  name: string;
  category: string;
  status: string;
  stats: { durability: number; sensorAccuracy: number; reliability: number; massKg: number; estimatedCostUsd: number } | null;
}

export function EngineeringBayClient({
  initialGadgets,
  projects,
}: {
  initialGadgets: GadgetListItem[];
  projects: { id: string; name: string }[];
}) {
  const [gadgets, setGadgets] = useState(initialGadgets);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const router = useRouter();

  const categories = useMemo(() => Array.from(new Set(gadgets.map((g) => g.category))).sort(), [gadgets]);

  const filtered = gadgets.filter((g) => {
    if (category !== "all" && g.category !== category) return false;
    if (query && !g.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search gadgets…"
          className="max-w-xs"
        />
        <Select value={category} onChange={(e) => setCategory(e.target.value)} className="max-w-[180px]">
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <div className="flex-1" />
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New Gadget"}
        </Button>
      </div>

      {showForm ? (
        <NewGadgetForm
          projects={projects}
          onCreated={(gadget) => {
            setGadgets((prev) => [
              {
                id: gadget.id,
                name: gadget.name,
                category: gadget.category,
                status: gadget.status,
                stats: null,
              },
              ...prev,
            ]);
            setShowForm(false);
            router.push(`/lab/engineering/${gadget.id}`);
          }}
        />
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState title="No gadgets found" description="Adjust your filters, or create a new design." />
      ) : (
        <p className="text-xs text-muted-foreground">
          {filtered.length} gadget{filtered.length === 1 ? "" : "s"}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filtered.map((g) => (
          <Link key={g.id} href={`/lab/engineering/${g.id}`}>
            <HolographicPanel corners className="vox-lift h-full p-4 transition-colors hover:border-[var(--border-strong)] hover:bg-surface-hover">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-foreground">{g.name}</p>
                  <p className="text-[11px] text-muted-foreground">{g.category}</p>
                </div>
                <LabStatusBadge status={g.status} />
              </div>
              {g.stats ? (
                <div className="lab-mono mt-3 grid grid-cols-3 gap-1 text-[10px] text-muted">
                  <span>DUR {g.stats.durability}</span>
                  <span>SNS {g.stats.sensorAccuracy}</span>
                  <span>REL {g.stats.reliability}</span>
                </div>
              ) : null}
            </HolographicPanel>
          </Link>
        ))}
      </div>
    </div>
  );
}
