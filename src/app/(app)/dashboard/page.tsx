import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { listProjects, listTasks } from "@/lib/projects/service";
import { getCognitiveProfile } from "@/lib/cognition/profile";
import { listMemories } from "@/lib/memory/service";
import { listIdeas } from "@/lib/projects/service";
import { listResearchItems } from "@/lib/research/service";
import { listProposals } from "@/lib/cognition/proposals";
import { listAgentRuns } from "@/lib/agents/service";
import { listNotifications } from "@/lib/notifications/service";
import { listConnections } from "@/lib/connections/service";
import { listPatterns } from "@/lib/cognition/patterns";
import { getAIProvider } from "@/lib/ai";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge, ConfidenceBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { VoxCore, type VoxCoreState } from "@/components/vox/VoxCore";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [
    activeProjects,
    openTasks,
    profile,
    memories,
    ideas,
    research,
    pendingProposals,
    agentRuns,
    notifications,
    connections,
    patterns,
  ] = await Promise.all([
    listProjects(user.id, "ACTIVE"),
    listTasks(user.id),
    getCognitiveProfile(user.id),
    listMemories(user.id),
    listIdeas(user.id),
    listResearchItems(user.id, 5),
    listProposals(user.id, "PROPOSED"),
    listAgentRuns(user.id, 5),
    listNotifications(user.id, true),
    listConnections(user.id),
    listPatterns(user.id),
  ]);

  const currentProject = activeProjects[0] ?? null;
  const openTasksSorted = openTasks
    .filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS")
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));
  const topTask = openTasksSorted[0] ?? null;
  const recentMemories = memories.slice(0, 4);
  const recentIdeas = ideas.slice(0, 4);
  const activeDimensions = profile.filter((d) => d.hasData);
  const provider = getAIProvider();
  const connectedCount = connections.filter((c) => c.status === "CONNECTED").length;
  const activePatterns = patterns.filter((p) => p.status === "ACTIVE");
  const coreState = aggregateCoreState(agentRuns, pendingProposals.length);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      {/* system status strip */}
      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] uppercase tracking-wide text-muted">
        <StatusDot label="VOX online" tone="success" />
        <StatusDot label={`memory synced · ${memories.length}`} tone="accent" />
        <StatusDot label={`connections · ${connectedCount}/${connections.length}`} tone={connectedCount > 0 ? "accent" : "neutral"} />
        <StatusDot label={`agents · ${agentRuns.length}`} tone="accent" />
        <StatusDot label="voice · not yet available" tone="neutral" />
      </div>

      {/* hero */}
      <GlassPanel variant="glow" className="flex flex-col items-center gap-5 px-6 py-10 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
        <div className="flex flex-col items-center gap-5 sm:flex-row">
          <VoxCore state={coreState} size="xl" showLabel />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">VOX</h1>
            <p className="mt-1 max-w-sm text-sm text-muted">{coreStateMessage(coreState, pendingProposals.length, agentRuns.length)}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href="/chat"
            className="rounded-lg bg-gradient-to-br from-accent to-accent-2 px-4 py-2 text-sm font-medium text-accent-foreground shadow-[0_0_20px_-4px_var(--accent)]"
          >
            Talk to VOX
          </Link>
          <Link href="/agents?new=1" className="glass-panel px-4 py-2 text-sm font-medium text-foreground">
            Start an agent run
          </Link>
        </div>
      </GlassPanel>

      {/* focus + brain teaser */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Current focus</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs text-muted-foreground">Active project</p>
              {currentProject ? (
                <p className="mt-1 font-medium text-foreground">{currentProject.name}</p>
              ) : (
                <Link href="/projects" className="mt-1 inline-block text-sm text-accent">
                  Create one →
                </Link>
              )}
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Top task</p>
              {topTask ? (
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-medium text-foreground">{topTask.title}</span>
                  <Badge tone={topTask.priority === "HIGH" ? "danger" : topTask.priority === "MEDIUM" ? "warning" : "neutral"}>
                    {topTask.priority.toLowerCase()}
                  </Badge>
                </div>
              ) : (
                <p className="mt-1 text-sm text-muted">Nothing queued</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <p className="text-xs text-muted-foreground">Proposals waiting on you</p>
              {pendingProposals.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-1">
                  {pendingProposals.slice(0, 3).map((p) => (
                    <li key={p.id} className="text-sm text-foreground">
                      {p.suggestedAction}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-sm text-muted">Nothing proposed right now</p>
              )}
              <Link href="/proposals" className="mt-2 inline-block text-sm font-medium text-accent">
                Review proposals →
              </Link>
            </div>
          </CardContent>
        </Card>

        <Link href="/brain" className="block">
          <GlassPanel variant="glow" className="flex h-full flex-col justify-between p-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">VOX Brain</p>
              <p className="mt-1 text-sm text-muted">A live map of memory, knowledge, and activity.</p>
            </div>
            <div className="mt-4 flex items-center justify-between">
              <div className="flex gap-4 text-xs text-muted-foreground">
                <span>
                  <span className="text-lg font-semibold text-foreground">{memories.length}</span> memories
                </span>
                <span>
                  <span className="text-lg font-semibold text-foreground">{activePatterns.length}</span> patterns
                </span>
              </div>
              <VoxCore state={activePatterns.length > 0 ? "thinking" : "idle"} size="md" />
            </div>
          </GlassPanel>
        </Link>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Agent runs</CardTitle>
          </CardHeader>
          <CardContent>
            {agentRuns.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {agentRuns.map((run) => (
                  <li key={run.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-foreground">{run.objective}</span>
                    <Badge tone={run.status === "FAILED" ? "danger" : run.status === "COMPLETED" ? "success" : "accent"}>
                      {run.status.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No agent runs yet" description="Give VOX an objective and it will plan and execute real steps." />
            )}
            <Link href="/agents" className="mt-3 inline-block text-sm font-medium text-accent">
              Open Agents →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Unread notifications</CardTitle>
          </CardHeader>
          <CardContent>
            {notifications.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {notifications.slice(0, 4).map((n) => (
                  <li key={n.id} className="text-sm">
                    <p className="text-foreground">{n.title}</p>
                    <p className="text-muted">{n.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing unread" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Connections</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground">
              {connectedCount} of {connections.length} services connected.
            </p>
            <Link href="/connections" className="mt-3 inline-block text-sm font-medium text-accent">
              Open Connections Hub →
            </Link>
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Cognitive signals</CardTitle>
          </CardHeader>
          <CardContent>
            {activeDimensions.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {activeDimensions.slice(0, 4).map((d) => (
                  <li key={d.dimension} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{d.dimension.toLowerCase().replace(/_/g, " ")}</span>
                    <span className="text-muted">{d.trend}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No cognitive data yet" description="See VOX Brain → Planning for more." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent memories</CardTitle>
          </CardHeader>
          <CardContent>
            {recentMemories.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {recentMemories.map((m) => (
                  <li key={m.id} className="flex items-start justify-between gap-2 text-sm">
                    <span className="text-foreground">{m.content}</span>
                    <ConfidenceBadge confidence={m.confidence} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No memories yet" description="Memories build up as you use Chat and Memory." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent ideas</CardTitle>
          </CardHeader>
          <CardContent>
            {recentIdeas.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {recentIdeas.map((i) => (
                  <li key={i.id} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{i.title}</span>
                    <Badge>{i.status.toLowerCase()}</Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No ideas captured yet" />
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Research activity</CardTitle>
          </CardHeader>
          <CardContent>
            {research.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {research.map((r) => (
                  <li key={r.id} className="text-sm">
                    <p className="text-foreground">{r.query}</p>
                    <p className="text-muted">{r.title}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No research run yet" description="Ask VOX to research something from the Research tab." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-2 text-sm">
              <li className="flex items-center justify-between">
                <span className="text-muted">AI provider</span>
                <span className="text-foreground">{provider.id}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-muted">Default model</span>
                <span className="text-foreground">{provider.defaultModel}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-muted">Open tasks</span>
                <span className="text-foreground">{openTasksSorted.length}</span>
              </li>
              <li className="flex items-center justify-between">
                <span className="text-muted">Active projects</span>
                <span className="text-foreground">{activeProjects.length}</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatusDot({ label, tone }: { label: string; tone: "success" | "accent" | "neutral" }) {
  const color = tone === "success" ? "var(--core-success)" : tone === "accent" ? "var(--accent)" : "var(--muted)";
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full vox-status-dot" style={{ background: color, color }} />
      {label}
    </span>
  );
}

function priorityRank(priority: string): number {
  return { HIGH: 2, MEDIUM: 1, LOW: 0 }[priority] ?? 0;
}

function aggregateCoreState(
  agentRuns: { status: string }[],
  pendingProposalCount: number
): VoxCoreState {
  if (agentRuns.some((r) => r.status === "RUNNING")) return "executing";
  if (agentRuns.some((r) => r.status === "PLANNING")) return "thinking";
  if (agentRuns.some((r) => r.status === "WAITING_FOR_PERMISSION")) return "waiting";
  if (pendingProposalCount > 0) return "waiting";
  return "idle";
}

function coreStateMessage(state: VoxCoreState, pendingProposalCount: number, agentRunCount: number): string {
  switch (state) {
    case "executing":
      return "An agent run is executing right now.";
    case "thinking":
      return "Planning an agent run.";
    case "waiting":
      return pendingProposalCount > 0
        ? `${pendingProposalCount} proposal${pendingProposalCount === 1 ? "" : "s"} waiting on you.`
        : "An agent run is waiting on a permission.";
    default:
      return agentRunCount > 0 ? "Idle. Everything's caught up." : "Idle. Give VOX something to do.";
  }
}
