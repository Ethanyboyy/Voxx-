"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { SVGProps } from "react";
import { cn } from "@/lib/utils/cn";
import { IconHome, IconChat, IconBrain, IconFolder } from "@/components/layout/Sidebar";

function IconMore(p: SVGProps<SVGSVGElement>) {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" {...p}>
      <circle cx="4.5" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="10" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

const TABS = [
  { href: "/dashboard", label: "Home", icon: IconHome },
  { href: "/chat", label: "Chat", icon: IconChat },
  { href: "/brain", label: "Brain", icon: IconBrain },
  { href: "/projects", label: "Projects", icon: IconFolder },
] as const;

/**
 * Fixed bottom tab bar, mobile only. A persistent left sidebar makes no
 * sense on an iPhone-width viewport, but the drawer alone buries the
 * handful of screens someone actually jumps between constantly — this
 * surfaces those plus a "More" tab that opens the full drawer for
 * everything else.
 */
export function MobileBottomNav({ onMore }: { onMore: () => void }) {
  const pathname = usePathname();

  return (
    <nav
      className="glass-panel-strong fixed inset-x-0 bottom-0 z-40 flex items-stretch justify-around rounded-none border-x-0 border-b-0 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      aria-label="Primary"
    >
      {TABS.map((tab) => {
        const active = pathname === tab.href || pathname?.startsWith(tab.href + "/");
        const TabIcon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium",
              active ? "text-accent" : "text-muted-foreground"
            )}
            aria-current={active ? "page" : undefined}
          >
            <TabIcon className={active ? "text-accent" : "text-muted-foreground"} />
            {tab.label}
          </Link>
        );
      })}
      <button
        type="button"
        onClick={onMore}
        className="flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium text-muted-foreground"
      >
        <IconMore className="text-muted-foreground" />
        More
      </button>
    </nav>
  );
}
