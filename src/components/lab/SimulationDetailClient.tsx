"use client";

import { useEffect, useMemo, useState } from "react";
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

type FailureCategory =
  | "EXCESSIVE_LOAD"
  | "THERMAL_OVERLOAD"
  | "INSUFFICIENT_STRUCTURAL_CAPACITY"
  | "ENERGY_LIMITATION"
  | "ENVIRONMENTAL_CONDITION"
  | "COLLISION_RISK"
  | "INSTABILITY";

interface FailureAnalysisEntry {
  category: FailureCategory;
  explanation: string;
  suggestion: string;
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
  failureAnalysis: string | null;
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

function parseFailureAnalysis(raw: string | null): FailureAnalysisEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const FAILURE_CATEGORY_LABEL: Record<FailureCategory, string> = {
  EXCESSIVE_LOAD: "Excessive Load",
  THERMAL_OVERLOAD: "Thermal Overload",
  INSUFFICIENT_STRUCTURAL_CAPACITY: "Insufficient Structural Capacity",
  ENERGY_LIMITATION: "Energy Limitation",
  ENVIRONMENTAL_CONDITION: "Environmental Condition",
  COLLISION_RISK: "Collision Risk",
  INSTABILITY: "Instability",
};

const CHART_WIDTH = 480;
const CHART_HEIGHT = 120;
const CHART_PAD = 8;

interface ChartGeometry {
  points: string;
  toX: (t: number) => number;
  toY: (v: number) => number;
  tMax: number;
}

function buildChartGeometry(samples: TelemetrySample[], key: keyof TelemetrySample): ChartGeometry {
  const usableW = CHART_WIDTH - CHART_PAD * 2;
  const usableH = CHART_HEIGHT - CHART_PAD * 2;
  if (samples.length === 0) {
    return { points: "", toX: () => CHART_PAD, toY: () => CHART_HEIGHT - CHART_PAD, tMax: 0.001 };
  }
  const tMax = Math.max(...samples.map((s) => s.t), 0.001);
  const values = samples.map((s) => Number(s[key]));
  const yMin = Math.min(0, ...values);
  const yMax = Math.max(...values, yMin + 0.001);
  const toX = (t: number) => CHART_PAD + (t / tMax) * usableW;
  const toY = (v: number) => CHART_PAD + (1 - (v - yMin) / (yMax - yMin)) * usableH;
  const points = samples.map((s) => `${toX(s.t).toFixed(1)},${toY(Number(s[key])).toFixed(1)}`).join(" ");
  return { points, toX, toY, tMax };
}

interface EventMarker {
  index: number;
  metric: "forceN" | "thermalLoadC";
  label: string;
}

function TelemetryChart({
  samples,
  metricKey,
  label,
  unit,
  color,
  playheadIndex,
  markers,
  onMarkerClick,
}: {
  samples: TelemetrySample[];
  metricKey: keyof TelemetrySample;
  label: string;
  unit: string;
  color: string;
  playheadIndex: number | null;
  markers: EventMarker[];
  onMarkerClick: (marker: EventMarker) => void;
}) {
  const geometry = useMemo(() => buildChartGeometry(samples, metricKey), [samples, metricKey]);
  const peak = samples.length > 0 ? Math.max(...samples.map((s) => Number(s[metricKey]))) : 0;
  const playheadSample =
    playheadIndex !== null && samples[playheadIndex] ? samples[playheadIndex] : null;

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
        <line
          x1={CHART_PAD}
          y1={CHART_HEIGHT - CHART_PAD}
          x2={CHART_WIDTH - CHART_PAD}
          y2={CHART_HEIGHT - CHART_PAD}
          stroke="var(--border)"
          strokeWidth={1}
        />
        {geometry.points ? (
          <polyline points={geometry.points} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
        ) : null}
        {markers.map((m) => {
          const sample = samples[m.index];
          if (!sample) return null;
          return (
            <circle
              key={m.index}
              cx={geometry.toX(sample.t)}
              cy={geometry.toY(Number(sample[metricKey]))}
              r={4}
              className="cursor-pointer"
              fill="var(--warning)"
              stroke="var(--surface-solid)"
              strokeWidth={1}
              onClick={() => onMarkerClick(m)}
            >
              <title>{m.label}</title>
            </circle>
          );
        })}
        {playheadSample ? (
          <>
            <line
              x1={geometry.toX(playheadSample.t)}
              y1={CHART_PAD}
              x2={geometry.toX(playheadSample.t)}
              y2={CHART_HEIGHT - CHART_PAD}
              stroke="var(--accent-blue)"
              strokeWidth={1.25}
              strokeDasharray="3 3"
            />
            <circle
              cx={geometry.toX(playheadSample.t)}
              cy={geometry.toY(Number(playheadSample[metricKey]))}
              r={3.5}
              fill="var(--accent-blue)"
              stroke="var(--surface-solid)"
              strokeWidth={1}
            />
          </>
        ) : null}
      </svg>
    </div>
  );
}

const REPLAY_STEP_MS = 140;
type ReplaySpeed = 0.5 | 1 | 2;

export function SimulationDetailClient({ simulation }: { simulation: SimulationDetail }) {
  const router = useRouter();
  const [runs, setRuns] = useState(simulation.runs);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(simulation.runs[0]?.id ?? null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [replayIndex, setReplayIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [inspector, setInspector] = useState<string | null>(null);

  const selectedRun = runs.find((r) => r.id === selectedRunId) ?? runs[0] ?? null;
  const telemetry = useMemo(() => (selectedRun ? parseTelemetry(selectedRun.telemetry) : []), [selectedRun]);
  const warnings = useMemo(() => (selectedRun ? parseWarnings(selectedRun.warnings) : []), [selectedRun]);
  const failureAnalysis = useMemo(
    () => (selectedRun ? parseFailureAnalysis(selectedRun.failureAnalysis) : []),
    [selectedRun]
  );

  // Reset replay state whenever the selected run changes — a new run means a
  // new telemetry array, so the scrubber and inspector must not carry over.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReplayIndex(0);
    setPlaying(false);
    setInspector(null);
  }, [selectedRunId]);

  // Autoplay loop. Cleans up its interval on every re-run (speed/pause
  // change) and on unmount — never leaves a stray timer running.
  useEffect(() => {
    if (!playing || telemetry.length === 0) return;
    const id = setInterval(() => {
      setReplayIndex((i) => Math.min(i + 1, telemetry.length - 1));
    }, REPLAY_STEP_MS / speed);
    return () => clearInterval(id);
  }, [playing, speed, telemetry.length]);

  // Auto-pause once the scrubber reaches the last sample.
  useEffect(() => {
    if (playing && telemetry.length > 0 && replayIndex >= telemetry.length - 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPlaying(false);
    }
  }, [replayIndex, playing, telemetry.length]);

  const eventMarkers = useMemo<EventMarker[]>(() => {
    if (telemetry.length === 0) return [];
    // Thresholds mirror the physics engine's own warning/failure checks
    // (see src/lib/lab/physics.ts): peak dynamic load > ~4.5g and thermal
    // load > 42°C. Total mass isn't sent to the client, so userMassKg is
    // used as a close approximation of totalMassKg (equipment mass is a
    // small fraction of it).
    const forceThreshold = simulation.userMassKg * simulation.scenario.gravityMs2 * 4.5;
    const found: EventMarker[] = [];
    telemetry.forEach((s, i) => {
      if (s.forceN > forceThreshold) {
        found.push({ index: i, metric: "forceN", label: `t=${s.t.toFixed(1)}s — peak force ${s.forceN.toFixed(0)}N` });
      }
      if (s.thermalLoadC > 42) {
        found.push({
          index: i,
          metric: "thermalLoadC",
          label: `t=${s.t.toFixed(1)}s — thermal load ${s.thermalLoadC.toFixed(1)}°C`,
        });
      }
    });
    if (found.length === 0) {
      let peakForceIdx = 0;
      let peakThermalIdx = 0;
      telemetry.forEach((s, i) => {
        if (s.forceN > telemetry[peakForceIdx].forceN) peakForceIdx = i;
        if (s.thermalLoadC > telemetry[peakThermalIdx].thermalLoadC) peakThermalIdx = i;
      });
      found.push({
        index: peakForceIdx,
        metric: "forceN",
        label: `t=${telemetry[peakForceIdx].t.toFixed(1)}s — peak force ${telemetry[peakForceIdx].forceN.toFixed(0)}N`,
      });
      if (peakThermalIdx !== peakForceIdx) {
        found.push({
          index: peakThermalIdx,
          metric: "thermalLoadC",
          label: `t=${telemetry[peakThermalIdx].t.toFixed(1)}s — peak thermal ${telemetry[peakThermalIdx].thermalLoadC.toFixed(1)}°C`,
        });
      }
    }
    const seen = new Set<number>();
    return found.filter((m) => (seen.has(m.index) ? false : (seen.add(m.index), true))).slice(0, 6);
  }, [telemetry, simulation.userMassKg, simulation.scenario.gravityMs2]);

  function jumpToMarker(marker: EventMarker) {
    setReplayIndex(marker.index);
    setPlaying(false);
    setInspector(marker.label);
  }

  function togglePlay() {
    if (telemetry.length === 0) return;
    if (!playing && replayIndex >= telemetry.length - 1) {
      setReplayIndex(0);
    }
    setPlaying((p) => !p);
  }

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
        failureAnalysis: data.run.failureAnalysis,
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
          {selectedRun.status === "FAILED" ? (
            <HolographicPanel className="border-danger/40 bg-danger-muted p-4">
              <div className="flex items-center gap-2">
                <LabStatusBadge status="FAILED" />
                <p className="text-sm font-semibold text-danger">Simulation Failed</p>
              </div>
              <p className="mt-2 text-xs text-muted">
                This run exceeded one or more of the physics model&apos;s sustainable-operation thresholds. See the
                structured failure analysis below — this is a diagnosis, not a generic warning.
              </p>
            </HolographicPanel>
          ) : null}

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

            {/* Replay controls */}
            <div className="mt-4 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-[var(--surface-solid)] px-3 py-2.5">
              <button
                type="button"
                onClick={togglePlay}
                disabled={telemetry.length === 0}
                className="rounded-md border border-border px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                {playing ? "⏸ Pause" : "▶ Replay"}
              </button>
              <input
                type="range"
                min={0}
                max={Math.max(telemetry.length - 1, 0)}
                value={replayIndex}
                onChange={(e) => {
                  setPlaying(false);
                  setReplayIndex(Number(e.target.value));
                }}
                disabled={telemetry.length === 0}
                className="h-1 min-w-[140px] flex-1 accent-[var(--accent-blue)]"
                aria-label="Replay scrubber"
              />
              <span className="lab-mono w-16 shrink-0 text-right text-[10px] text-muted-foreground">
                t={telemetry[replayIndex]?.t.toFixed(1) ?? "0.0"}s
              </span>
              <div className="flex items-center gap-1">
                {([0.5, 1, 2] as ReplaySpeed[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSpeed(s)}
                    className={`lab-mono rounded-md border px-2 py-1 text-[10px] font-semibold transition-colors ${
                      speed === s
                        ? "border-[var(--border-strong)] bg-accent-muted text-accent"
                        : "border-border text-muted hover:bg-surface-hover hover:text-foreground"
                    }`}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </div>

            {inspector ? (
              <p className="lab-mono mt-2 text-[11px] text-accent-blue">{inspector}</p>
            ) : null}

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <TelemetryChart
                samples={telemetry}
                metricKey="forceN"
                label="Force"
                unit="N"
                color="var(--accent)"
                playheadIndex={telemetry.length > 0 ? replayIndex : null}
                markers={eventMarkers.filter((m) => m.metric === "forceN")}
                onMarkerClick={jumpToMarker}
              />
              <TelemetryChart
                samples={telemetry}
                metricKey="thermalLoadC"
                label="Thermal Load"
                unit="°C"
                color="var(--accent-blue)"
                playheadIndex={telemetry.length > 0 ? replayIndex : null}
                markers={eventMarkers.filter((m) => m.metric === "thermalLoadC")}
                onMarkerClick={jumpToMarker}
              />
            </div>

            {eventMarkers.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {eventMarkers.map((m) => (
                  <button
                    key={`${m.metric}-${m.index}`}
                    type="button"
                    onClick={() => jumpToMarker(m)}
                    className="lab-mono rounded-md border border-warning/40 bg-warning/10 px-2 py-1 text-[10px] text-warning transition-colors hover:bg-warning/20"
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            ) : null}

            {warnings.length > 0 ? (
              <div className="mt-4 flex flex-col gap-2">
                {warnings.map((w, i) => (
                  <SafetyNotice key={i}>{w}</SafetyNotice>
                ))}
              </div>
            ) : null}

            {failureAnalysis.length > 0 ? (
              <div className="mt-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <LabSectionLabel className="text-danger/80">Failure Analysis</LabSectionLabel>
                  <LabStatusBadge status="FAILED" />
                </div>
                {failureAnalysis.map((f, i) => (
                  <div key={i} className="rounded-lg border border-danger/30 bg-danger-muted px-3 py-2.5">
                    <p className="lab-mono text-[10px] font-semibold uppercase tracking-wider text-danger">
                      {FAILURE_CATEGORY_LABEL[f.category] ?? f.category}
                    </p>
                    <p className="mt-1 text-xs text-foreground">{f.explanation}</p>
                    <p className="mt-1 text-xs text-muted">Suggestion: {f.suggestion}</p>
                  </div>
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
                  <span className="flex items-center gap-2">
                    <span className="text-foreground">{r.summary ?? `Run ${r.id.slice(0, 8)}`}</span>
                    {r.status === "FAILED" ? <LabStatusBadge status="FAILED" /> : null}
                  </span>
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
