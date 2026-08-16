"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { HolographicPanel, LabSectionLabel, LabStatusBadge, StatBar, UnitStat, ConfidenceTag } from "@/components/lab/primitives";
import { HolographicInspectionTree, type InspectionNode } from "@/components/lab/HolographicInspectionTree";
import { useInfoMode } from "@/components/lab/InfoMode";

interface GadgetStats {
  massKg: number;
  powerRequirementW: number;
  batteryLifeHours: number;
  durability: number;
  sensorAccuracy: number;
  rangeM: number;
  manufacturingComplexity: number;
  estimatedCostUsd: number;
  reliability: number;
  confidence: string;
}

const CINEMATIC_KEYS = ["durability", "sensorAccuracy", "reliability"] as const;
const CORE_KEYS = ["durability", "sensorAccuracy", "reliability", "manufacturingComplexity"] as const;

export function GadgetDetailClient({
  gadget,
  components,
  notes,
}: {
  gadget: {
    id: string;
    name: string;
    category: string;
    description: string | null;
    status: string;
    currentVersionLabel: string;
    stats: GadgetStats;
    versions: { id: string; label: string; note: string | null; createdAt: string; isCurrent: boolean; stats: GadgetStats | null }[];
  };
  components: InspectionNode[];
  notes: { id: string; content: string; createdAt: string }[];
}) {
  const { mode } = useInfoMode();
  const router = useRouter();
  const [noteText, setNoteText] = useState("");
  const [localNotes, setLocalNotes] = useState(notes);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiReply, setAiReply] = useState<string | null>(null);

  async function askAi(message: string) {
    setAiBusy(true);
    setAiReply(null);
    const res = await fetch("/api/lab/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    const data = await res.json();
    setAiReply(data.reply ?? "No response.");
    setAiBusy(false);
    if (data.action?.type === "view_gadget") router.refresh();
  }

  async function addNote() {
    if (!noteText.trim()) return;
    const res = await fetch("/api/lab/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjectType: "LabGadget", subjectId: gadget.id, content: noteText }),
    });
    if (res.ok) {
      const data = await res.json();
      setLocalNotes((prev) => [{ id: data.note.id, content: data.note.content, createdAt: data.note.createdAt }, ...prev]);
      setNoteText("");
    }
  }

  const keysToShow = mode === "CINEMATIC" ? CINEMATIC_KEYS : CORE_KEYS;

  return (
    <div className="vox-panel-in flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="vox-headline text-2xl">{gadget.name}</h1>
            <LabStatusBadge status={gadget.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {gadget.category} · current {gadget.currentVersionLabel}
          </p>
          {gadget.description ? <p className="mt-2 max-w-2xl text-sm text-muted">{gadget.description}</p> : null}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => askAi(`Analyze gadget ${gadget.name} and list its strengths and weaknesses.`)} disabled={aiBusy}>
            {aiBusy ? "Analyzing…" : "Ask AI Engineer"}
          </Button>
        </div>
      </div>

      {aiReply ? (
        <HolographicPanel className="p-4 text-sm text-foreground">
          <LabSectionLabel>AI Lab Engineer</LabSectionLabel>
          <p className="mt-2 whitespace-pre-wrap">{aiReply}</p>
        </HolographicPanel>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1fr]">
        <div className="flex flex-col gap-4">
          <HolographicPanel className="p-4">
            <div className="flex items-center justify-between">
              <LabSectionLabel>Statistics</LabSectionLabel>
              {mode === "EVERYTHING" ? <ConfidenceTag confidence={gadget.stats.confidence} /> : null}
            </div>
            <div className="mt-3 space-y-2">
              {keysToShow.map((k) => (
                <StatBar key={k} statKey={k} value={(gadget.stats as unknown as Record<string, number>)[k]} />
              ))}
            </div>
            {mode !== "CINEMATIC" ? (
              <div className="mt-4 grid grid-cols-2 gap-x-6 border-t border-border pt-3 sm:grid-cols-3">
                <UnitStat label="Mass" value={gadget.stats.massKg} unit="kg" />
                <UnitStat label="Power req." value={gadget.stats.powerRequirementW} unit="W" />
                <UnitStat label="Battery life" value={gadget.stats.batteryLifeHours} unit="hrs" />
                <UnitStat label="Range" value={gadget.stats.rangeM} unit="m" />
                {mode === "EVERYTHING" ? <UnitStat label="Est. cost" value={gadget.stats.estimatedCostUsd} unit="USD" /> : null}
              </div>
            ) : null}
          </HolographicPanel>

          <HolographicPanel className="p-4">
            <LabSectionLabel>Component Inspection</LabSectionLabel>
            <div className="mt-3">
              <HolographicInspectionTree nodes={components} />
            </div>
          </HolographicPanel>

          {mode === "EVERYTHING" ? (
            <HolographicPanel className="p-4">
              <LabSectionLabel>Version History</LabSectionLabel>
              <div className="mt-3 space-y-2">
                {gadget.versions.map((v) => (
                  <div key={v.id} className="flex items-center justify-between text-sm">
                    <div>
                      <span className={v.isCurrent ? "font-semibold text-accent" : "text-foreground"}>{v.label}</span>
                      {v.note ? <span className="ml-2 text-xs text-muted">{v.note}</span> : null}
                    </div>
                    <span className="lab-mono text-[10px] text-muted-foreground">{new Date(v.createdAt).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            </HolographicPanel>
          ) : null}

          <HolographicPanel className="p-4">
            <LabSectionLabel>Design Notes</LabSectionLabel>
            <div className="mt-3 flex gap-2">
              <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} rows={1} placeholder="Add a note…" />
              <Button size="sm" onClick={addNote}>
                Add
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              {localNotes.map((n) => (
                <div key={n.id} className="text-xs text-muted">
                  <span className="text-foreground">{n.content}</span>
                  <span className="ml-2 text-muted-foreground">{new Date(n.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </HolographicPanel>
        </div>
      </div>
    </div>
  );
}
