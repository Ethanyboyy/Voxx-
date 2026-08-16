"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { HolographicPanel, LabSectionLabel, SafetyNotice } from "@/components/lab/primitives";
import { cn } from "@/lib/utils/cn";

const ROUNDS = 3;
const MIN_DELAY_MS = 1000;
const MAX_DELAY_MS = 4000;

type MetricKey =
  | "movementEfficiencyPercent"
  | "staminaUsedPercent"
  | "balanceScore"
  | "accuracyPercent"
  | "decisionQualityPercent"
  | "defensiveSuccessPercent";

interface MetricConfig {
  key: MetricKey;
  label: string;
  hint: string;
}

const CATEGORY_LABEL: Record<string, string> = {
  MOVEMENT: "Movement",
  AGILITY: "Agility",
  BALANCE: "Balance",
  REACTION: "Reaction",
  OBSTACLE_NAVIGATION: "Obstacle Navigation",
  DEFENSIVE_POSITIONING: "Defensive Positioning",
  SITUATIONAL_AWARENESS: "Situational Awareness",
  DE_ESCALATION: "De-escalation",
  EMERGENCY_ESCAPE: "Emergency Escape",
  SPARRING: "Sparring",
};

const CATEGORY_METRICS: Record<string, MetricConfig[]> = {
  MOVEMENT: [
    { key: "movementEfficiencyPercent", label: "Movement efficiency", hint: "Self-rate how efficiently you moved through the drill." },
    { key: "staminaUsedPercent", label: "Stamina used", hint: "Self-rate stamina expenditure — higher means more tiring." },
  ],
  AGILITY: [
    { key: "movementEfficiencyPercent", label: "Agility efficiency", hint: "Self-rate how cleanly you moved between positions." },
  ],
  BALANCE: [
    { key: "balanceScore", label: "Balance held", hint: "Self-rate how well you held balance through the drill." },
  ],
  REACTION: [],
  OBSTACLE_NAVIGATION: [
    { key: "accuracyPercent", label: "Navigation accuracy", hint: "Self-rate how accurately you navigated the simulated obstacles." },
  ],
  DEFENSIVE_POSITIONING: [
    { key: "defensiveSuccessPercent", label: "Defensive success", hint: "Self-rate positioning success against the simulated scenario." },
  ],
  SITUATIONAL_AWARENESS: [
    { key: "decisionQualityPercent", label: "Awareness / decision quality", hint: "Self-rate the quality of your read on the simulated environment." },
  ],
  DE_ESCALATION: [
    { key: "decisionQualityPercent", label: "De-escalation decision quality", hint: "Self-rate the quality of your simulated de-escalation choices." },
  ],
  EMERGENCY_ESCAPE: [
    { key: "accuracyPercent", label: "Escape route accuracy", hint: "Self-rate how well you identified the simulated escape route." },
  ],
  SPARRING: [
    { key: "defensiveSuccessPercent", label: "Defensive success (simulated opponent)", hint: "Self-rate defensive success against a simulated, non-physical opponent." },
  ],
};

interface TrainingModuleDetail {
  id: string;
  name: string;
  category: string;
  difficulty: string;
  description: string;
  objective: string;
  durationMinutesEstimate: number;
}

interface SessionHistoryItem {
  id: string;
  score: number;
  reactionTimeMs: number | null;
  completionTimeS: number | null;
  movementEfficiencyPercent: number | null;
  staminaUsedPercent: number | null;
  balanceScore: number | null;
  accuracyPercent: number | null;
  decisionQualityPercent: number | null;
  defensiveSuccessPercent: number | null;
  mistakes: number | null;
  notes: string | null;
  when: string;
}

type GamePhase = "idle" | "waiting" | "go" | "early" | "complete";

function Slider({
  label,
  hint,
  value,
  onChange,
  max = 100,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
  max?: number;
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-foreground">{label}</span>
        <span className="lab-mono text-accent">{value}</span>
      </div>
      <input
        type="range"
        min={0}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-[var(--accent)]"
      />
      <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p>
    </div>
  );
}

export function TrainingSessionClient({
  module: trainingModule,
  initialSessions,
}: {
  module: TrainingModuleDetail;
  initialSessions: SessionHistoryItem[];
}) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initialSessions);

  // Reaction-time game state
  const [phase, setPhase] = useState<GamePhase>("idle");
  const [times, setTimes] = useState<number[]>([]);
  const goAtRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Self-reported metrics
  const extraMetrics = CATEGORY_METRICS[trainingModule.category] ?? [];
  const [metricValues, setMetricValues] = useState<Partial<Record<MetricKey, number>>>(() => {
    const init: Partial<Record<MetricKey, number>> = {};
    for (const m of extraMetrics) init[m.key] = 70;
    return init;
  });
  const [mistakes, setMistakes] = useState(0);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastScore, setLastScore] = useState<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function startRound() {
    setPhase("waiting");
    const delay = MIN_DELAY_MS + Math.random() * (MAX_DELAY_MS - MIN_DELAY_MS);
    timeoutRef.current = setTimeout(() => {
      goAtRef.current = performance.now();
      setPhase("go");
    }, delay);
  }

  function handleZoneTap() {
    if (phase === "waiting") {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setPhase("early");
      return;
    }
    if (phase === "go") {
      const delta = performance.now() - (goAtRef.current ?? performance.now());
      const next = [...times, delta];
      setTimes(next);
      setPhase(next.length >= ROUNDS ? "complete" : "idle");
    }
  }

  function resetGame() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setPhase("idle");
    setTimes([]);
    setLastScore(null);
    setError(null);
    const init: Partial<Record<MetricKey, number>> = {};
    for (const m of extraMetrics) init[m.key] = 70;
    setMetricValues(init);
    setMistakes(0);
  }

  const avgReactionTimeMs = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;

  async function submitSession() {
    if (avgReactionTimeMs == null) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        moduleId: trainingModule.id,
        reactionTimeMs: avgReactionTimeMs,
        mistakes,
      };
      for (const m of extraMetrics) body[m.key] = metricValues[m.key];

      const res = await fetch("/api/lab/training/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to record session.");
        return;
      }
      const s = data.session;
      setSessions((prev) => [
        {
          id: s.id,
          score: s.score,
          reactionTimeMs: s.reactionTimeMs,
          completionTimeS: s.completionTimeS,
          movementEfficiencyPercent: s.movementEfficiencyPercent,
          staminaUsedPercent: s.staminaUsedPercent,
          balanceScore: s.balanceScore,
          accuracyPercent: s.accuracyPercent,
          decisionQualityPercent: s.decisionQualityPercent,
          defensiveSuccessPercent: s.defensiveSuccessPercent,
          mistakes: s.mistakes,
          notes: s.notes,
          when: s.completedAt ?? s.startedAt,
        },
        ...prev,
      ]);
      setLastScore(s.score);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="vox-panel-in flex flex-col gap-5">
      <div>
        <Link href="/lab/training" className="text-xs text-muted-foreground hover:text-foreground">
          ← Training Center
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="vox-headline text-2xl">{trainingModule.name}</h1>
          <span className="lab-mono rounded-full border border-border bg-surface-hover px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {CATEGORY_LABEL[trainingModule.category] ?? trainingModule.category}
          </span>
          <span className="lab-mono rounded-full border border-border bg-surface-hover px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {trainingModule.difficulty.toLowerCase()}
          </span>
        </div>
        <p className="mt-2 max-w-2xl text-sm text-muted">{trainingModule.description}</p>
        <p className="mt-1 max-w-2xl text-xs text-muted-foreground">Objective: {trainingModule.objective}</p>
      </div>

      <SafetyNotice>
        Simulated, abstract drills only — timing and self-assessed exercises against non-physical, simulated
        conditions. No combat instruction or real-world sparring content.
      </SafetyNotice>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <HolographicPanel corners scanline className="flex flex-col items-center gap-4 p-6">
          <LabSectionLabel className="self-start">Reaction Drill · Round {Math.min(times.length + 1, ROUNDS)} of {ROUNDS}</LabSectionLabel>

          <button
            type="button"
            onClick={phase === "waiting" || phase === "go" ? handleZoneTap : undefined}
            disabled={phase === "idle" || phase === "early" || phase === "complete"}
            className={cn(
              "flex h-56 w-full max-w-md flex-col items-center justify-center rounded-2xl border text-center transition-colors",
              phase === "waiting" && "border-warning/40 bg-warning/10 text-warning cursor-pointer",
              phase === "go" && "border-success/50 bg-success/20 text-success cursor-pointer animate-pulse",
              phase === "early" && "border-danger/40 bg-danger-muted text-danger",
              (phase === "idle" || phase === "complete") && "border-border bg-surface-hover text-muted-foreground"
            )}
          >
            {phase === "idle" && times.length === 0 && <span className="text-sm">Press Start to begin round 1</span>}
            {phase === "idle" && times.length > 0 && (
              <span className="text-sm">Round {times.length} recorded — press Start for round {times.length + 1}</span>
            )}
            {phase === "waiting" && (
              <>
                <span className="lab-mono text-2xl font-bold">WAIT…</span>
                <span className="mt-1 text-xs">Don&apos;t tap yet</span>
              </>
            )}
            {phase === "go" && (
              <>
                <span className="lab-mono text-3xl font-bold">TAP NOW</span>
              </>
            )}
            {phase === "early" && (
              <>
                <span className="lab-mono text-xl font-bold">TOO SOON</span>
                <span className="mt-1 text-xs">Wait for the signal — retry this round</span>
              </>
            )}
            {phase === "complete" && <span className="text-sm">All {ROUNDS} rounds complete</span>}
          </button>

          <div className="flex items-center gap-2">
            {(phase === "idle" || phase === "early") && (
              <Button onClick={startRound}>{phase === "early" ? "Retry Round" : times.length === 0 ? "Start Round" : "Start Next Round"}</Button>
            )}
            {times.length > 0 && phase !== "complete" && (
              <Button variant="secondary" onClick={resetGame}>
                Reset
              </Button>
            )}
          </div>

          {times.length > 0 && (
            <div className="lab-mono flex flex-wrap justify-center gap-2 text-xs text-muted-foreground">
              {times.map((t, i) => (
                <span key={i} className="rounded-full border border-border bg-surface-hover px-2 py-0.5">
                  R{i + 1}: {Math.round(t)}ms
                </span>
              ))}
            </div>
          )}

          {avgReactionTimeMs != null && (
            <p className="lab-mono text-sm text-accent">Average reaction time: {avgReactionTimeMs}ms</p>
          )}
        </HolographicPanel>

        <HolographicPanel className="flex flex-col gap-4 p-4">
          <LabSectionLabel>Session Metrics</LabSectionLabel>
          {extraMetrics.length === 0 ? (
            <p className="text-xs text-muted-foreground">This module scores from the reaction drill alone.</p>
          ) : (
            <div className="space-y-4">
              {extraMetrics.map((m) => (
                <Slider
                  key={m.key}
                  label={m.label}
                  hint={m.hint}
                  value={metricValues[m.key] ?? 70}
                  onChange={(v) => setMetricValues((prev) => ({ ...prev, [m.key]: v }))}
                />
              ))}
            </div>
          )}
          <Slider
            label="Mistakes"
            hint="Count of drill errors or fumbles this session, if any."
            value={mistakes}
            max={10}
            onChange={setMistakes}
          />

          {error ? <p className="text-xs text-danger">{error}</p> : null}
          {lastScore != null ? (
            <p className="lab-mono text-sm text-success">Session recorded — composite score {lastScore}/100.</p>
          ) : null}

          <Button onClick={submitSession} disabled={avgReactionTimeMs == null || submitting}>
            {submitting ? "Submitting…" : "Submit Session"}
          </Button>
          {avgReactionTimeMs == null ? (
            <p className="text-[10px] text-muted-foreground">Complete all {ROUNDS} reaction rounds to unlock submission.</p>
          ) : null}
        </HolographicPanel>
      </div>

      <HolographicPanel className="p-4">
        <LabSectionLabel>Session History</LabSectionLabel>
        {sessions.length === 0 ? (
          <div className="mt-3">
            <EmptyState title="No sessions yet" description="Run the drill above and submit to build your history for this module." />
          </div>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">Date</th>
                  <th className="pb-2 pr-3 font-medium">Score</th>
                  <th className="pb-2 pr-3 font-medium">Reaction</th>
                  <th className="pb-2 pr-3 font-medium">Metrics</th>
                  <th className="pb-2 font-medium">Mistakes</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id} className="border-t border-border">
                    <td className="lab-mono py-1.5 pr-3 text-muted-foreground">{new Date(s.when).toLocaleString()}</td>
                    <td className="lab-mono py-1.5 pr-3 text-accent">{s.score}</td>
                    <td className="lab-mono py-1.5 pr-3 text-foreground">
                      {s.reactionTimeMs != null ? `${Math.round(s.reactionTimeMs)}ms` : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-foreground">
                      {[
                        s.movementEfficiencyPercent != null ? `move ${s.movementEfficiencyPercent}` : null,
                        s.staminaUsedPercent != null ? `stamina ${s.staminaUsedPercent}` : null,
                        s.balanceScore != null ? `balance ${s.balanceScore}` : null,
                        s.accuracyPercent != null ? `accuracy ${s.accuracyPercent}` : null,
                        s.decisionQualityPercent != null ? `decision ${s.decisionQualityPercent}` : null,
                        s.defensiveSuccessPercent != null ? `defense ${s.defensiveSuccessPercent}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td className="lab-mono py-1.5 text-foreground">{s.mistakes ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </HolographicPanel>
    </div>
  );
}
