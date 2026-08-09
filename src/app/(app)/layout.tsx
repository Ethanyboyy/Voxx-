import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { listProposals } from "@/lib/cognition/proposals";
import { AppShell } from "@/components/layout/AppShell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const pending = await listProposals(user.id, "PROPOSED");

  return (
    <AppShell userEmail={user.email} pendingProposalCount={pending.length}>
      {children}
    </AppShell>
  );
}
