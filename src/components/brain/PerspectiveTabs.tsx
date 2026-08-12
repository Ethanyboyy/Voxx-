"use client";

import { cn } from "@/lib/utils/cn";

export type Perspective = "MAP" | "OBJECTIVE" | "OPPORTUNITY" | "PROJECT" | "MEMORY" | "RESEARCH" | "ACTIVITY" | "SYSTEM";

const PERSPECTIVES: { id: Perspective; label: string }[] = [
  { id: "MAP", label: "Map" },
  { id: "OBJECTIVE", label: "Objective" },
  { id: "OPPORTUNITY", label: "Opportunity" },
  { id: "PROJECT", label: "Project" },
  { id: "MEMORY", label: "Memory" },
  { id: "RESEARCH", label: "Research" },
  { id: "ACTIVITY", label: "Activity" },
  { id: "SYSTEM", label: "System" },
];

export function perspectiveLabel(p: Perspective): string {
  return PERSPECTIVES.find((x) => x.id === p)?.label ?? p;
}

export function PerspectiveTabs({ value, onChange }: { value: Perspective; onChange: (p: Perspective) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto scrollbar-thin">
      {PERSPECTIVES.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onChange(p.id)}
          className={cn(
            "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
            value === p.id
              ? "border-[var(--border-strong)] bg-accent-muted text-accent shadow-[0_0_14px_-6px_var(--accent)]"
              : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
