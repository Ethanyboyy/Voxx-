"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Textarea } from "@/components/ui/Field";
import { EmptyState } from "@/components/ui/EmptyState";
import { HolographicPanel, LabSectionLabel } from "@/components/lab/primitives";
import { cn } from "@/lib/utils/cn";

export interface ScenarioListItem {
  id: string;
  name: string;
  environment: string;
  objectiveType: string;
  difficulty: string;
  description: string | null;
  timeOfDay: string;
  precipitation: string;
  windMs: number;
  temperatureC: number;
  fogPercent: number;
  gravityMs2: number;
  surfaceType: string;
  elevationM: number;
  obstacleCount: number;
  isCustom: boolean;
}

const ENVIRONMENTS = ["ROOFTOP", "WAREHOUSE", "URBAN_STREET", "INDUSTRIAL_FACILITY", "FOREST", "TRAINING_ARENA", "LABORATORY"];
const OBJECTIVE_TYPES = ["NAVIGATION", "RESCUE", "ESCAPE", "TIMED_TRAVERSAL", "EQUIPMENT_TEST", "ENVIRONMENTAL_TEST", "TRAINING"];
const DIFFICULTIES = ["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERIMENTAL"];

const ENVIRONMENT_LABEL: Record<string, string> = {
  ROOFTOP: "Rooftop",
  WAREHOUSE: "Warehouse",
  URBAN_STREET: "Urban Street",
  INDUSTRIAL_FACILITY: "Industrial Facility",
  FOREST: "Forest",
  TRAINING_ARENA: "Training Arena",
  LABORATORY: "Laboratory",
};

const DEFAULT_FORM = {
  name: "",
  environment: "ROOFTOP",
  objectiveType: "TRAINING",
  difficulty: "BEGINNER",
  description: "",
  timeOfDay: "day",
  precipitation: "none",
  windMs: 0,
  temperatureC: 18,
  fogPercent: 0,
  gravityMs2: 9.81,
  surfaceType: "concrete",
  elevationM: 0,
  obstacleCount: 0,
};

export function ScenarioGeneratorClient({ initialScenarios }: { initialScenarios: ScenarioListItem[] }) {
  const [scenarios, setScenarios] = useState(initialScenarios);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(DEFAULT_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, ScenarioListItem[]>();
    for (const s of scenarios) {
      const list = map.get(s.environment) ?? [];
      list.push(s);
      map.set(s.environment, list);
    }
    return Array.from(map.entries());
  }, [scenarios]);

  function updateField<K extends keyof typeof DEFAULT_FORM>(key: K, value: (typeof DEFAULT_FORM)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function submit() {
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/lab/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          description: form.description || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create scenario.");
        return;
      }
      const s = data.scenario;
      setScenarios((prev) => [
        ...prev,
        {
          id: s.id,
          name: s.name,
          environment: s.environment,
          objectiveType: s.objectiveType,
          difficulty: s.difficulty,
          description: s.description,
          timeOfDay: s.timeOfDay,
          precipitation: s.precipitation,
          windMs: s.windMs,
          temperatureC: s.temperatureC,
          fogPercent: s.fogPercent,
          gravityMs2: s.gravityMs2,
          surfaceType: s.surfaceType,
          elevationM: s.elevationM,
          obstacleCount: s.obstacleCount,
          isCustom: s.isCustom,
        },
      ]);
      setForm(DEFAULT_FORM);
      setShowForm(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-5 flex flex-col gap-5">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Cancel" : "Generate Scenario"}
        </Button>
      </div>

      {showForm ? (
        <HolographicPanel className="p-4">
          <LabSectionLabel>New Scenario</LabSectionLabel>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="sm:col-span-2 lg:col-span-3">
              <Label htmlFor="scenario-name">Name</Label>
              <Input id="scenario-name" value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder="e.g. Storm-lashed rooftop crossing" />
            </div>

            <div>
              <Label htmlFor="scenario-environment">Environment</Label>
              <Select id="scenario-environment" value={form.environment} onChange={(e) => updateField("environment", e.target.value)}>
                {ENVIRONMENTS.map((e) => (
                  <option key={e} value={e}>
                    {ENVIRONMENT_LABEL[e] ?? e}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="scenario-objective">Objective Type</Label>
              <Select id="scenario-objective" value={form.objectiveType} onChange={(e) => updateField("objectiveType", e.target.value)}>
                {OBJECTIVE_TYPES.map((o) => (
                  <option key={o} value={o}>
                    {o.toLowerCase().replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="scenario-difficulty">Difficulty</Label>
              <Select id="scenario-difficulty" value={form.difficulty} onChange={(e) => updateField("difficulty", e.target.value)}>
                {DIFFICULTIES.map((d) => (
                  <option key={d} value={d}>
                    {d.toLowerCase()}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="scenario-time">Time of Day</Label>
              <Select id="scenario-time" value={form.timeOfDay} onChange={(e) => updateField("timeOfDay", e.target.value)}>
                <option value="day">Day</option>
                <option value="dusk">Dusk</option>
                <option value="night">Night</option>
                <option value="dawn">Dawn</option>
              </Select>
            </div>

            <div>
              <Label htmlFor="scenario-precip">Precipitation</Label>
              <Select id="scenario-precip" value={form.precipitation} onChange={(e) => updateField("precipitation", e.target.value)}>
                <option value="none">None</option>
                <option value="rain">Rain</option>
                <option value="snow">Snow</option>
                <option value="sleet">Sleet</option>
              </Select>
            </div>

            <div>
              <Label htmlFor="scenario-surface">Surface Type</Label>
              <Input id="scenario-surface" value={form.surfaceType} onChange={(e) => updateField("surfaceType", e.target.value)} placeholder="concrete" />
            </div>

            <div>
              <Label htmlFor="scenario-wind">Wind (m/s)</Label>
              <Input id="scenario-wind" type="number" step="0.1" min={0} value={form.windMs} onChange={(e) => updateField("windMs", Number(e.target.value))} />
            </div>

            <div>
              <Label htmlFor="scenario-temp">Temperature (°C)</Label>
              <Input id="scenario-temp" type="number" step="0.5" value={form.temperatureC} onChange={(e) => updateField("temperatureC", Number(e.target.value))} />
            </div>

            <div>
              <Label htmlFor="scenario-fog">Fog (%)</Label>
              <Input id="scenario-fog" type="number" min={0} max={100} value={form.fogPercent} onChange={(e) => updateField("fogPercent", Number(e.target.value))} />
            </div>

            <div>
              <Label htmlFor="scenario-gravity">Gravity (m/s²)</Label>
              <Input id="scenario-gravity" type="number" step="0.01" min={0} value={form.gravityMs2} onChange={(e) => updateField("gravityMs2", Number(e.target.value))} />
            </div>

            <div>
              <Label htmlFor="scenario-elevation">Elevation (m)</Label>
              <Input id="scenario-elevation" type="number" step="0.5" value={form.elevationM} onChange={(e) => updateField("elevationM", Number(e.target.value))} />
            </div>

            <div>
              <Label htmlFor="scenario-obstacles">Obstacle Count</Label>
              <Input id="scenario-obstacles" type="number" min={0} step={1} value={form.obstacleCount} onChange={(e) => updateField("obstacleCount", Number(e.target.value))} />
            </div>

            <div className="sm:col-span-2 lg:col-span-3">
              <Label htmlFor="scenario-description">Description</Label>
              <Textarea id="scenario-description" rows={2} value={form.description} onChange={(e) => updateField("description", e.target.value)} placeholder="Optional notes about this scenario…" />
            </div>
          </div>

          {error ? <p className="mt-3 text-xs text-danger">{error}</p> : null}

          <div className="mt-4 flex gap-2">
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Generating…" : "Create Scenario"}
            </Button>
          </div>
        </HolographicPanel>
      ) : null}

      {scenarios.length === 0 ? (
        <EmptyState title="No scenarios yet" description="Generate a custom scenario, or seed data has not loaded." />
      ) : (
        grouped.map(([environment, items]) => (
          <div key={environment}>
            <LabSectionLabel>{ENVIRONMENT_LABEL[environment] ?? environment}</LabSectionLabel>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((s) => (
                <HolographicPanel key={s.id} corners className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-semibold text-foreground">{s.name}</p>
                    <span
                      className={cn(
                        "lab-mono shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        s.isCustom
                          ? "border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10 text-accent-blue"
                          : "border-border bg-surface-hover text-muted-foreground"
                      )}
                    >
                      {s.isCustom ? "Custom" : "Seed"}
                    </span>
                  </div>
                  {s.description ? <p className="mt-1.5 text-xs text-muted">{s.description}</p> : null}
                  <div className="lab-mono mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                    <span>{s.objectiveType.toLowerCase().replace(/_/g, " ")}</span>
                    <span>{s.difficulty.toLowerCase()}</span>
                    <span>{s.timeOfDay} · {s.precipitation}</span>
                    <span>wind {s.windMs}m/s</span>
                    <span>{s.temperatureC}°C · fog {s.fogPercent}%</span>
                    <span>g {s.gravityMs2}m/s²</span>
                    <span>{s.surfaceType}</span>
                    <span>elev {s.elevationM}m · obst {s.obstacleCount}</span>
                  </div>
                </HolographicPanel>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
