import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getLabDashboard } from "@/lib/lab/dashboard";
import { HolographicPanel, LabSectionLabel, LabStatusBadge } from "@/components/lab/primitives";

const QUICK_LINKS = [
  { href: "/lab/suits", label: "Suit Bay", desc: "Design, inspect and simulate suits" },
  { href: "/lab/engineering", label: "Engineering Bay", desc: "Gadgets and equipment" },
  { href: "/lab/web", label: "Web Lab", desc: "Theoretical web-system research" },
  { href: "/lab/simulation", label: "Simulation Center", desc: "Run physics scenarios" },
  { href: "/lab/training", label: "Training Center", desc: "Movement, agility, awareness" },
  { href: "/lab/experiments", label: "Experiments", desc: "Hypothesis-driven iteration" },
];

const EVENT_LABEL: Record<string, string> = {
  "lab.suit.created": "Suit designed",
  "lab.suit.variant_created": "Variant created",
  "lab.suit.prototype_generated": "Prototype generated",
  "lab.suit.archived": "Design archived",
  "lab.gadget.created": "Gadget designed",
  "lab.gadget.variant_created": "Gadget variant created",
  "lab.web_profile.created": "Web profile created",
  "lab.web_profile.load_model_computed": "Load model computed",
  "lab.simulation.completed": "Simulation completed",
  "lab.experiment.created": "Experiment started",
  "lab.experiment.completed": "Experiment completed",
  "lab.experiment.failed": "Experiment failed",
  "lab.training.session_completed": "Training session completed",
};

export default async function LabHomePage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const dashboard = await getLabDashboard(user.id);
  const c = dashboard.counts;

  return (
    <div className="vox-panel-in flex flex-col gap-6">
      <HolographicPanel variant="glow" corners scanline className="relative overflow-hidden p-8">
        <LabSectionLabel>R&amp;D Command Center</LabSectionLabel>
        <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground">Welcome back to the Laboratory</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          {c.suits} suit designs, {c.gadgets} gadgets, {c.experiments} experiments ({c.activeExperiments} running), and{" "}
          {c.simulationRuns} simulation runs on record. Everything below reflects real, persisted lab state.
        </p>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Suits" value={c.suits} />
          <Stat label="Gadgets" value={c.gadgets} />
          <Stat label="Materials" value={c.materials} />
          <Stat label="Projects" value={c.projects} />
          <Stat label="Experiments" value={c.experiments} />
          <Stat label="Sim runs" value={c.simulationRuns} />
          <Stat label="Training sessions" value={c.trainingSessions} />
          <Stat label="Active experiments" value={c.activeExperiments} />
        </div>
      </HolographicPanel>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {QUICK_LINKS.map((l) => (
          <Link key={l.href} href={l.href}>
            <HolographicPanel className="h-full p-4 transition-colors hover:border-[var(--border-strong)] hover:bg-surface-hover">
              <p className="text-sm font-semibold text-foreground">{l.label}</p>
              <p className="mt-1 text-xs text-muted">{l.desc}</p>
            </HolographicPanel>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <HolographicPanel className="p-4">
          <LabSectionLabel>Recent Designs</LabSectionLabel>
          <div className="mt-3 space-y-2">
            {dashboard.recentSuits.length === 0 ? (
              <p className="text-sm text-muted">No suits yet — visit the Suit Bay to explore the seeded catalog.</p>
            ) : (
              dashboard.recentSuits.map((s) => (
                <Link
                  key={s.id}
                  href={`/lab/suits/${s.id}`}
                  className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-surface-hover"
                >
                  <span className="text-foreground">{s.codename}</span>
                  <LabStatusBadge status={s.status} />
                </Link>
              ))
            )}
          </div>
        </HolographicPanel>

        <HolographicPanel className="p-4">
          <LabSectionLabel>Laboratory Activity</LabSectionLabel>
          <div className="mt-3 space-y-2">
            {dashboard.recentEvents.length === 0 ? (
              <p className="text-sm text-muted">No activity recorded yet.</p>
            ) : (
              dashboard.recentEvents.map((e) => (
                <div key={e.id} className="flex items-center justify-between text-xs">
                  <span className="text-foreground">{EVENT_LABEL[e.type] ?? e.type}</span>
                  <span className="lab-mono text-muted-foreground">{new Date(e.createdAt).toLocaleString()}</span>
                </div>
              ))
            )}
          </div>
        </HolographicPanel>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass-panel px-3 py-2">
      <p className="lab-mono text-2xl font-bold text-accent">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}
