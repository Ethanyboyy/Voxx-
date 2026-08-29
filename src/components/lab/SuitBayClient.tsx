"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { HolographicPanel, LabStatusBadge, RealityStatusTag } from "@/components/lab/primitives";
import { HolographicModel } from "@/components/lab/HolographicModel";
import { Meter, Seam } from "@/components/ui/Instrument";
import { resolveSuitBuild } from "@/components/lab/three/suitConfig";
import { NewSuitForm } from "@/components/lab/NewSuitForm";
import type {
  ArmorLevel,
  MaskLensStyle,
  MaterialLanguage,
  PatternStyle,
  Silhouette,
} from "@/components/lab/three/suitDesign";

interface SuitListItem {
  id: string;
  codename: string;
  designation: string;
  archetype: string;
  status: string;
  realityStatus?: string;
  modelUrl?: string | null;
  colorPrimary: string;
  colorSecondary: string;
  silhouette?: string;
  materialLanguage?: string;
  patternStyle?: string;
  armorLevel?: string;
  maskLensStyle?: string;
  stats: { stealth: number; durability: number; mobility: number; weightKg: number; estimatedCostUsd: number } | null;
}

/** The hero canvas is square; this keeps it from dominating a phone screen
 *  while still being the largest thing on a desktop viewport. */
function useHeroSize() {
  const [size, setSize] = useState(420);
  useEffect(() => {
    const compute = () => setSize(window.innerWidth < 640 ? Math.min(320, window.innerWidth - 96) : 460);
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);
  return size;
}

/**
 * What this suit is actually built from — the resolved build, not a repeat of
 * the card's metadata. Reads the same resolveSuitBuild the 3D model uses, so
 * the panel and the render can never describe different suits.
 */
function SuitInspector({ suit }: { suit: SuitListItem }) {
  const build = useMemo(
    () =>
      resolveSuitBuild({
        archetype: suit.archetype,
        silhouette: (suit.silhouette ?? "ATHLETIC") as Silhouette,
        materialLanguage: (suit.materialLanguage ?? "TEXTILE") as MaterialLanguage,
        armorLevel: (suit.armorLevel ?? "LIGHT") as ArmorLevel,
      }),
    [suit.archetype, suit.silhouette, suit.materialLanguage, suit.armorLevel]
  );

  return (
    <HolographicPanel corners className="flex flex-col gap-4 p-5">
      <div>
        <p className="vox-eyebrow">Build concept</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">{build.concept}</p>
      </div>

      <Seam />

      <div>
        <p className="vox-eyebrow">Construction</p>
        <dl className="mt-2 flex flex-col gap-1.5">
          <Row label="Underlayer" value={build.underlayer.replace(/_/g, " ").toLowerCase()} />
          <Row label="Plating" value={build.plate.replace(/_/g, " ").toLowerCase()} />
          <Row label="Components" value={String(build.pieces.length)} />
          <Row label="Powered core" value={build.chestCore ? "fitted" : "none"} />
        </dl>
      </div>

      {suit.stats ? (
        <>
          <Seam />
          <div>
            <p className="vox-eyebrow">Telemetry</p>
            <div className="mt-2 flex flex-col gap-2">
              <Meter label="Stealth" value={suit.stats.stealth} max={100} tone="steel" />
              <Meter label="Durability" value={suit.stats.durability} max={100} tone="success" />
              <Meter label="Mobility" value={suit.stats.mobility} max={100} tone="accent" />
            </div>
            <dl className="mt-3 flex flex-col gap-1.5">
              <Row label="Mass" value={`${suit.stats.weightKg.toFixed(2)} kg`} />
              <Row label="Est. cost" value={`$${suit.stats.estimatedCostUsd.toLocaleString()}`} />
            </dl>
          </div>
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          No measured stats recorded for this version yet.
        </p>
      )}
    </HolographicPanel>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="vox-unit">{label}</dt>
      <dd className="vox-readout text-xs text-foreground">{value}</dd>
    </div>
  );
}

export function SuitBayClient({
  initialSuits,
  projects,
}: {
  initialSuits: SuitListItem[];
  projects: { id: string; name: string }[];
}) {
  const [suits, setSuits] = useState(initialSuits);
  const [query, setQuery] = useState("");
  const [archetype, setArchetype] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  // The suit currently on the stage. Distinct from `selected`, which is the
  // multi-pick set used for comparison — browsing and comparing are
  // different intents and sharing one state made both confusing.
  const [heroId, setHeroId] = useState<string | null>(initialSuits[0]?.id ?? null);
  const router = useRouter();
  const heroSize = useHeroSize();

  const archetypes = useMemo(() => Array.from(new Set(suits.map((s) => s.archetype))).sort(), [suits]);

  const filtered = suits.filter((s) => {
    if (archetype !== "all" && s.archetype !== archetype) return false;
    if (query && !s.codename.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const hero = useMemo(
    () => filtered.find((s) => s.id === heroId) ?? filtered[0] ?? null,
    [filtered, heroId]
  );

  function toggleSelect(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length < 4 ? [...prev, id] : prev));
  }

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search suits…"
          className="max-w-xs"
        />
        <Select value={archetype} onChange={(e) => setArchetype(e.target.value)} className="max-w-[180px]">
          <option value="all">All archetypes</option>
          {archetypes.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </Select>
        <div className="flex-1" />
        {selected.length >= 2 ? (
          <Button size="sm" variant="secondary" onClick={() => router.push(`/lab/suits/compare?ids=${selected.join(",")}`)}>
            Compare ({selected.length})
          </Button>
        ) : null}
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New Suit"}
        </Button>
      </div>

      {showForm ? (
        <NewSuitForm
          projects={projects}
          onCreated={(suit) => {
            setSuits((prev) => [
              {
                id: suit.id,
                codename: suit.codename,
                designation: suit.designation,
                archetype: suit.archetype,
                status: suit.status,
                realityStatus: suit.realityStatus,
                colorPrimary: suit.colorPrimary,
                colorSecondary: suit.colorSecondary,
                silhouette: suit.silhouette,
                materialLanguage: suit.materialLanguage,
                patternStyle: suit.patternStyle,
                armorLevel: suit.armorLevel,
                maskLensStyle: suit.maskLensStyle,
                stats: null,
              },
              ...prev,
            ]);
            setShowForm(false);
            router.push(`/lab/suits/${suit.id}`);
          }}
        />
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState title="No suits found" description="Adjust your filters, or create a new design." />
      ) : (
        <p className="text-xs text-muted-foreground">
          {filtered.length} suit{filtered.length === 1 ? "" : "s"} · select up to 4 to compare
        </p>
      )}

      {/* ---- Hero stage: the suit is the subject of this screen ----
           Sixty 140px tiles gave every design the same negligible presence
           and none of them room to be looked at. One suit at full height,
           with its build and telemetry beside it, is what makes this read as
           an engineering bay rather than a catalogue page. */}
      {hero ? (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <HolographicPanel corners scanline className="relative overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-5 pt-4">
              <div className="min-w-0">
                <p className="vox-eyebrow">On the stand</p>
                <h2 className="vox-headline mt-0.5 truncate text-xl sm:text-2xl">{hero.codename}</h2>
                <p className="vox-readout mt-0.5 text-[11px] text-muted-foreground">
                  {hero.designation} · {hero.archetype}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <LabStatusBadge status={hero.status} />
                <RealityStatusTag status={hero.realityStatus ?? "CONCEPT"} />
              </div>
            </div>

            <div className="flex items-center justify-center px-2 pb-2 pt-1">
              <HolographicModel
                key={hero.id}
                colorPrimary={hero.colorPrimary}
                colorSecondary={hero.colorSecondary}
                silhouette={hero.silhouette as Silhouette}
                materialLanguage={hero.materialLanguage as MaterialLanguage}
                patternStyle={hero.patternStyle as PatternStyle}
                armorLevel={hero.armorLevel as ArmorLevel}
                maskLensStyle={hero.maskLensStyle as MaskLensStyle}
                modelUrl={hero.modelUrl}
                archetype={hero.archetype}
                size={heroSize}
              />
            </div>

            <div className="flex flex-wrap gap-2 px-5 pb-5">
              <Button size="sm" onClick={() => router.push(`/lab/suits/${hero.id}`)}>
                Open engineering view
              </Button>
              <Button size="sm" variant="secondary" onClick={() => toggleSelect(hero.id)}>
                {selected.includes(hero.id) ? "Remove from compare" : "Add to compare"}
              </Button>
            </div>
          </HolographicPanel>

          {/* Inspector — the build VOX resolved for this suit, from its own
              recorded parameters. Not a restatement of the card. */}
          <SuitInspector suit={hero} />
        </div>
      ) : null}

      {/* ---- Secondary: the archive strip ----
           Deliberately small and dense. This is a way to reach a suit, not
           the place a suit is looked at. */}
      <div>
        <p className="vox-eyebrow mb-2">Archive · {filtered.length} designs</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
          {filtered.map((s) => {
            const isHero = hero?.id === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setHeroId(s.id)}
                aria-pressed={isHero}
                className={`instrument instrument-sheen vox-press relative overflow-hidden px-3 py-2.5 text-left transition-colors ${
                  isHero ? "border-accent ring-1 ring-[var(--accent)]" : "hover:border-[var(--border-strong)]"
                }`}
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-0 h-0.5"
                  style={{ background: s.colorPrimary, opacity: isHero ? 1 : 0.45 }}
                />
                <p className="truncate text-xs font-semibold text-foreground">{s.codename}</p>
                <p className="vox-readout truncate text-[10px] text-muted-foreground">
                  {s.designation} · {s.archetype}
                </p>
                {s.stats ? (
                  <p className="vox-readout mt-1 text-[10px] text-muted">
                    STL {s.stats.stealth} · DUR {s.stats.durability} · MOB {s.stats.mobility}
                  </p>
                ) : null}
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleSelect(s.id);
                  }}
                  role="checkbox"
                  tabIndex={0}
                  aria-checked={selected.includes(s.id)}
                  aria-label={`Select ${s.codename} for comparison`}
                  onKeyDown={(e) => {
                    if (e.key === " " || e.key === "Enter") {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleSelect(s.id);
                    }
                  }}
                  className={`absolute right-1.5 top-1.5 h-3.5 w-3.5 cursor-pointer rounded border ${
                    selected.includes(s.id) ? "border-accent bg-accent" : "border-border bg-surface"
                  }`}
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
