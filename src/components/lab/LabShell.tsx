"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";
import { InfoModeProvider, InfoModeToggle } from "@/components/lab/InfoMode";
import { LabCommandBar } from "@/components/lab/LabCommandBar";

const SECTIONS: { href: string; label: string; icon: string }[] = [
  { href: "/lab", label: "Laboratory", icon: "◈" },
  { href: "/lab/suits", label: "Suit Bay", icon: "◇" },
  { href: "/lab/engineering", label: "Engineering Bay", icon: "⚙" },
  { href: "/lab/web", label: "Web Lab", icon: "✕" },
  { href: "/lab/simulation", label: "Simulation Center", icon: "▲" },
  { href: "/lab/training", label: "Training Center", icon: "◉" },
  { href: "/lab/scenarios", label: "Scenario Generator", icon: "◐" },
  { href: "/lab/experiments", label: "Experiments", icon: "✦" },
  { href: "/lab/research", label: "Research", icon: "❖" },
  { href: "/lab/projects", label: "Projects", icon: "▣" },
  { href: "/lab/materials", label: "Materials", icon: "◆" },
  { href: "/lab/knowledge", label: "Data / Knowledge", icon: "≡" },
];

export function LabShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <InfoModeProvider>
      <div className="lab-grid-bg absolute inset-0 -z-10" />
      <div className="flex min-h-full flex-col">
        <header className="glass-panel-strong sticky top-0 z-30 mx-4 mt-3 flex items-center justify-between gap-3 rounded-2xl px-4 py-2.5">
          <div className="flex items-center gap-2">
            <span className="lab-mono text-sm font-bold tracking-[0.2em] text-accent">SPIDER-MAN LABORATORY</span>
            <span className="hidden text-[10px] text-muted-foreground sm:inline">v0.1 · Foundation</span>
          </div>
          <div className="flex items-center gap-3">
            <InfoModeToggle />
            <LabCommandBar />
          </div>
        </header>

        <div className="flex flex-1 gap-4 px-4 pb-4 pt-3">
          <nav aria-label="Laboratory sections" className="glass-panel hidden w-52 shrink-0 self-start p-2 lg:block">
            {SECTIONS.map((s) => {
              const active = pathname === s.href || (s.href !== "/lab" && pathname?.startsWith(s.href));
              return (
                <Link
                  key={s.href}
                  href={s.href}
                  className={cn(
                    "mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                    active ? "bg-accent-muted text-accent shadow-[0_0_14px_-8px_var(--accent)]" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                  )}
                >
                  <span aria-hidden="true" className="w-4 text-center opacity-80">{s.icon}</span>
                  {s.label}
                </Link>
              );
            })}
          </nav>

          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    </InfoModeProvider>
  );
}
