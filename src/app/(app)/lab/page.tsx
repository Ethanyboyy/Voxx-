import Link from "next/link";
import { getCurrentUser } from "@/lib/auth/session";
import { getLabDashboard, getRecentFailures } from "@/lib/lab/dashboard";
import { HolographicPanel, LabSectionLabel, LabStatusBadge, UnitStat } from "@/components/lab/primitives";
import { HolographicModel } from "@/components/lab/HolographicModel";
import type {
  ArmorLevel,
  MaskLensStyle,
  MaterialLanguage,
  PatternStyle,
  Silhouette,
} from "@/components/lab/three/suitDesign";

const QUICK_LINKS = [
  { href: "/lab/suits", label: "Suit Bay", desc: "Design, inspect and simulate suits" },
  { href: "/lab/engineering", label: "Engineering Bay", desc: "Gadgets and equipment" },
  { href: "/lab/web", label: "Web Lab", desc: "Theoretical web-system research" },
  { href: "/lab/simulation", label: "Simulation Center", desc: "Run physics scenarios" },
  { href: "/lab/training", label: "Training Center", desc: "Movement, agility, awareness" },
  { href: "/lab/experiments", label: "Experiments", desc: "Hypothesis-driven iteration" },
  { href: "/lab/research", label: "Research", desc: "Sourced findings and reference material" },
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
  "lab.simulation.failed": "Simulation failed",
  "lab.research.recorded": "Research item recorded",
  "lab.experiment.created": "Experiment started",
  "lab.experiment.completed": "Experiment completed",
  "lab.experiment.failed": "Experiment failed",
  "lab.training.session_completed": "Training session completed",
};

const PARTICLE_POSITIONS = [
  { left: "8%", top: "18%", delay: "0s" },
  { left: "22%", top: "62%", delay: "0.8s" },
  { left: "38%", top: "28%", delay: "1.6s" },
  { left: "55%", top: "74%", delay: "0.4s" },
  { left: "68%", top: "20%", delay: "2.2s" },
  { left: "82%", top: "58%", delay: "1.1s" },
  { left: "91%", top: "34%", delay: "2.8s" },
  { left: "14%", top: "84%", delay: "1.9s" },
];

export default async function LabHomePage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const [dashboard, recentFailures] = await Promise.all([
    getLabDashboard(user.id),
    getRecentFailures(user.id),
  ]);
  const c = dashboard.counts;
  const featured = dashboard.featuredSuit;
  const featuredStats = featured?.currentVersion?.stats;

  return (
    <div className="vox-panel-in flex flex-col gap-4">
      {/* ---- Central holographic core: hero panel, generously sized ---- */}
      <HolographicPanel variant="glow" corners scanline className="relative overflow-hidden p-6 lg:p-8">
        <div className="lab-particle-field" aria-hidden="true">
          {PARTICLE_POSITIONS.map((p, i) => (
            <span key={i} style={{ left: p.left, top: p.top, animationDelay: p.delay }} />
          ))}
        </div>
        <div className="relative grid gap-8 lg:grid-cols-[300px_1fr] lg:items-center">
          <div className="flex flex-col items-center">
            {featured ? (
              <>
                <HolographicModel
                  colorPrimary={featured.colorPrimary}
                  colorSecondary={featured.colorSecondary}
                  silhouette={featured.silhouette as Silhouette}
                  materialLanguage={featured.materialLanguage as MaterialLanguage}
                  patternStyle={featured.patternStyle as PatternStyle}
                  armorLevel={featured.armorLevel as ArmorLevel}
                  maskLensStyle={featured.maskLensStyle as MaskLensStyle}
                  modelUrl={featured.modelUrl}
                  size={280}
                  controls={false}
                />
                <Link
                  href={`/lab/suits/${featured.id}`}
                  className="lab-mono mt-2 text-xs font-semibold uppercase tracking-wider text-accent hover:underline"
                >
                  {featured.codename} &rarr;
                </Link>
              </>
            ) : (
              <div className="flex h-[280px] w-[280px] items-center justify-center rounded-full border border-dashed border-border">
                <p className="max-w-[180px] text-center text-xs text-muted-foreground">
                  No suit designed yet — visit the Suit Bay to begin.
                </p>
              </div>
            )}
          </div>

          <div>
            <LabSectionLabel>R&amp;D Command Center</LabSectionLabel>
            <h1 className="lab-glow-text mt-1 text-3xl font-bold tracking-tight text-foreground">
              Welcome back to the Laboratory
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted">
              {featured ? (
                <>
                  Most recently active design:{" "}
                  <span className="text-foreground">{featured.codename}</span> ({featured.archetype}).{" "}
                </>
              ) : null}
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
              <Stat label="Research items" value={c.researchItems} />
            </div>
            {featuredStats ? (
              <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-1 border-t border-border pt-4 sm:grid-cols-3">
                <UnitStat label="Mobility" value={featuredStats.mobility} unit="/100" />
                <UnitStat label="Weight" value={featuredStats.weightKg} unit="kg" />
                <UnitStat label="Thermal load" value={featuredStats.thermalLoadC} unit="°C" />
              </div>
            ) : null}
          </div>
        </div>
      </HolographicPanel>

      {/* ---- Asymmetric mid section: quick links (wide) + activity (tall) ---- */}
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 content-start">
          {QUICK_LINKS.map((l, i) => (
            <Link key={l.href} href={l.href} className={i === 0 ? "col-span-2 sm:col-span-1" : undefined}>
              <HolographicPanel className="h-full p-4 transition-colors hover:border-[var(--border-strong)] hover:bg-surface-hover">
                <p className="text-sm font-semibold text-foreground">{l.label}</p>
                <p className="mt-1 text-xs text-muted">{l.desc}</p>
              </HolographicPanel>
            </Link>
          ))}
        </div>

        <HolographicPanel variant="strong" className="flex flex-col p-4 lg:row-span-1">
          <LabSectionLabel>Laboratory Activity</LabSectionLabel>
          <div className="mt-3 flex-1 space-y-0">
            {dashboard.recentEvents.length === 0 ? (
              <p className="text-sm text-muted">No activity recorded yet.</p>
            ) : (
              <ul className="relative ml-1.5 border-l border-border">
                {dashboard.recentEvents.map((e) => (
                  <li key={e.id} className="relative pb-4 pl-4 last:pb-0">
                    <span className="lab-pulse-ring absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                    <span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-accent" aria-hidden="true" />
                    <p className="text-xs text-foreground">{EVENT_LABEL[e.type] ?? e.type}</p>
                    <p className="lab-mono mt-0.5 text-[10px] text-muted-foreground">
                      {new Date(e.createdAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </HolographicPanel>
      </div>

      {/* ---- Warnings: only rendered when real FAILED runs exist ---- */}
      {recentFailures.length > 0 ? (
        <HolographicPanel className="border-danger/40 bg-danger-muted p-4">
          <div className="flex items-center gap-2">
            <LabSectionLabel className="text-danger/80">Warnings</LabSectionLabel>
            <LabStatusBadge status="FAILED" />
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {recentFailures.map((run) => (
              <Link
                key={run.id}
                href={`/lab/simulation/${run.simulationId}`}
                className="flex items-center justify-between rounded-lg border border-danger/30 bg-[var(--surface-solid)] px-3 py-2 text-xs hover:bg-surface-hover"
              >
                <span className="text-foreground">{run.simulation.name}</span>
                <span className="lab-mono text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</span>
              </Link>
            ))}
          </div>
        </HolographicPanel>
      ) : null}

      {/* ---- Bottom row: recent designs + discovery feed ribbon ---- */}
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
          <LabSectionLabel>Discovery Feed</LabSectionLabel>
          <div className="mt-3">
            {dashboard.recentExperiments.length === 0 ? (
              <p className="text-sm text-muted">No experiments logged yet.</p>
            ) : (
              <ol className="relative ml-1.5 border-l border-border">
                {dashboard.recentExperiments.map((exp) => (
                  <li key={exp.id} className="relative pb-4 pl-4 last:pb-0">
                    <span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-accent-blue" aria-hidden="true" />
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm text-foreground">{exp.title}</span>
                      <LabStatusBadge status={exp.status} />
                    </div>
                    <p className="lab-mono mt-0.5 text-[10px] text-muted-foreground">
                      {new Date(exp.updatedAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ol>
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
