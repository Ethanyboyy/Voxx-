import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { listProjects, listTasks } from "@/lib/projects/service";
import { listObservations } from "@/lib/cognition/service";
import { getCognitiveProfile } from "@/lib/cognition/profile";
import { listMemories } from "@/lib/memory/service";
import { listIdeas } from "@/lib/projects/service";
import { listResearchItems } from "@/lib/research/service";
import { getAIProvider } from "@/lib/ai";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge, ConfidenceBadge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function DashboardPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [activeProjects, openTasks, observations, profile, memories, ideas, research] = await Promise.all([
    listProjects(user.id, "ACTIVE"),
    listTasks(user.id),
    listObservations(user.id, undefined, 5),
    getCognitiveProfile(user.id),
    listMemories(user.id),
    listIdeas(user.id),
    listResearchItems(user.id, 5),
  ]);

  const currentProject = activeProjects[0] ?? null;
  const openTasksSorted = openTasks
    .filter((t) => t.status === "TODO" || t.status === "IN_PROGRESS")
    .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority));
  const topTask = openTasksSorted[0] ?? null;
  const recentMemories = memories.slice(0, 5);
  const recentIdeas = ideas.slice(0, 5);
  const activeDimensions = profile.filter((d) => d.hasData);
  const provider = getAIProvider();

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Dashboard</h1>
      <p className="mt-1 text-sm text-muted">A snapshot of what VOX currently knows and is tracking.</p>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Active project</CardTitle>
          </CardHeader>
          <CardContent>
            {currentProject ? (
              <div>
                <p className="font-medium text-foreground">{currentProject.name}</p>
                {currentProject.description ? (
                  <p className="mt-1 text-sm text-muted">{currentProject.description}</p>
                ) : null}
              </div>
            ) : (
              <EmptyState
                title="No active project yet"
                description="Create a project to give VOX something to organize goals and tasks around."
                action={
                  <Link href="/projects" className="text-sm font-medium text-accent">
                    Go to Projects →
                  </Link>
                }
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Highest-priority task</CardTitle>
          </CardHeader>
          <CardContent>
            {topTask ? (
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-foreground">{topTask.title}</p>
                  <p className="text-sm text-muted">{topTask.status.replace("_", " ").toLowerCase()}</p>
                </div>
                <Badge tone={topTask.priority === "HIGH" ? "danger" : topTask.priority === "MEDIUM" ? "warning" : "neutral"}>
                  {topTask.priority.toLowerCase()}
                </Badge>
              </div>
            ) : (
              <EmptyState title="No open tasks" description="Nothing is currently queued up." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent observations</CardTitle>
          </CardHeader>
          <CardContent>
            {observations.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {observations.map((o) => (
                  <li key={o.id} className="text-sm text-foreground">
                    <span className="text-muted">[{o.dimension.toLowerCase().replace(/_/g, " ")}]</span> {o.content}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No observations yet" description="VOX records behavioral observations as it learns from your activity." />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Cognitive signals</CardTitle>
          </CardHeader>
          <CardContent>
            {activeDimensions.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {activeDimensions.slice(0, 5).map((d) => (
                  <li key={d.dimension} className="flex items-center justify-between text-sm">
                    <span className="text-foreground">{d.dimension.toLowerCase().replace(/_/g, " ")}</span>
                    <span className="text-muted">{d.trend}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="No cognitive data yet"
                description="Dimensions populate from observations. See the Cognition tab for the full profile."
              />
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
            <CardTitle>System status</CardTitle>
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

function priorityRank(priority: string): number {
  return { HIGH: 2, MEDIUM: 1, LOW: 0 }[priority] ?? 0;
}
