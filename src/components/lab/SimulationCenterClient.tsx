"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Select, Label } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { HolographicPanel, LabSectionLabel, LabStatusBadge } from "@/components/lab/primitives";

interface SimulationListItem {
  id: string;
  name: string;
  scenarioName: string;
  suitCodename: string | null;
  lastRun: {
    id: string;
    summary: string | null;
    peakVelocityMs: number | null;
    status: string;
    createdAt: string;
  } | null;
}

interface ScenarioOption {
  id: string;
  name: string;
  environment: string;
  difficulty: string;
  isCustom: boolean;
}

export function SimulationCenterClient({
  initialSimulations,
  scenarios,
  suits,
  gadgets,
  projects,
}: {
  initialSimulations: SimulationListItem[];
  scenarios: ScenarioOption[];
  suits: { id: string; codename: string }[];
  gadgets: { id: string; name: string }[];
  projects: { id: string; name: string }[];
}) {
  const [simulations, setSimulations] = useState(initialSimulations);
  const [showForm, setShowForm] = useState(false);
  const router = useRouter();

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1" />
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "New Simulation"}
        </Button>
      </div>

      {showForm ? (
        <NewSimulationForm
          scenarios={scenarios}
          suits={suits}
          gadgets={gadgets}
          projects={projects}
          onCreated={(sim) => {
            setSimulations((prev) => [
              {
                id: sim.id,
                name: sim.name,
                scenarioName: scenarios.find((s) => s.id === sim.scenarioId)?.name ?? "Unknown scenario",
                suitCodename: suits.find((s) => s.id === sim.suitId)?.codename ?? null,
                lastRun: null,
              },
              ...prev,
            ]);
            setShowForm(false);
            router.push(`/lab/simulation/${sim.id}`);
          }}
        />
      ) : null}

      {simulations.length === 0 ? (
        <EmptyState
          title="No simulations yet"
          description="Create a simulation by picking a scenario, then run it to generate real telemetry."
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {simulations.map((s) => (
            <Link key={s.id} href={`/lab/simulation/${s.id}`}>
              <HolographicPanel corners className="vox-lift h-full p-4 transition-colors hover:border-[var(--border-strong)] hover:bg-surface-hover">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">{s.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {s.scenarioName}
                      {s.suitCodename ? ` · ${s.suitCodename}` : ""}
                    </p>
                  </div>
                  {s.lastRun ? <LabStatusBadge status={s.lastRun.status} /> : null}
                </div>
                <div className="mt-3 min-h-[2.5rem] text-xs text-muted">
                  {s.lastRun ? (
                    <>
                      <p>{s.lastRun.summary}</p>
                      <p className="lab-mono mt-1 text-[10px] text-muted-foreground">
                        {new Date(s.lastRun.createdAt).toLocaleString()}
                      </p>
                    </>
                  ) : (
                    <p className="text-muted-foreground">Not yet run.</p>
                  )}
                </div>
              </HolographicPanel>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function NewSimulationForm({
  scenarios,
  suits,
  gadgets,
  projects,
  onCreated,
}: {
  scenarios: ScenarioOption[];
  suits: { id: string; codename: string }[];
  gadgets: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  onCreated: (sim: { id: string; name: string; scenarioId: string; suitId: string | null }) => void;
}) {
  const [name, setName] = useState("");
  const [scenarioId, setScenarioId] = useState(scenarios[0]?.id ?? "");
  const [suitId, setSuitId] = useState("");
  const [gadgetIds, setGadgetIds] = useState<string[]>([]);
  const [projectId, setProjectId] = useState("");
  const [userMassKg, setUserMassKg] = useState(75);
  const [reactionTimeMs, setReactionTimeMs] = useState(250);
  const [skillLevel, setSkillLevel] = useState(50);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleGadget(id: string) {
    setGadgetIds((prev) => (prev.includes(id) ? prev.filter((g) => g !== id) : [...prev, id]));
  }

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Simulation name is required.");
      return;
    }
    if (!scenarioId) {
      setError("Select a scenario.");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/lab/simulations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        scenarioId,
        suitId: suitId || undefined,
        gadgetIds: gadgetIds.length > 0 ? gadgetIds : undefined,
        projectId: projectId || undefined,
        userMassKg,
        reactionTimeMs,
        skillLevel,
      }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      onCreated(data.simulation);
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Failed to create simulation.");
    }
  }

  return (
    <HolographicPanel corners className="p-4">
      <LabSectionLabel>New Simulation</LabSectionLabel>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Rooftop Traverse v1" />
        </div>
        <div>
          <Label>Scenario</Label>
          <Select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
            {scenarios.length === 0 ? <option value="">No scenarios available</option> : null}
            {scenarios.map((sc) => (
              <option key={sc.id} value={sc.id}>
                {sc.name} · {sc.environment} · {sc.difficulty}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Suit (optional)</Label>
          <Select value={suitId} onChange={(e) => setSuitId(e.target.value)}>
            <option value="">No suit</option>
            {suits.map((s) => (
              <option key={s.id} value={s.id}>
                {s.codename}
              </option>
            ))}
          </Select>
        </div>
        {projects.length > 0 ? (
          <div>
            <Label>Project (optional)</Label>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">No project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div>
          <Label>User mass (kg)</Label>
          <Input type="number" value={userMassKg} onChange={(e) => setUserMassKg(Number(e.target.value))} />
        </div>
        <div>
          <Label>Reaction time (ms)</Label>
          <Input type="number" value={reactionTimeMs} onChange={(e) => setReactionTimeMs(Number(e.target.value))} />
        </div>
        <div>
          <Label>Skill level (0-100)</Label>
          <Input
            type="number"
            min={0}
            max={100}
            value={skillLevel}
            onChange={(e) => setSkillLevel(Number(e.target.value))}
          />
        </div>
      </div>

      {gadgets.length > 0 ? (
        <div className="mt-3">
          <Label>Gadgets (optional)</Label>
          <div className="flex flex-wrap gap-1.5">
            {gadgets.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => toggleGadget(g.id)}
                className={`lab-mono rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide ${
                  gadgetIds.includes(g.id)
                    ? "border-[var(--border-strong)] bg-accent-muted text-accent"
                    : "border-border text-muted-foreground"
                }`}
              >
                {g.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
      <Button className="mt-4" onClick={handleSubmit} disabled={busy || scenarios.length === 0}>
        {busy ? "Creating…" : "Create Simulation"}
      </Button>
    </HolographicPanel>
  );
}
