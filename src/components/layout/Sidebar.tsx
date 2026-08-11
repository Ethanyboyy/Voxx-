"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SVGProps } from "react";
import { cn } from "@/lib/utils/cn";
import { VoxCore } from "@/components/vox/VoxCore";

function Icon(props: SVGProps<SVGSVGElement>) {
  return <svg width="17" height="17" viewBox="0 0 20 20" fill="none" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props} />;
}
export const IconHome = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 9.5 10 3l7 6.5" stroke="currentColor" />
    <path d="M5 8.5V16a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V8.5" stroke="currentColor" />
  </Icon>
);
export const IconBrain = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="6.5" stroke="currentColor" />
    <path d="M10 3.5v13M6 6.2l8 7.6M14 6.2l-8 7.6" stroke="currentColor" opacity="0.7" />
  </Icon>
);
export const IconChat = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 4.5h14a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H8l-4 3v-3H3a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" stroke="currentColor" />
  </Icon>
);
const IconMemory = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <ellipse cx="10" cy="5" rx="6.5" ry="2.3" stroke="currentColor" />
    <path d="M3.5 5v10c0 1.27 2.9 2.3 6.5 2.3s6.5-1.03 6.5-2.3V5" stroke="currentColor" />
    <path d="M3.5 10c0 1.27 2.9 2.3 6.5 2.3s6.5-1.03 6.5-2.3" stroke="currentColor" opacity="0.6" />
  </Icon>
);
const IconEye = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M1.5 10S4.5 4.5 10 4.5 18.5 10 18.5 10 15.5 15.5 10 15.5 1.5 10 1.5 10Z" stroke="currentColor" />
    <circle cx="10" cy="10" r="2.3" stroke="currentColor" />
  </Icon>
);
const IconGraph = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="5" cy="6" r="2" stroke="currentColor" />
    <circle cx="15" cy="5" r="2" stroke="currentColor" />
    <circle cx="9" cy="15" r="2" stroke="currentColor" />
    <path d="M6.6 7.2 13.3 5.4M6.3 7.6l2 6M13.6 6.6l-2.9 6.9" stroke="currentColor" opacity="0.7" />
  </Icon>
);
const IconBolt = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M11 2 4 11.5h5L9 18l7-9.5h-5L11 2Z" stroke="currentColor" strokeLinejoin="round" />
  </Icon>
);
const IconCheck = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" />
    <path d="M6.5 10.3 9 12.8l4.5-5.6" stroke="currentColor" />
  </Icon>
);
const IconPlug = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M7 3v4M13 3v4M5 7h10v2a5 5 0 0 1-5 5 5 5 0 0 1-5-5V7ZM10 14v3" stroke="currentColor" />
  </Icon>
);
export const IconFolder = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 6a1 1 0 0 1 1-1h4l1.5 2H16a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z" stroke="currentColor" strokeLinejoin="round" />
  </Icon>
);
const IconFlask = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M8 3h4M8.5 3v5L4.2 15a1.5 1.5 0 0 0 1.3 2.2h9a1.5 1.5 0 0 0 1.3-2.2L11.5 8V3" stroke="currentColor" strokeLinejoin="round" />
    <path d="M6.5 13h7" stroke="currentColor" opacity="0.7" />
  </Icon>
);
const IconSearch = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="8.7" cy="8.7" r="5.2" stroke="currentColor" />
    <path d="m16.5 16.5-3.6-3.6" stroke="currentColor" />
  </Icon>
);
const IconPulse = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M2 10.5h3.5l1.8-5.5 2.7 11 2.2-8 1.3 2.5H18" stroke="currentColor" strokeLinejoin="round" />
  </Icon>
);
const IconGear = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="2.6" stroke="currentColor" />
    <path
      d="M10 3v1.8M10 15.2V17M17 10h-1.8M4.8 10H3M14.8 5.2l-1.3 1.3M6.5 13.5l-1.3 1.3M14.8 14.8l-1.3-1.3M6.5 6.5 5.2 5.2"
      stroke="currentColor"
    />
  </Icon>
);

const NAV_ITEMS = [
  { href: "/dashboard", label: "Home", icon: IconHome },
  { href: "/brain", label: "VOX Brain", icon: IconBrain, hero: true },
  { href: "/chat", label: "Chat", icon: IconChat },
  { href: "/memory", label: "Memory", icon: IconMemory },
  { href: "/cognition", label: "Observations", icon: IconEye },
  { href: "/graph", label: "Knowledge", icon: IconGraph },
  { href: "/agents", label: "Automations", icon: IconBolt },
  { href: "/proposals", label: "Proposals", icon: IconCheck },
  { href: "/connections", label: "Integrations", icon: IconPlug },
  { href: "/projects", label: "Projects", icon: IconFolder },
  { href: "/experiments", label: "Laboratory", icon: IconFlask },
  { href: "/research", label: "Research", icon: IconSearch },
  { href: "/activity", label: "Activity", icon: IconPulse },
  { href: "/settings", label: "Settings", icon: IconGear },
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
          const ItemIcon = item.icon;
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
              <span className="flex items-center gap-2.5">
                <ItemIcon className={active ? "text-accent" : "text-muted-foreground"} />
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
