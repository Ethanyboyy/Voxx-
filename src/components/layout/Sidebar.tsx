"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils/cn";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/chat", label: "Chat" },
  { href: "/memory", label: "Memory" },
  { href: "/cognition", label: "Cognition" },
  { href: "/graph", label: "Graph" },
  { href: "/agents", label: "Agents" },
  { href: "/proposals", label: "Proposals" },
  { href: "/connections", label: "Connections" },
  { href: "/projects", label: "Projects" },
  { href: "/experiments", label: "Experiments" },
  { href: "/research", label: "Research" },
  { href: "/activity", label: "Activity" },
  { href: "/settings", label: "Settings" },
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
      className={cn("flex h-full w-64 shrink-0 flex-col gap-1 border-r border-border bg-surface p-3 sm:w-56", className)}
      aria-label="Primary"
    >
      <div className="mb-4 px-2 pt-1">
        <span className="text-sm font-semibold tracking-tight text-foreground">VOX</span>
        <p className="text-xs text-muted">Cognitive Operating System</p>
      </div>
      {NAV_ITEMS.map((item) => {
        const active = pathname === item.href || pathname?.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-medium transition-colors sm:py-2",
              active ? "bg-accent-muted text-accent" : "text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            )}
            aria-current={active ? "page" : undefined}
          >
            {item.label}
            {item.href === "/proposals" && pendingProposalCount > 0 ? (
              <span className="rounded-full bg-accent px-1.5 py-0.5 text-xs font-semibold text-accent-foreground">
                {pendingProposalCount}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
