"use client";

import { type ReactNode, useState } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { LogoutButton } from "@/components/layout/LogoutButton";

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
    <div className="flex h-screen overflow-hidden">
      {/* Desktop: persistent sidebar. Hidden below md — a fixed 224px column
          has no reasonable place on an iPhone-width viewport. */}
      <div className="hidden md:flex">
        <Sidebar pendingProposalCount={pendingProposalCount} />
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
            />
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6"
          style={{ paddingTop: "env(safe-area-inset-top)" }}
        >
          <button
            type="button"
            aria-label="Open menu"
            className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-foreground md:hidden"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon />
          </button>
          <span className="text-sm font-semibold text-foreground md:hidden">VOX</span>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm text-muted sm:inline">{userEmail}</span>
            <ThemeToggle />
            <LogoutButton />
          </div>
        </header>
        <main className="flex-1 overflow-y-auto scrollbar-thin">{children}</main>
      </div>
    </div>
  );
}
