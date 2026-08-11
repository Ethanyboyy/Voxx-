import { getCurrentUser } from "@/lib/auth/session";
import { listTasks, listGoals, listProjects } from "@/lib/projects/service";
import { listMemories } from "@/lib/memory/service";
import { listPatterns } from "@/lib/cognition/patterns";
import { listAgentRuns } from "@/lib/agents/service";
import { listResearchItems } from "@/lib/research/service";
import { GlassPanel } from "@/components/ui/GlassPanel";

export default async function AnalyticsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const [tasks, goals, projects, memories, patterns, agentRuns, research] = await Promise.all([
    listTasks(user.id),
    listGoals(user.id),
    listProjects(user.id),
    listMemories(user.id),
    listPatterns(user.id),
    listAgentRuns(user.id, 200),
    listResearchItems(user.id, 200),
  ]);

  const doneTasks = tasks.filter((t) => t.status === "DONE");
  const cancelledTasks = tasks.filter((t) => t.status === "CANCELLED");
  const completionRate = tasks.length > 0 ? Math.round((doneTasks.length / (tasks.length - cancelledTasks.length || 1)) * 100) : null;

  const achievedGoals = goals.filter((g) => g.status === "ACHIEVED");
  const goalRate = goals.length > 0 ? Math.round((achievedGoals.length / goals.length) * 100) : null;

  const byConfidence = countBy(memories, (m) => m.confidence);
  const activePatterns = patterns.filter((p) => p.status === "ACTIVE");

  const completedRuns = agentRuns.filter((r) => r.status === "COMPLETED");
  const failedRuns = agentRuns.filter((r) => r.status === "FAILED");
  const runSuccessRate =
    completedRuns.length + failedRuns.length > 0
      ? Math.round((completedRuns.length / (completedRuns.length + failedRuns.length)) * 100)
      : null;

  const tasksWithEstimate = tasks.filter((t) => t.status === "DONE" && t.estimatedMinutes && t.completedAt);
  const estimateAccuracy =
    tasksWithEstimate.length > 0
      ? Math.round(
          tasksWithEstimate.reduce((sum, t) => {
            const openMinutes = Math.max(1, (t.completedAt!.getTime() - t.createdAt.getTime()) / 60000);
            return sum + Math.min(2, t.estimatedMinutes! / openMinutes);
          }, 0) /
            tasksWithEstimate.length *
            100
        )
      : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Analytics</h1>
      <p className="mt-1 text-sm text-muted">
        Every number here is computed directly from your real data — nothing is a fabricated score. A metric shows
        &quot;not enough data&quot; rather than guessing when there isn&apos;t enough history behind it.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Task completion rate" value={completionRate !== null ? `${completionRate}%` : "—"} sub={`${doneTasks.length} of ${tasks.length} tasks`} />
        <Metric label="Goal achievement rate" value={goalRate !== null ? `${goalRate}%` : "—"} sub={`${achievedGoals.length} of ${goals.length} goals`} />
        <Metric label="Agent run success rate" value={runSuccessRate !== null ? `${runSuccessRate}%` : "—"} sub={`${completedRuns.length} completed, ${failedRuns.length} failed`} />
        <Metric
          label="Estimate accuracy"
          value={estimateAccuracy !== null ? `${estimateAccuracy}%` : "not enough data"}
          sub={`${tasksWithEstimate.length} tasks with both an estimate and a completion`}
        />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
        <GlassPanel className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Memory by confidence</p>
          {memories.length === 0 ? (
            <p className="mt-2 text-sm text-muted">No memories yet.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-1.5">
              {Object.entries(byConfidence).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{k.toLowerCase()}</span>
                  <span className="text-foreground">{v}</span>
                </div>
              ))}
            </div>
          )}
        </GlassPanel>

        <GlassPanel className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Cognitive patterns</p>
          <p className="mt-1 text-3xl font-semibold text-foreground">{activePatterns.length}</p>
          <p className="text-xs text-muted">active of {patterns.length} detected total</p>
        </GlassPanel>

        <GlassPanel className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Projects &amp; research</p>
          <div className="mt-2 flex flex-col gap-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Active projects</span>
              <span className="text-foreground">{projects.filter((p) => p.status === "ACTIVE").length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Research runs</span>
              <span className="text-foreground">{research.length}</span>
            </div>
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="glass-panel px-4 py-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      <p className="text-xs text-muted">{sub}</p>
    </div>
  );
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}
