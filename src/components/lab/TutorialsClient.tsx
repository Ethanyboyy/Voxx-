"use client";

import { useMemo } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { HolographicPanel, LabSectionLabel } from "@/components/lab/primitives";
import { cn } from "@/lib/utils/cn";

export interface TutorialListItem {
  id: string;
  title: string;
  category: string;
  difficulty: string;
  completed: boolean;
  score: number | null;
  locked: boolean;
  prerequisiteTitle: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  SUIT_TECHNOLOGY: "Suit Technology",
  MATERIALS: "Materials",
  PHYSICS: "Physics",
  ENGINEERING: "Engineering",
  MOVEMENT: "Movement",
  DEFENSIVE_AWARENESS: "Defensive Awareness",
  SIMULATION: "Simulation",
  EQUIPMENT_OPERATION: "Equipment Operation",
  LABORATORY_SAFETY: "Laboratory Safety",
};

export function TutorialsClient({ tutorials }: { tutorials: TutorialListItem[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, TutorialListItem[]>();
    for (const t of tutorials) {
      const list = map.get(t.category) ?? [];
      list.push(t);
      map.set(t.category, list);
    }
    return Array.from(map.entries());
  }, [tutorials]);

  if (tutorials.length === 0) {
    return (
      <div className="mt-5">
        <EmptyState title="No tutorials yet" description="No tutorials have been seeded for the Laboratory yet." />
      </div>
    );
  }

  return (
    <div className="mt-5 flex flex-col gap-5">
      {grouped.map(([category, items]) => (
        <div key={category}>
          <LabSectionLabel>{CATEGORY_LABEL[category] ?? category}</LabSectionLabel>
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((t) => {
              const card = (
                <HolographicPanel
                  corners
                  className={cn(
                    "h-full p-4 transition-colors",
                    t.locked ? "opacity-50" : "vox-lift hover:border-[var(--border-strong)] hover:bg-surface-hover"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-foreground">{t.title}</p>
                    {t.completed ? (
                      <span className="lab-mono shrink-0 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
                        Done
                      </span>
                    ) : t.locked ? (
                      <span className="lab-mono shrink-0 rounded-full border border-border bg-surface-hover px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Locked
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">{t.difficulty.toLowerCase()}</p>
                  {t.completed && t.score != null ? (
                    <p className="lab-mono mt-2 text-xs text-accent">Score {t.score}/100</p>
                  ) : null}
                  {t.locked && t.prerequisiteTitle ? (
                    <p className="mt-2 text-[10px] text-muted-foreground">Requires: {t.prerequisiteTitle}</p>
                  ) : null}
                </HolographicPanel>
              );
              return t.locked ? (
                <div key={t.id} aria-disabled="true" className="cursor-not-allowed select-none">
                  {card}
                </div>
              ) : (
                <Link key={t.id} href={`/lab/training/tutorials/${t.id}`}>
                  {card}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
