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
  { href: "/proposals", label: "Proposals" },
  { href: "/projects", label: "Projects" },
  { href: "/experiments", label: "Experiments" },
  { href: "/research", label: "Research" },
  { href: "/settings", label: "Settings" },
];

export function Sidebar({ pendingProposalCount = 0 }: { pendingProposalCount?: number }) {
  const pathname = usePathname();

  return (
    <nav className="flex h-full w-56 shrink-0 flex-col gap-1 border-r border-border bg-surface p-3" aria-label="Primary">
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
            className={cn(
              "flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors",
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
