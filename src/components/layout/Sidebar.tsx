"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SVGProps } from "react";
import { cn } from "@/lib/utils/cn";

function VoxLogoMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg width="26" height="26" viewBox="0 0 40 40" aria-hidden="true" {...props}>
      <defs>
        <linearGradient id="vox-logo-g1" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#c4b5fd" />
          <stop offset="100%" stopColor="#7c3aed" />
        </linearGradient>
        <linearGradient id="vox-logo-g2" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#4c1d95" />
        </linearGradient>
        <linearGradient id="vox-logo-g3" x1="1" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#6d28d9" />
        </linearGradient>
      </defs>
      <polygon points="2,3 13,3 20,19 14,25" fill="url(#vox-logo-g1)" />
      <polygon points="13,3 20,19 20,30 14,25" fill="url(#vox-logo-g2)" opacity="0.85" />
      <polygon points="38,3 27,3 20,19 26,25" fill="url(#vox-logo-g3)" />
      <polygon points="27,3 20,19 20,30 26,25" fill="url(#vox-logo-g2)" opacity="0.7" />
    </svg>
  );
}

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
const IconTarget = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7" stroke="currentColor" />
    <circle cx="10" cy="10" r="3.7" stroke="currentColor" opacity="0.75" />
    <circle cx="10" cy="10" r="1" fill="currentColor" stroke="none" />
  </Icon>
);
const IconChecklist = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="3.5" width="4" height="4" rx="1" stroke="currentColor" />
    <path d="M4.3 5.5 5 6.2 6.2 4.8" stroke="currentColor" strokeWidth="1.2" />
    <path d="M9.5 5.5h7.5" stroke="currentColor" />
    <rect x="3" y="12" width="4" height="4" rx="1" stroke="currentColor" opacity="0.7" />
    <path d="M9.5 14h7.5" stroke="currentColor" opacity="0.7" />
  </Icon>
);
const IconDollar = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="10" cy="10" r="7" stroke="currentColor" />
    <path d="M10 5.5v9M12.5 7.5c0-1-1-1.6-2.5-1.6s-2.5.7-2.5 1.8.9 1.5 2.5 1.8c1.6.3 2.5.8 2.5 1.9S11.5 13.4 10 13.4s-2.5-.5-2.5-1.5" stroke="currentColor" />
  </Icon>
);
const IconSparklePen = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 16.5 5 13l7.3-7.3a1.5 1.5 0 0 1 2.1 0l.9.9a1.5 1.5 0 0 1 0 2.1L8 16l-4 .5Z" stroke="currentColor" strokeLinejoin="round" />
    <path d="M16 3.5l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4Z" fill="currentColor" stroke="none" />
  </Icon>
);
const IconBarChart = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M4 16.5V10M9.3 16.5V3.5M14.7 16.5V7.5" stroke="currentColor" strokeLinecap="round" />
  </Icon>
);

const NAV_ITEMS = [
  { href: "/dashboard", label: "Home", icon: IconHome },
  { href: "/chat", label: "Chat", icon: IconChat },
  { href: "/memory", label: "Memory", icon: IconMemory },
  { href: "/goals", label: "Goals", icon: IconTarget },
  { href: "/projects", label: "Projects", icon: IconFolder },
  { href: "/tasks", label: "Tasks", icon: IconChecklist },
  { href: "/finance", label: "Finance", icon: IconDollar },
  { href: "/content", label: "Content", icon: IconSparklePen },
  { href: "/graph", label: "Knowledge", icon: IconGraph },
  { href: "/agents", label: "Automations", icon: IconBolt },
  { href: "/analytics", label: "Analytics", icon: IconBarChart },
  { href: "/connections", label: "Integrations", icon: IconPlug },
  { href: "/brain", label: "VOX Brain", icon: IconBrain, hero: true },
  { href: "/cognition", label: "Observations", icon: IconEye },
  { href: "/proposals", label: "Proposals", icon: IconCheck },
  { href: "/experiments", label: "Laboratory", icon: IconFlask },
  { href: "/research", label: "Research", icon: IconSearch },
  { href: "/activity", label: "Activity", icon: IconPulse },
  { href: "/settings", label: "Settings", icon: IconGear },
];

export function Sidebar({
  pendingProposalCount = 0,
  onNavigate,
  className,
  userEmail,
}: {
  pendingProposalCount?: number;
  /** Called after a nav link is clicked — used by the mobile drawer to close itself. */
  onNavigate?: () => void;
  className?: string;
  userEmail?: string;
}) {
  const pathname = usePathname();

  return (
    <nav
      className={cn("glass-panel-strong flex h-full w-64 shrink-0 flex-col gap-1 rounded-none border-y-0 border-l-0 p-3 sm:w-60", className)}
      aria-label="Primary"
    >
      <div className="mb-3 flex items-center gap-2 px-2 pt-1 pb-3">
        <VoxLogoMark />
        <span className="text-lg font-bold text-foreground">VOX</span>
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
      {userEmail ? (
        <div className="mt-2 flex items-center gap-2.5 border-t border-border px-2 pt-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent-muted text-xs font-semibold text-accent">
            {userEmail.trim().charAt(0).toUpperCase() || "?"}
          </span>
          <p className="truncate text-sm font-medium text-foreground">{userEmail.split("@")[0]}</p>
        </div>
      ) : null}
    </nav>
  );
}
