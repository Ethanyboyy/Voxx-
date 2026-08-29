"use client";

import { type ReactNode, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { MobileBottomNav } from "@/components/layout/MobileBottomNav";
import { AccountMenu } from "@/components/layout/AccountMenu";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { CommandPalette } from "@/components/command/CommandPalette";
import { Atmosphere } from "@/components/ui/Instrument";

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function AppShell({
  children,
  userEmail,
  pendingProposalCount = 0,
}: {
  children: ReactNode;
  userEmail: string;
  pendingProposalCount?: number;
}) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <div className="relative flex h-screen overflow-hidden">
      {/* One horizon behind every room. It lives on the shell rather than on
          each page, which is what makes the Dashboard, the Brain and the Lab
          feel like places inside a single environment instead of separate
          screens. Fixed and inert, and BEHIND the columns — the sidebar and
          panels are translucent, so it reads through them as depth.

          It must not wrap the content: several rooms (the Brain especially)
          size themselves with h-full against <main>, and an extra layout box
          in that chain collapses them. */}
      <Atmosphere className="z-0" />

      {/* Desktop: persistent sidebar. Hidden below md — a fixed 224px column
          has no reasonable place on an iPhone-width viewport. */}
      <div className="relative z-10 hidden md:flex">
        <Sidebar pendingProposalCount={pendingProposalCount} userEmail={userEmail} />
      </div>

      {/* Mobile: slide-in drawer, triggered by the header hamburger button. */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="absolute inset-0 bg-black/40"
            onClick={() => setDrawerOpen(false)}
          />
          <div className="absolute inset-y-0 left-0 shadow-xl" style={{ paddingTop: "env(safe-area-inset-top)" }}>
            <Sidebar
              pendingProposalCount={pendingProposalCount}
              onNavigate={() => setDrawerOpen(false)}
              className="h-full"
              userEmail={userEmail}
            />
          </div>
        </div>
      ) : null}

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header
          className="instrument flex h-14 shrink-0 items-center gap-3 rounded-none border-x-0 border-t-0 px-4 sm:px-6"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <button
            type="button"
            aria-label="Open menu"
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-[var(--radius-xs)] text-foreground transition-colors hover:bg-surface-hover md:hidden"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon />
          </button>
          <span className="vox-headline text-sm md:hidden">VOX</span>
          <div className="ml-auto flex items-center gap-2">
            <CommandPalette />
            <NotificationBell />
            <AccountMenu userEmail={userEmail} />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto scrollbar-thin pb-16 md:pb-0">{children}</main>
      </div>

      <MobileBottomNav onMore={() => setDrawerOpen(true)} />
    </div>
  );
}
