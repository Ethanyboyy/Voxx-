import Link from "next/link";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth/session";
import { listProjects, listTasks, listGoals } from "@/lib/projects/service";
import { getCognitiveProfile } from "@/lib/cognition/profile";
import { listMemories } from "@/lib/memory/service";
import { listIdeas } from "@/lib/projects/service";
import { listResearchItems } from "@/lib/research/service";
import { listProposals } from "@/lib/cognition/proposals";
import { listAgentRuns } from "@/lib/agents/service";
import { listNotifications } from "@/lib/notifications/service";
import { listConnections } from "@/lib/connections/service";
import { listPatterns } from "@/lib/cognition/patterns";
import { listConversations } from "@/lib/chat/service";
import { getAIProvider } from "@/lib/ai";
import { getActiveObjective, getNextBestAction } from "@/lib/objectives/service";
import { listRecentEvents } from "@/lib/observability/events";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge, ConfidenceBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import type { VoxCoreState } from "@/components/vox/VoxCore";
import { MountainHero } from "@/components/dashboard/MountainHero";
import { BrainPreview } from "@/components/dashboard/BrainPreview";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [
    activeProjects,
    allTasks,
    goals,
    profile,
    memories,
    ideas,
    research,
    pendingProposals,
    agentRuns,
    notifications,
    connections,
    patterns,
    conversations,
    activeObjective,
    nextBestAction,
    recentEvents,
  ] = await Promise.all([
    listProjects(user.id, "ACTIVE"),
    listTasks(user.id),
    listGoals(user.id),
    getCognitiveProfile(user.id),
    listMemories(user.id),
    listIdeas(user.id),
    listResearchItems(user.id, 5),
    listProposals(user.id, "PROPOSED"),
    listAgentRuns(user.id, 5),
    listNotifications(user.id, true),
    listConnections(user.id),
    listPatterns(user.id),
    listConversations(user.id),
    getActiveObjective(user.id),
    getNextBestAction(user.id),
    listRecentEvents(user.id, 4),
  ]);

  const displayName = user.name?.trim() || user.email.split("@")[0];
  const openTasksSorted = allTasks
    .filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS")
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));
  const doneTasks = allTasks.filter((t) => t.status === "DONE");
  const activeGoals = goals.filter((g) => g.status === "ACTIVE");
  const achievedGoals = goals.filter((g) => g.status === "ACHIEVED");
  const recentMemories = memories.slice(0, 4);
  const recentIdeas = ideas.slice(0, 4);
  const activeDimensions = profile.filter((d) => d.hasData);
  const provider = getAIProvider();
  const connectedCount = connections.filter((c) => c.status === "CONNECTED").length;
  const activePatterns = patterns.filter((p) => p.status === "ACTIVE");
  const coreState = aggregateCoreState(agentRuns, pendingProposals.length);
  const recentConversations = conversations.slice(0, 5);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      {/* greeting header */}
      <div className="glass-panel relative overflow-hidden p-6 sm:p-8" style={{ minHeight: 168 }}>
        <MountainHero />
        <div className="relative flex h-full flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h1 className="vox-headline text-2xl sm:text-3xl">
              {greeting()}, {displayName}.
            </h1>
            <p className="mt-1 text-sm text-muted">{coreStateMessage(coreState, pendingProposals.length, agentRuns.length)}</p>
          </div>
          <Link
            href="/chat"
            className="vox-press flex items-center gap-2 rounded-lg bg-gradient-to-br from-accent to-accent-2 px-4 py-2 text-sm font-medium text-accent-foreground shadow-[var(--shadow-ambient-xs)] transition-[box-shadow,filter] duration-200 ease-[var(--ease-luxury)] hover:shadow-[var(--shadow-ambient-sm)] hover:brightness-110"
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" aria-hidden="true">
              <path d="M10 3.5v13M3.5 10h13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            New Chat
          </Link>
        </div>
      </div>

      {/* Command Center — what VOX is actually doing right now, no fabricated state */}
      <div className="mt-5 grid grid-cols-1 gap-3 lg:grid-cols-4">
        <Link href="/objectives" className="vox-lift glass-panel block px-4 py-3.5">
          <p className="vox-eyebrow">Current Objective</p>
          {activeObjective ? (
            <>
              <p className="mt-1.5 truncate text-sm font-semibold text-foreground">{activeObjective.title}</p>
              <p className="mt-1 text-xs text-muted">
                {activeObjective.targetValue != null
                  ? `${activeObjective.currentValue ?? 0} / ${activeObjective.targetValue} ${activeObjective.targetUnit ?? ""}`
                  : "In progress"}
              </p>
            </>
          ) : (
            <p className="mt-1.5 text-sm text-muted">None set — create one to focus VOX.</p>
          )}
        </Link>

        <Link href="/objectives" className="vox-lift glass-panel block px-4 py-3.5">
          <p className="vox-eyebrow">Next Best Action</p>
          {nextBestAction?.action ? (
            <>
              <p className="mt-1.5 text-sm font-semibold text-foreground line-clamp-2">{nextBestAction.action}</p>
              {nextBestAction.opportunity ? (
                <p className="mt-1 truncate text-xs text-muted">{nextBestAction.opportunity.title}</p>
              ) : null}
            </>
          ) : nextBestAction?.opportunity ? (
            <p className="mt-1.5 text-sm text-muted">
              &quot;{nextBestAction.opportunity.title}&quot; is the top opportunity — no next action set yet.
            </p>
          ) : (
            <p className="mt-1.5 text-sm text-muted">
              {activeObjective ? "No opportunities evaluated yet." : "Set an objective first."}
            </p>
          )}
        </Link>

        <Link href="/proposals" className="vox-lift glass-panel block px-4 py-3.5">
          <p className="vox-eyebrow">Pending Approval</p>
          <p className="mt-1.5 text-sm font-semibold text-foreground">
            {pendingProposals.length > 0
              ? `${pendingProposals.length} proposal${pendingProposals.length === 1 ? "" : "s"} waiting`
              : "Nothing waiting"}
          </p>
          <p className="mt-1 truncate text-xs text-muted">
            {pendingProposals[0]?.suggestedAction ?? "VOX asks before acting."}
          </p>
        </Link>

        <Link href="/activity" className="vox-lift glass-panel block px-4 py-3.5">
          <p className="vox-eyebrow">Recent Activity</p>
          {recentEvents.length > 0 ? (
            <ul className="mt-1.5 flex flex-col gap-0.5">
              {recentEvents.slice(0, 2).map((e) => (
                <li key={e.id} className="truncate text-xs text-foreground">
                  {humanizeEventType(e.type)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1.5 text-sm text-muted">Nothing recorded yet.</p>
          )}
        </Link>
      </div>

      {/* stat row — every number here is a real, live count */}
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Goals Progress"
          value={goals.length > 0 ? `${Math.round((achievedGoals.length / goals.length) * 100)}%` : "—"}
          sub={`${activeGoals.length} active`}
          progress={goals.length > 0 ? achievedGoals.length / goals.length : null}
        />
        <StatCard label="Tasks Completed" value={String(doneTasks.length)} sub="all time" />
        <StatCard label="Open Tasks" value={String(openTasksSorted.length)} sub="across projects" />
        <StatCard label="Connections" value={`${connectedCount}/${connections.length}`} sub="services live" />
      </div>

      {/* Today's Plan / Recent Conversations / Vox Mind */}
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Today&apos;s Plan</CardTitle>
          </CardHeader>
          <CardContent>
            {openTasksSorted.length > 0 ? (
              <ul className="flex flex-col gap-2.5">
                {openTasksSorted.slice(0, 6).map((t) => (
                  <li key={t.id} className="flex items-center gap-2.5 text-sm">
                    <span
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
                      style={{
                        borderColor:
                          t.priority === "HIGH" ? "var(--danger)" : t.priority === "MEDIUM" ? "var(--warning)" : "var(--border-strong)",
                      }}
                    />
                    <span className="truncate text-foreground">{t.title}</span>
                    {t.dueDate ? (
                      <span className="ml-auto shrink-0 text-xs text-muted">
                        {t.dueDate.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing queued" description="Create a task to see it here." />
            )}
            <Link href="/projects" className="mt-3 inline-block text-sm font-medium text-accent">
              Open Mission Control →
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Conversations</CardTitle>
          </CardHeader>
          <CardContent>
            {recentConversations.length > 0 ? (
              <ul className="flex flex-col gap-2.5">
                {recentConversations.map((c) => (
                  <li key={c.id}>
                    <Link href="/chat" className="flex items-center justify-between gap-2 text-sm hover:text-accent">
                      <span className="truncate text-foreground">{c.title}</span>
                      <span className="shrink-0 text-xs text-muted">{formatRelativeTime(c.updatedAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No conversations yet" description="Start one from Chat." />
            )}
          </CardContent>
        </Card>

        <Link href="/brain" className="vox-lift block">
          <GlassPanel variant="glow" className="flex h-full flex-col justify-between overflow-hidden p-5">
            <div>
              <p className="text-sm font-semibold text-foreground">Vox Mind</p>
            </div>
            <div className="-my-2 h-28 w-full">
              <BrainPreview />
            </div>
            <div>
              <p className="text-sm text-muted">
                Memory: {memories.length} · Patterns: {activePatterns.length}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">Always learning. Always improving.</p>
            </div>
          </GlassPanel>
        </Link>
      </div>

      {/* Quick actions */}
      <Card className="mt-4">
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-5">
            <QuickAction href="/goals" label="New Goal" icon={<IconTarget />} />
            <QuickAction href="/projects" label="New Project" icon={<IconFolderPlus />} />
            <QuickAction href="/tasks" label="New Task" icon={<IconCheckSquare />} />
            <QuickAction href="/memory" label="New Note" icon={<IconNote />} />
            <QuickAction href="/chat" label="New Chat" icon={<IconChatBubble />} />
          </div>
        </CardContent>
      </Card>

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

function StatCard({ label, value, sub, progress }: { label: string; value: string; sub: string; progress?: number | null }) {
  return (
    <div className="glass-panel px-4 py-3.5">
      <p className="vox-eyebrow">{label}</p>
      <p className="vox-headline mt-1.5 text-2xl">{value}</p>
      {progress != null ? (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-surface-hover">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent to-accent-2"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />
        </div>
      ) : null}
      <p className="mt-1 text-xs text-muted">{sub}</p>
    </div>
  );
}

function QuickAction({ href, label, icon }: { href: string; label: string; icon: ReactNode }) {
  return (
    <Link
      href={href}
      className="vox-lift vox-press flex items-center gap-2.5 rounded-[var(--radius-md)] border border-border bg-surface-hover/40 px-4 py-3.5 text-sm font-medium text-foreground hover:bg-surface-hover"
    >
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center text-accent">{icon}</span>
      {label}
    </Link>
  );
}

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function formatRelativeTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}


function humanizeEventType(type: string): string {
  return type.replace(/[._]/g, " ");
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

function iconProps() {
  return { width: 18, height: 18, viewBox: "0 0 20 20", fill: "none", strokeWidth: 1.5, strokeLinecap: "round" as const, "aria-hidden": true };
}
function IconTarget() {
  return (
    <svg {...iconProps()}>
      <circle cx="10" cy="10" r="7" stroke="currentColor" />
      <circle cx="10" cy="10" r="3.5" stroke="currentColor" opacity="0.75" />
      <circle cx="10" cy="10" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
function IconFolderPlus() {
  return (
    <svg {...iconProps()}>
      <path d="M3 6a1 1 0 0 1 1-1h4l1.5 2H16a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6Z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M10 9v4M8 11h4" stroke="currentColor" />
    </svg>
  );
}
function IconCheckSquare() {
  return (
    <svg {...iconProps()}>
      <rect x="3" y="3" width="14" height="14" rx="3" stroke="currentColor" />
      <path d="M6.5 10.3 9 12.8l4.5-5.6" stroke="currentColor" />
    </svg>
  );
}
function IconNote() {
  return (
    <svg {...iconProps()}>
      <path d="M5 3.5h10a1 1 0 0 1 1 1V16l-3-2-3 2-3-2-3 2V4.5a1 1 0 0 1 1-1Z" stroke="currentColor" strokeLinejoin="round" />
      <path d="M7 7.5h6M7 10.5h6" stroke="currentColor" opacity="0.7" />
    </svg>
  );
}
function IconChatBubble() {
  return (
    <svg {...iconProps()}>
      <path d="M3 4.5h14a1 1 0 0 1 1 1V13a1 1 0 0 1-1 1H8l-4 3v-3H3a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1Z" stroke="currentColor" />
    </svg>
  );
}
