// Cross-domain search — the real implementation behind Quick Command.
// SQLite has no full-text index configured here (see src/lib/lab/search.ts,
// which this reuses for the Lab domain), and the record counts involved
// (hundreds, not millions) make `contains`/LIKE fine — same tradeoff that
// file already made and shipped. Memory search reuses the existing
// embeddings-based getSemanticMemories() rather than a substring match,
// since that's real semantic ranking that already exists.
import { db } from "@/lib/db";
import { getSemanticMemories } from "@/lib/memory/service";
import { searchLab } from "@/lib/lab/search";

export interface SearchResult {
  /** Machine-stable domain key, e.g. "memory", "objective", "lab.suit". */
  source: string;
  /** Human-readable category label for grouping in the UI. */
  type: string;
  id: string;
  title: string;
  subtitle?: string;
  timestamp?: string;
  /** 0-1. A real, deterministic function of the matched text (exact >
   * prefix > substring) — not a fabricated ML relevance score. */
  relevance: number;
  href: string;
}

function textRelevance(query: string, ...fields: (string | null | undefined)[]): number {
  const q = query.trim().toLowerCase();
  let best = 0.5;
  for (const f of fields) {
    if (!f) continue;
    const v = f.toLowerCase();
    if (v === q) return 1;
    if (v.startsWith(q)) best = Math.max(best, 0.85);
    else if (v.includes(q)) best = Math.max(best, 0.65);
  }
  return best;
}

/**
 * Searches memory, planning (objectives/opportunities/goals/tasks/projects),
 * research, finance, the Lab (via searchLab), and recent system events for
 * one user, and returns one unified, sorted result list. This is real
 * per-domain querying against actual rows — never a fabricated or cached
 * "AI search" result.
 */
export async function searchEverything(userId: string, query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const contains = { contains: q };

  const [memories, labResults, objectives, opportunities, goals, tasks, projects, research, assets, events, agents, agentRuns] =
    await Promise.all([
      getSemanticMemories(userId, q, 6).catch(() => []),
      searchLab(userId, q),
      db.objective.findMany({ where: { userId, OR: [{ title: contains }, { description: contains }] }, take: 6 }),
      db.opportunity.findMany({ where: { userId, OR: [{ title: contains }, { description: contains }] }, take: 6 }),
      db.goal.findMany({ where: { userId, OR: [{ title: contains }, { description: contains }] }, take: 6 }),
      db.task.findMany({ where: { userId, OR: [{ title: contains }, { description: contains }] }, take: 6 }),
      db.project.findMany({ where: { userId, OR: [{ name: contains }, { description: contains }] }, take: 6 }),
      db.researchItem.findMany({
        where: { userId, OR: [{ title: contains }, { summary: contains }, { query: contains }] },
        take: 6,
        orderBy: { retrievedAt: "desc" },
      }),
      db.economicAsset.findMany({ where: { userId, OR: [{ name: contains }, { description: contains }] }, take: 6 }),
      db.event.findMany({
        where: { userId, OR: [{ type: contains }, { subjectType: contains }] },
        take: 6,
        orderBy: { createdAt: "desc" },
      }),
      db.agent.findMany({ where: { userId, OR: [{ name: contains }, { description: contains }] }, take: 6 }),
      db.agentRun.findMany({ where: { userId, objective: contains }, take: 6, orderBy: { createdAt: "desc" } }),
    ]);

  const results: SearchResult[] = [];

  for (const m of memories) {
    results.push({
      source: "memory",
      type: "Memory",
      id: m.id,
      title: m.content.length > 90 ? `${m.content.slice(0, 90)}…` : m.content,
      subtitle: m.category.replace(/_/g, " ").toLowerCase(),
      timestamp: m.createdAt.toISOString(),
      relevance: Math.max(0.5, m.similarity),
      href: `/memory/${m.id}`,
    });
  }

  for (const r of labResults) {
    results.push({
      source: `lab.${r.category.toLowerCase()}`,
      type: `Lab · ${r.category}`,
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      relevance: textRelevance(q, r.title, r.subtitle),
      href: r.href,
    });
  }

  for (const o of objectives) {
    results.push({
      source: "objective",
      type: "Objective",
      id: o.id,
      title: o.title,
      subtitle: o.status.toLowerCase(),
      timestamp: o.updatedAt.toISOString(),
      relevance: textRelevance(q, o.title, o.description),
      href: `/objectives`,
    });
  }

  for (const o of opportunities) {
    results.push({
      source: "opportunity",
      type: "Opportunity",
      id: o.id,
      title: o.title,
      subtitle: o.nextAction ?? undefined,
      relevance: textRelevance(q, o.title, o.description),
      href: `/objectives`,
    });
  }

  for (const g of goals) {
    results.push({
      source: "goal",
      type: "Goal",
      id: g.id,
      title: g.title,
      subtitle: g.status.toLowerCase(),
      timestamp: g.updatedAt.toISOString(),
      relevance: textRelevance(q, g.title, g.description),
      href: `/goals`,
    });
  }

  for (const t of tasks) {
    results.push({
      source: "task",
      type: "Task",
      id: t.id,
      title: t.title,
      subtitle: t.status.toLowerCase().replace(/_/g, " "),
      timestamp: t.dueDate?.toISOString(),
      relevance: textRelevance(q, t.title, t.description),
      href: t.projectId ? `/projects/${t.projectId}` : `/tasks`,
    });
  }

  for (const p of projects) {
    results.push({
      source: "project",
      type: "Project",
      id: p.id,
      title: p.name,
      subtitle: p.status.toLowerCase(),
      timestamp: p.updatedAt.toISOString(),
      relevance: textRelevance(q, p.name, p.description),
      href: `/projects/${p.id}`,
    });
  }

  for (const r of research) {
    results.push({
      source: "research",
      type: "Research",
      id: r.id,
      title: r.title ?? r.query,
      subtitle: r.summary ? (r.summary.length > 80 ? `${r.summary.slice(0, 80)}…` : r.summary) : r.provider,
      timestamp: r.retrievedAt.toISOString(),
      relevance: textRelevance(q, r.title, r.summary, r.query),
      href: `/research`,
    });
  }

  for (const a of assets) {
    results.push({
      source: "finance",
      type: "Economic Asset",
      id: a.id,
      title: a.name,
      subtitle: a.status.toLowerCase(),
      relevance: textRelevance(q, a.name, a.description),
      href: `/finance/${a.id}`,
    });
  }

  for (const e of events) {
    results.push({
      source: "event",
      type: "System Event",
      id: e.id,
      title: e.type,
      subtitle: e.subjectType ?? undefined,
      timestamp: e.createdAt.toISOString(),
      relevance: textRelevance(q, e.type, e.subjectType) * 0.8, // events are a weaker signal — type is a code, not prose
      href: `/activity`,
    });
  }

  for (const a of agents) {
    results.push({
      source: "agent",
      type: "Agent",
      id: a.id,
      title: a.name,
      subtitle: a.status.toLowerCase(),
      timestamp: a.updatedAt.toISOString(),
      relevance: textRelevance(q, a.name, a.description),
      href: `/agents`,
    });
  }

  for (const r of agentRuns) {
    results.push({
      source: "agentRun",
      type: "Agent Run",
      id: r.id,
      title: r.objective,
      subtitle: r.status.toLowerCase().replace(/_/g, " "),
      timestamp: r.createdAt.toISOString(),
      relevance: textRelevance(q, r.objective),
      href: `/agents`,
    });
  }

  return results.sort((a, b) => b.relevance - a.relevance);
}
