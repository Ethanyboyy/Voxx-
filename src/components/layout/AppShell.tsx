import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/Sidebar";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { LogoutButton } from "@/components/layout/LogoutButton";

export function AppShell({
  children,
  userEmail,
  pendingProposalCount = 0,
}: {
  children: ReactNode;
  userEmail: string;
  pendingProposalCount?: number;
}) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar pendingProposalCount={pendingProposalCount} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center justify-end gap-3 border-b border-border px-6">
          <span className="text-sm text-muted">{userEmail}</span>
          <ThemeToggle />
          <LogoutButton />
        </header>
        <main className="flex-1 overflow-y-auto scrollbar-thin">{children}</main>
      </div>
    </div>
  );
}
