import { db } from "@/lib/db";

export interface LabSearchResult {
  category: string;
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

/** Global laboratory search across every major entity, categorized. Case-
 * insensitive substring match — SQLite has no full-text index configured
 * here, and the record counts (hundreds, not millions) make LIKE fine. */
export async function searchLab(userId: string, query: string): Promise<LabSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const contains = { contains: q };

  const [suits, gadgets, components, materials, experiments, simulations, projects, tutorials, requirements, questions, decisions] =
    await Promise.all([
      db.labSuit.findMany({ where: { userId, OR: [{ codename: contains }, { archetype: contains }] }, take: 8 }),
      db.labGadget.findMany({ where: { userId, OR: [{ name: contains }, { category: contains }] }, take: 8 }),
      db.labComponent.findMany({
        where: { OR: [{ suit: { userId } }, { gadget: { userId } }], name: contains },
        take: 8,
        include: { suit: true, gadget: true },
      }),
      db.labMaterial.findMany({ where: { OR: [{ userId: null }, { userId }], name: contains }, take: 8 }),
      db.labExperiment.findMany({ where: { userId, OR: [{ title: contains }, { code: contains }] }, take: 8 }),
      db.labSimulation.findMany({ where: { userId, name: contains }, take: 8 }),
      db.labProject.findMany({ where: { userId, name: contains }, take: 8 }),
      db.labTutorial.findMany({ where: { title: contains }, take: 8 }),
      db.labRequirement.findMany({ where: { userId, OR: [{ title: contains }, { code: contains }] }, take: 8 }),
      db.labEngineeringQuestion.findMany({ where: { userId, question: contains }, take: 8 }),
      db.labDecision.findMany({ where: { userId, decision: contains }, take: 8 }),
    ]);

  return [
    ...suits.map((s) => ({ category: "Suits", id: s.id, title: s.codename, subtitle: s.archetype, href: `/lab/suits/${s.id}` })),
    ...gadgets.map((g) => ({ category: "Gadgets", id: g.id, title: g.name, subtitle: g.category, href: `/lab/engineering/${g.id}` })),
    ...components.map((c) => ({
      category: "Components",
      id: c.id,
      title: c.name,
      subtitle: c.suit ? `Component of ${c.suit.codename}` : `Component of ${c.gadget?.name ?? "gadget"}`,
      href: c.suitId ? `/lab/suits/${c.suitId}` : `/lab/engineering/${c.gadgetId}`,
    })),
    ...materials.map((m) => ({ category: "Materials", id: m.id, title: m.name, subtitle: m.category, href: `/lab/materials` })),
    ...experiments.map((e) => ({ category: "Experiments", id: e.id, title: `${e.code} — ${e.title}`, subtitle: e.status, href: `/lab/experiments/${e.id}` })),
    ...simulations.map((s) => ({ category: "Simulations", id: s.id, title: s.name, subtitle: "Simulation", href: `/lab/simulation/${s.id}` })),
    ...projects.map((p) => ({ category: "Projects", id: p.id, title: p.name, subtitle: p.status, href: `/lab/projects/${p.id}` })),
    ...tutorials.map((t) => ({ category: "Tutorials", id: t.id, title: t.title, subtitle: t.category, href: `/lab/training/tutorials/${t.id}` })),
    ...requirements.map((r) => ({ category: "Requirements", id: r.id, title: `${r.code} — ${r.title}`, subtitle: r.status, href: r.suitId ? `/lab/suits/${r.suitId}` : "/lab/suits" })),
    ...questions.map((q) => ({ category: "Engineering Questions", id: q.id, title: q.question, subtitle: q.resolved ? "Resolved" : "Open", href: q.suitId ? `/lab/suits/${q.suitId}` : "/lab/suits" })),
    ...decisions.map((d) => ({ category: "Decisions", id: d.id, title: d.decision, subtitle: d.selectedOption ?? "Decision recorded", href: d.suitId ? `/lab/suits/${d.suitId}` : "/lab/suits" })),
  ];
}
