import type { BrainNode } from "@/lib/brain/graph";

export interface Point {
  x: number;
  y: number;
}

function polar(cx: number, cy: number, radius: number, angleDeg: number): Point {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

/** Spreads `count` items evenly across [fromDeg, toDeg], single item centered. */
function spreadAngle(index: number, count: number, fromDeg: number, toDeg: number): number {
  if (count <= 1) return (fromDeg + toDeg) / 2;
  return fromDeg + ((toDeg - fromDeg) * index) / (count - 1);
}

function groupBy<T, K extends string>(items: T[], key: (item: T) => K | null | undefined): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of items) {
    const k = key(item);
    if (!k) continue;
    (out[k] ??= []).push(item);
  }
  return out;
}

/**
 * Deterministic radial/tree layout: Objective at the hub, its Opportunities
 * arc out to the right (ranked so higher-leverage ones land first), each
 * Opportunity's promoted Project sits further out with its Tasks orbiting,
 * and linked Research sits close to its Opportunity as small satellites.
 * Node types absent from the input (e.g. a perspective that filtered out
 * Tasks) are simply skipped — the same function powers every relational
 * perspective, not a separate layout per view.
 */
export function layoutRadial(nodes: BrainNode[]): Map<string, Point> {
  const pos = new Map<string, Point>();

  const objectives = nodes.filter((n) => n.type === "OBJECTIVE");
  const opportunities = nodes.filter((n) => n.type === "OPPORTUNITY");
  const projects = nodes.filter((n) => n.type === "PROJECT");
  const tasks = nodes.filter((n) => n.type === "TASK");
  const research = nodes.filter((n) => n.type === "RESEARCH");

  const OBJ_GAP_Y = 460;
  const projectById = new Map(projects.map((p) => [p.entityId, p]));
  const opsByObjective = groupBy(opportunities, (o) => (o.meta.objectiveId as string) ?? null);
  const tasksByProject = groupBy(tasks, (t) => (t.meta.projectId as string) ?? null);
  const researchByOpportunity = groupBy(research, (r) => (r.meta.opportunityId as string) ?? null);

  objectives.forEach((objective, oi) => {
    const baseY = oi * OBJ_GAP_Y;
    pos.set(objective.id, { x: 0, y: baseY });

    const ops = [...(opsByObjective[objective.entityId] ?? [])].sort(
      (a, b) => (Number(b.meta.rankScore) || 0) - (Number(a.meta.rankScore) || 0)
    );
    const radius = 360;
    ops.forEach((op, i) => {
      const angle = spreadAngle(i, ops.length, -68, 68);
      const opPos = polar(0, baseY, radius, angle);
      pos.set(op.id, opPos);

      const opResearch = researchByOpportunity[op.entityId] ?? [];
      opResearch.forEach((r, ri) => {
        const rAngle = spreadAngle(ri, opResearch.length, angle - 45, angle + 45);
        pos.set(r.id, polar(opPos.x, opPos.y, 150, rAngle));
      });

      const projectId = op.meta.projectId as string | null;
      const project = projectId ? projectById.get(projectId) : undefined;
      if (project) {
        const projectPos = polar(opPos.x, opPos.y, 300, angle);
        pos.set(project.id, projectPos);
        const projectTasks = tasksByProject[project.entityId] ?? [];
        projectTasks.forEach((t, ti) => {
          const tAngle = spreadAngle(ti, projectTasks.length, angle - 32, angle + 32);
          pos.set(t.id, polar(projectPos.x, projectPos.y, 170, tAngle));
        });
      }
    });
  });

  // Standalone projects (no promoting opportunity) get their own column so
  // execution work started outside the objective loop still shows up.
  const standaloneProjects = projects.filter((p) => Boolean(p.meta.standalone) && !pos.has(p.id));
  standaloneProjects.forEach((p, i) => {
    const x = -560;
    const y = i * 240 - ((standaloneProjects.length - 1) * 240) / 2;
    pos.set(p.id, { x, y });
    const projectTasks = tasksByProject[p.entityId] ?? [];
    projectTasks.forEach((t, ti) => {
      const angle = spreadAngle(ti, projectTasks.length, 150, 210);
      pos.set(t.id, polar(x, y, 150, angle));
    });
  });

  // Anything not placed by the relational passes above (e.g. research with
  // no opportunity link, in a perspective that includes it) falls back to a
  // simple grid so nothing silently disappears.
  const unplaced = nodes.filter((n) => !pos.has(n.id));
  unplaced.forEach((n, i) => {
    pos.set(n.id, gridPoint(-560, 700, i, 4, 170));
  });

  return pos;
}

function gridPoint(originX: number, originY: number, index: number, columns: number, gap: number): Point {
  const row = Math.floor(index / columns);
  const col = index % columns;
  return { x: originX + col * gap, y: originY + row * gap };
}

/** Plain grid layout for non-relational clusters — Memory, Connections, Proposals. */
export function layoutGrid(nodes: BrainNode[], originX: number, originY: number, columns = 4, gap = 170): Map<string, Point> {
  const pos = new Map<string, Point>();
  nodes.forEach((n, i) => pos.set(n.id, gridPoint(originX, originY, i, columns, gap)));
  return pos;
}
