"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  HolographicPanel,
  LabSectionLabel,
  LabStatusBadge,
  SafetyNotice,
  UnitStat,
} from "@/components/lab/primitives";

interface TelemetrySample {
  t: number;
  positionM: number;
  velocityMs: number;
  accelerationMs2: number;
  forceN: number;
  thermalLoadC: number;
  fatiguePercent: number;
}

interface RunItem {
  id: string;
  status: string;
  seed: number;
  durationS: number;
  telemetry: string;
  peakVelocityMs: number | null;
  peakForceN: number | null;
  peakThermalLoadC: number | null;
  fatigueEstimatePct: number | null;
  warnings: string | null;
  summary: string | null;
  startedAt: string;
  completedAt: string | null;
}

interface SimulationDetail {
  id: string;
  name: string;
  userMassKg: number;
  reactionTimeMs: number;
  skillLevel: number;
  scenario: {
    name: string;
    environment: string;
    objectiveType: string;
    difficulty: string;
    description: string | null;
    windMs: number;
    temperatureC: number;
    gravityMs2: number;
    obstacleCount: number;
  };
  suit: {
    id: string;
    codename: string;
    stats: { mobility: number; weightKg: number; thermalLoadC: number } | null;
  } | null;
  gadgets: { id: string; name: string }[];
  runs: RunItem[];
}

function parseTelemetry(raw: string): TelemetrySample[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseWarnings(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const CHART_WIDTH = 480;
const CHART_HEIGHT = 120;
const CHART_PAD = 8;

function buildPolyline(samples: TelemetrySample[], key: keyof TelemetrySample): string {
  if (samples.length === 0) return "";
  const tMax = Math.max(...samples.map((s) => s.t), 0.001);
  const values = samples.map((s) => Number(s[key]));
  const yMin = Math.min(0, ...values);
  const yMax = Math.max(...values, yMin + 0.001);
  const usableW = CHART_WIDTH - CHART_PAD * 2;
  const usableH = CHART_HEIGHT - CHART_PAD * 2;
  return samples
    .map((s) => {
      const x = CHART_PAD + (s.t / tMax) * usableW;
      const norm = (Number(s[key]) - yMin) / (yMax - yMin);
      const y = CHART_PAD + (1 - norm) * usableH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

function TelemetryChart({
  samples,
  metricKey,
  label,
  unit,
  color,
}: {
  samples: TelemetrySample[];
  metricKey: keyof TelemetrySample;
  label: string;
  unit: string;
  color: string;
}) {
  const points = useMemo(() => buildPolyline(samples, metricKey), [samples, metricKey]);
  const peak = samples.length > 0 ? Math.max(...samples.map((s) => Number(s[metricKey]))) : 0;

  return (
    <div>
      <div className="flex items-center justify-between">
        <LabSectionLabel>{label}</LabSectionLabel>
        <span className="lab-mono text-[10px] text-muted-foreground">
          peak {peak.toFixed(1)} {unit}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="mt-2 w-full overflow-visible rounded-lg border border-border bg-[var(--surface-solid)]"
        preserveAspectRatio="none"
      >
        <line x1={CHART_PAD} y1={CHART_HEIGHT - CHART_PAD} x2={CHART_WIDTH - CHART_PAD} y2={CHART_HEIGHT - CHART_PAD} stroke="var(--border)" strokeWidth={1} />
        {points ? <polyline points={points} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" /> : null}
      </svg>
    </div>
  );
}

export function SimulationDetailClient({ simulation }: { simulation: SimulationDetail }) {
  const router = useRouter();
  const [runs, setRuns] = useState(simulation.runs);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(simulation.runs[0]?.id ?? null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null;
  const telemetry = useMemo(() => (selectedRun ? parseTelemetry(selectedRun.telemetry) : []), [selectedRun]);
  const warnings = useMemo(() => (selectedRun ? parseWarnings(selectedRun.warnings) : []), [selectedRun]);

  async function runSimulation() {
    setRunning(true);
    setError(null);
    const res = await fetch(`/api/lab/simulations/${simulation.id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setRunning(false);
    if (res.ok) {
      const data = await res.json();
      const run: RunItem = {
        id: data.run.id,
        status: data.run.status,
        seed: data.run.seed,
        durationS: data.run.durationS,
        telemetry: data.run.telemetry,
        peakVelocityMs: data.run.peakVelocityMs,
        peakForceN: data.run.peakForceN,
        peakThermalLoadC: data.run.peakThermalLoadC,
        fatigueEstimatePct: data.run.fatigueEstimatePct,
        warnings: data.run.warnings,
        summary: data.run.summary,
        startedAt: data.run.startedAt,
        completedAt: data.run.completedAt,
      };
      setRuns((prev) => [run, ...prev]);
      setSelectedRunId(run.id);
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to run simulation.");
    }
  }

  return (
    <div className="vox-panel-in flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{simulation.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {simulation.scenario.name} · {simulation.scenario.environment.toLowerCase().replace(/_/g, " ")} ·{" "}
            {simulation.scenario.difficulty.toLowerCase()}
            {simulation.suit ? ` · ${simulation.suit.codename}` : ""}
          </p>
          {simulation.scenario.description ? (
            <p className="mt-2 max-w-2xl text-sm text-muted">{simulation.scenario.description}</p>
          ) : null}
        </div>
        <Button onClick={runSimulation} disabled={running}>
          {running ? "Running…" : "Run Simulation"}
        </Button>
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}

      <HolographicPanel className="p-4">
        <LabSectionLabel>Simulation World</LabSectionLabel>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
          <UnitStat label="Objective" value={simulation.scenario.objectiveType.toLowerCase().replace(/_/g, " ")} />
          <UnitStat label="Wind" value={simulation.scenario.windMs} unit="m/s" />
          <UnitStat label="Temperature" value={simulation.scenario.temperatureC} unit="°C" />
          <UnitStat label="Gravity" value={simulation.scenario.gravityMs2} unit="m/s²" />
          <UnitStat label="Obstacles" value={simulation.scenario.obstacleCount} />
          <UnitStat label="User mass" value={simulation.userMassKg} unit="kg" />
          <UnitStat label="Reaction time" value={simulation.reactionTimeMs} unit="ms" />
          <UnitStat label="Skill level" value={simulation.skillLevel} />
        </div>
        {simulation.gadgets.length > 0 ? (
          <p className="mt-3 text-xs text-muted">
            Gadgets: {simulation.gadgets.map((g) => g.name).join(", ")}
          </p>
        ) : null}
      </HolographicPanel>

      {!selectedRun ? (
        <HolographicPanel className="p-6 text-center">
          <p className="text-sm text-foreground">No runs yet.</p>
          <p className="mt-1 text-sm text-muted">
            Press &ldquo;Run Simulation&rdquo; to execute the physics model and save the first run — running is saving.
          </p>
        </HolographicPanel>
      ) : (
        <>
          <HolographicPanel className="p-4">
            <div className="flex items-center justify-between">
              <LabSectionLabel>Telemetry</LabSectionLabel>
              <div className="flex items-center gap-2">
                <LabStatusBadge status={selectedRun.status} />
                <span className="lab-mono text-[10px] text-muted-foreground">seed {selectedRun.seed}</span>
              </div>
            </div>
            {selectedRun.summary ? <p className="mt-2 text-sm text-muted">{selectedRun.summary}</p> : null}
            <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
              <UnitStat label="Peak velocity" value={selectedRun.peakVelocityMs ?? 0} unit="m/s" />
              <UnitStat label="Peak force" value={selectedRun.peakForceN ?? 0} unit="N" />
              <UnitStat label="Peak thermal load" value={selectedRun.peakThermalLoadC ?? 0} unit="°C" />
              <UnitStat label="Fatigue estimate" value={selectedRun.fatigueEstimatePct ?? 0} unit="%" />
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <TelemetryChart samples={telemetry} metricKey="velocityMs" label="Velocity" unit="m/s" color="var(--accent)" />
              <TelemetryChart samples={telemetry} metricKey="thermalLoadC" label="Thermal Load" unit="°C" color="var(--accent-blue)" />
            </div>
            {warnings.length > 0 ? (
              <div className="mt-4 flex flex-col gap-2">
                {warnings.map((w, i) => (
                  <SafetyNotice key={i}>{w}</SafetyNotice>
                ))}
              </div>
            ) : null}
          </HolographicPanel>

          <HolographicPanel className="p-4">
            <LabSectionLabel>Run History</LabSectionLabel>
            <div className="mt-3 flex flex-col gap-1.5">
              {runs.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRunId(r.id)}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    r.id === selectedRunId
                      ? "border-[var(--border-strong)] bg-accent-muted"
                      : "border-border hover:bg-surface-hover"
                  }`}
                >
                  <span className="text-foreground">{r.summary ?? `Run ${r.id.slice(0, 8)}`}</span>
                  <span className="lab-mono text-muted-foreground">
                    {new Date(r.startedAt).toLocaleString()}
                  </span>
                </button>
              ))}
            </div>
          </HolographicPanel>
        </>
      )}
    </div>
  );
}
