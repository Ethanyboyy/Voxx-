"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { VoxCore } from "@/components/vox/VoxCore";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Command Center" },
  { href: "/brain", label: "VOX Brain", hero: true },
  { href: "/chat", label: "Conversation" },
  { href: "/memory", label: "Memory Vault" },
  { href: "/cognition", label: "Observations" },
  { href: "/graph", label: "Knowledge Graph" },
  { href: "/agents", label: "Agents" },
  { href: "/proposals", label: "Decisions & Proposals" },
  { href: "/connections", label: "Connections Hub" },
  { href: "/projects", label: "Mission Control" },
  { href: "/experiments", label: "Laboratory" },
  { href: "/research", label: "Research Intelligence" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "System Configuration" },
];

export function Sidebar({
  pendingProposalCount = 0,
  onNavigate,
  className,
}: {
  pendingProposalCount?: number;
  /** Called after a nav link is clicked — used by the mobile drawer to close itself. */
  onNavigate?: () => void;
  className?: string;
}) {
  const pathname = usePathname();

  return (
    <nav
      className={cn("glass-panel-strong flex h-full w-64 shrink-0 flex-col gap-1 rounded-none border-y-0 border-l-0 p-3 sm:w-60", className)}
      aria-label="Primary"
    >
      <div className="mb-3 flex items-center gap-2 px-2 pt-1 pb-3">
        <VoxCore state="idle" size="sm" />
        <div>
          <span className="text-sm font-semibold tracking-wide text-foreground">VOX</span>
          <p className="text-[11px] text-muted">Cognitive Operating System</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "mb-1 flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors sm:py-2",
                active
                  ? "bg-accent-muted text-accent shadow-[0_0_16px_-8px_var(--accent)]"
                  : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
                item.hero && !active && "text-foreground"
              )}
              aria-current={active ? "page" : undefined}
            >
              <span className="flex items-center gap-2">
                {item.hero ? <span className="h-1.5 w-1.5 rounded-full vox-status-dot" style={{ background: "var(--core-thinking)", color: "var(--core-thinking)" }} /> : null}
                {item.label}
              </span>
              {item.href === "/proposals" && pendingProposalCount > 0 ? (
                <span className="rounded-full bg-accent px-1.5 py-0.5 text-xs font-semibold text-accent-foreground">
                  {pendingProposalCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
