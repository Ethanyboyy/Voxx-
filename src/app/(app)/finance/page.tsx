import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { listConnections } from "@/lib/connections/service";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function FinancePage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const connections = await listConnections(user.id);
  const financial = connections.filter((c) => c.catalog.category === "FINANCIAL");
  const anyConnected = financial.some((c) => c.status === "CONNECTED");

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Finance</h1>
      <p className="mt-1 text-sm text-muted">
        VOX doesn&apos;t have a financial account connected, so there&apos;s no real balance or net worth to show here —
        this page won&apos;t invent one. Connect a provider below and real numbers will appear once it&apos;s live.
      </p>

      {!anyConnected ? (
        <GlassPanel className="mt-6 p-6">
          <EmptyState
            title="No financial data yet"
            description="Nothing is connected, so nothing is shown — not even a placeholder number."
          />
        </GlassPanel>
      ) : null}

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {financial.map((c) => (
          <GlassPanel key={c.catalog.service} className="flex items-center justify-between p-4">
            <div>
              <p className="text-sm font-medium text-foreground">{c.catalog.displayName}</p>
              <p className="text-xs text-muted">{c.catalog.category.replace(/_/g, " ").toLowerCase()}</p>
            </div>
            <Badge tone={c.status === "CONNECTED" ? "success" : "neutral"}>
              {c.status.toLowerCase().replace(/_/g, " ")}
            </Badge>
          </GlassPanel>
        ))}
      </div>

      <Link href="/connections" className="mt-6 inline-block text-sm font-medium text-accent">
        Open Connections Hub to connect one →
      </Link>
    </div>
  );
}
