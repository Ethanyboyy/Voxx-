"use client";

import { useMemo } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { HolographicPanel, LabSectionLabel } from "@/components/lab/primitives";
import { cn } from "@/lib/utils/cn";

export interface TrainingModuleListItem {
  id: string;
  name: string;
  category: string;
  difficulty: string;
  description: string;
  objective: string;
  durationMinutesEstimate: number;
}

export interface TrainingProgress {
  totalSessions: number;
  byCategory: Record<string, { count: number; avgScore: number; bestScore: number }>;
  recent: { id: string; score: number; createdAt: string; module: { name: string } }[];
}

const CATEGORY_LABEL: Record<string, string> = {
  MOVEMENT: "Movement",
  AGILITY: "Agility",
  BALANCE: "Balance",
  REACTION: "Reaction",
  OBSTACLE_NAVIGATION: "Obstacle Navigation",
  DEFENSIVE_POSITIONING: "Defensive Positioning",
  SITUATIONAL_AWARENESS: "Situational Awareness",
  DE_ESCALATION: "De-escalation",
  EMERGENCY_ESCAPE: "Emergency Escape",
  SPARRING: "Sparring",
};

const DIFFICULTY_CLASS: Record<string, string> = {
  BEGINNER: "text-success border-success/40 bg-success/10",
  INTERMEDIATE: "text-accent-blue border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10",
  ADVANCED: "text-warning border-warning/40 bg-warning/10",
  EXPERIMENTAL: "text-danger border-danger/40 bg-danger-muted",
};

function DifficultyBadge({ difficulty }: { difficulty: string }) {
  return (
    <span
      className={cn(
        "lab-mono inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        DIFFICULTY_CLASS[difficulty] ?? "text-muted-foreground border-border bg-surface-hover"
      )}
    >
      {difficulty.toLowerCase()}
    </span>
  );
}

export function TrainingCenterClient({
  modules,
  progress,
}: {
  modules: TrainingModuleListItem[];
  progress: TrainingProgress;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, TrainingModuleListItem[]>();
    for (const m of modules) {
      const list = map.get(m.category) ?? [];
      list.push(m);
      map.set(m.category, list);
    }
    return Array.from(map.entries());
  }, [modules]);

  const categoryEntries = Object.entries(progress.byCategory);

  return (
    <div className="mt-5 flex flex-col gap-5">
      <HolographicPanel className="p-4">
        <LabSectionLabel>Training Progress</LabSectionLabel>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="glass-panel px-3 py-2">
            <p className="lab-mono text-2xl font-bold text-accent">{progress.totalSessions}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Total sessions</p>
          </div>
          <div className="glass-panel px-3 py-2">
            <p className="lab-mono text-2xl font-bold text-accent">{categoryEntries.length}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Categories trained</p>
          </div>
        </div>

        {categoryEntries.length === 0 ? (
          <p className="mt-4 text-sm text-muted">No sessions recorded yet — complete a module below to start building your record.</p>
        ) : (
          <div className="mt-4 space-y-2">
            {categoryEntries.map(([category, stats]) => (
              <div key={category} className="flex items-center justify-between gap-3 border-t border-border pt-2 text-sm first:border-t-0 first:pt-0">
                <span className="text-foreground">{CATEGORY_LABEL[category] ?? category}</span>
                <span className="lab-mono flex gap-3 text-xs text-muted-foreground">
                  <span>{stats.count} session{stats.count === 1 ? "" : "s"}</span>
                  <span>avg {Math.round(stats.avgScore)}</span>
                  <span className="text-accent">best {stats.bestScore}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </HolographicPanel>

      {modules.length === 0 ? (
        <EmptyState title="No training modules" description="No modules have been seeded for the Training Center yet." />
      ) : (
        grouped.map(([category, mods]) => (
          <div key={category}>
            <LabSectionLabel>{CATEGORY_LABEL[category] ?? category}</LabSectionLabel>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {mods.map((m) => {
                const stats = progress.byCategory[m.category];
                return (
                  <Link key={m.id} href={`/lab/training/${m.id}`}>
                    <HolographicPanel corners className="vox-lift h-full p-4 transition-colors hover:border-[var(--border-strong)] hover:bg-surface-hover">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-semibold text-foreground">{m.name}</p>
                        <DifficultyBadge difficulty={m.difficulty} />
                      </div>
                      <p className="mt-1.5 text-xs text-muted">{m.description}</p>
                      <div className="mt-3 flex items-center justify-between text-[10px] text-muted-foreground">
                        <span className="lab-mono uppercase tracking-wider">~{m.durationMinutesEstimate} min</span>
                        {stats ? <span className="lab-mono text-accent">best {stats.bestScore}</span> : null}
                      </div>
                    </HolographicPanel>
                  </Link>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
