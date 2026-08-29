"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Field";
import { HolographicPanel, LabSectionLabel, LabStatusBadge, RealityStatusTag, StatBar } from "@/components/lab/primitives";
import { HolographicModel, type SuitLayer } from "@/components/lab/HolographicModel";
import { SuitOverviewPanel } from "@/components/lab/SuitOverviewPanel";
import type {
  ArmorLevel,
  MaskLensStyle,
  MaterialLanguage,
  PatternStyle,
  Silhouette,
} from "@/components/lab/three/suitDesign";
import { HolographicInspectionTree, type InspectionNode } from "@/components/lab/HolographicInspectionTree";
import { SuitCinematicGallery, ConceptImagesPanel, type SuitImageDTO } from "@/components/lab/SuitCinematicGallery";
import { useInfoMode } from "@/components/lab/InfoMode";
import { useEventStream } from "@/lib/events/useEventStream";
import type { LiveEvent } from "@/lib/events/bus";
import { cn } from "@/lib/utils/cn";

interface SuitStats {
  stealth: number;
  durability: number;
  mobility: number;
  stretchiness: number;
  weightKg: number;
  thermalLoadC: number;
  protection: number;
  environmentalResistance: number;
  manufacturingComplexity: number;
  estimatedBuildHours: number;
  estimatedCostUsd: number;
  flexibility: number;
  impactResistance: number;
  visibility: number;
  noiseProfile: number;
  sensorCapacity: number;
  energyRequirementW: number;
  maintenanceComplexity: number;
  confidence: string;
}

export interface RequirementDTO {
  id: string;
  code: string;
  title: string;
  status: string;
  priority: string;
  subsystem: string | null;
  verificationMethod: string | null;
  evidence: string | null;
}

export interface QuestionDTO {
  id: string;
  question: string;
  importance: string;
  subsystem: string | null;
  resolved: boolean;
  currentHypothesis: string | null;
  nextAction: string | null;
}

export interface DecisionDTO {
  id: string;
  decision: string;
  selectedOption: string | null;
  rationale: string | null;
  author: string;
  createdAt: string;
}

const CINEMATIC_KEYS = ["stealth", "durability", "mobility", "flexibility"] as const;
const CORE_KEYS = ["stealth", "durability", "mobility", "stretchiness", "protection", "environmentalResistance", "flexibility", "impactResistance", "visibility", "noiseProfile", "sensorCapacity", "manufacturingComplexity", "maintenanceComplexity"] as const;

const ALL_LAYERS: SuitLayer[] = ["outer", "structural", "thermal", "electronics", "sensors", "mask", "gloves", "boots"];

const SUBSYSTEMS = ["HEAD", "TORSO", "ARMS", "LEGS", "FEET", "CORE"] as const;
const SUBSYSTEM_LABEL: Record<string, string> = { HEAD: "Head", TORSO: "Torso", ARMS: "Arms", LEGS: "Legs", FEET: "Feet", CORE: "Core" };

const REQ_STATUS_CLASS: Record<string, string> = {
  HYPOTHESIS: "text-warning border-warning/40 bg-warning/10",
  MODELED: "text-accent-blue border-[var(--accent-blue)]/40 bg-[var(--accent-blue)]/10",
  TESTED: "text-accent border-accent/40 bg-accent-muted",
  VERIFIED: "text-success border-success/40 bg-success/10",
};

const PRIORITY_CLASS: Record<string, string> = {
  LOW: "text-muted-foreground border-border",
  MEDIUM: "text-accent-blue border-[var(--accent-blue)]/40",
  HIGH: "text-warning border-warning/40",
  CRITICAL: "text-danger border-danger/40",
};

function humanizeEventType(type: string): string {
  return type.replace(/[._]/g, " ");
}

export function SuitDetailClient({
  suit,
  components,
  notes,
  requirements: initialRequirements,
  questions: initialQuestions,
  decisions: initialDecisions,
  images: initialImages,
}: {
  suit: {
    id: string;
    codename: string;
    designation: string;
    archetype: string;
    description: string | null;
    status: string;
    realityStatus: string;
    modelUrl: string | null;
    colorPrimary: string;
    colorSecondary: string;
    silhouette: Silhouette;
    materialLanguage: MaterialLanguage;
    patternStyle: PatternStyle;
    armorLevel: ArmorLevel;
    maskLensStyle: MaskLensStyle;
    currentVersionLabel: string;
    stats: SuitStats;
    versions: { id: string; label: string; note: string | null; createdAt: string; isCurrent: boolean; stats: SuitStats | null }[];
  };
  components: InspectionNode[];
  notes: { id: string; content: string; createdAt: string }[];
  requirements: RequirementDTO[];
  questions: QuestionDTO[];
  decisions: DecisionDTO[];
  images: SuitImageDTO[];
}) {
  const { mode } = useInfoMode();
  const [images, setImages] = useState(initialImages);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // Read-only now that the Engineering view's own layer toggle buttons have
  // moved into SuitOverviewPanel's View Modes (which manage their own local
  // state) — Cinematic still wants the full-layer render, unconditionally.
  const layers = useMemo(() => new Set<SuitLayer>(ALL_LAYERS), []);
  const [noteText, setNoteText] = useState("");
  const [localNotes, setLocalNotes] = useState(notes);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [requirements, setRequirements] = useState(initialRequirements);
  const [questions, setQuestions] = useState(initialQuestions);
  const [decisions, setDecisions] = useState(initialDecisions);

  // Live activity — real events from the event bus, filtered to whatever
  // actually relates to this suit (either the event's own subject is the
  // suit, or its payload carries this suit's id). Never a fabricated tick.
  const [liveActivity, setLiveActivity] = useState<LiveEvent[]>([]);
  const { status: liveStatus } = useEventStream({
    onEvent: (event) => {
      let payloadSuitId: string | undefined;
      try {
        payloadSuitId = event.payload ? (JSON.parse(event.payload) as { suitId?: string }).suitId : undefined;
      } catch {
        payloadSuitId = undefined;
      }
      if (event.subjectId === suit.id || payloadSuitId === suit.id) {
        setLiveActivity((prev) => [event, ...prev].slice(0, 20));
      }
    },
  });

  const selectedSubsystem = searchParams.get("subsystem");

  function selectSubsystem(next: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (next) params.set("subsystem", next);
    else params.delete("subsystem");
    router.replace(params.size > 0 ? `${pathname}?${params.toString()}` : pathname, { scroll: false });
  }

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
    if (data.action?.type === "view_suit") router.refresh();
  }

  async function addNote() {
    if (!noteText.trim()) return;
    const res = await fetch("/api/lab/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subjectType: "LabSuit", subjectId: suit.id, content: noteText }),
    });
    if (res.ok) {
      const data = await res.json();
      setLocalNotes((prev) => [{ id: data.note.id, content: data.note.content, createdAt: data.note.createdAt }, ...prev]);
      setNoteText("");
    }
  }

  async function duplicate() {
    const codename = prompt("New codename for the duplicate?", `${suit.codename} II`);
    if (!codename) return;
    setBusy(true);
    const res = await fetch(`/api/lab/suits/${suit.id}/duplicate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ newCodename: codename }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      router.push(`/lab/suits/${data.suit.id}`);
    }
  }

  async function toggleArchive() {
    setBusy(true);
    await fetch(`/api/lab/suits/${suit.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: suit.status === "ARCHIVED" ? "ACTIVE" : "ARCHIVED" }),
    });
    setBusy(false);
    router.refresh();
  }

  const keysToShow = mode === "CINEMATIC" ? CINEMATIC_KEYS : CORE_KEYS;
  const visibleRequirements = selectedSubsystem ? requirements.filter((r) => r.subsystem === selectedSubsystem) : requirements;
  const visibleQuestions = selectedSubsystem ? questions.filter((q) => q.subsystem === selectedSubsystem) : questions;
  const openQuestions = questions.filter((q) => !q.resolved);
  const verifiedCount = requirements.filter((r) => r.status === "VERIFIED").length;

  return (
    <div className="vox-panel-in flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="vox-headline text-2xl">{suit.codename}</h1>
            <LabStatusBadge status={suit.status} />
            <RealityStatusTag status={suit.realityStatus} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {suit.designation} · {suit.archetype} · current {suit.currentVersionLabel}
          </p>
          {suit.description ? <p className="mt-2 max-w-2xl text-sm text-muted">{suit.description}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={duplicate} disabled={busy} className="whitespace-nowrap">
            Duplicate
          </Button>
          <Button size="sm" variant="secondary" onClick={toggleArchive} disabled={busy} className="whitespace-nowrap">
            {suit.status === "ARCHIVED" ? "Unarchive" : "Archive"}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => askAi(`Create a lighter variant of ${suit.codename}, optimized for mobility.`)} disabled={aiBusy} className="whitespace-nowrap">
            Generate Lighter Variant
          </Button>
          <Button size="sm" onClick={() => askAi(`Analyze suit ${suit.codename} and list its strengths and weaknesses.`)} disabled={aiBusy} className="whitespace-nowrap">
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

      {/* Subsystem selector — shared context across Cinematic/Engineering,
          persisted in the URL (?subsystem=) so it survives a mode switch
          and is deep-linkable, per the mode-split requirement that
          selecting a subsystem in one mode carries into the other. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="vox-eyebrow mr-1">Subsystem</span>
        <button
          type="button"
          onClick={() => selectSubsystem(null)}
          className={cn(
            "lab-mono rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-wide transition-colors",
            !selectedSubsystem ? "border-[var(--border-strong)] bg-accent-muted text-accent" : "border-border text-muted-foreground hover:text-foreground"
          )}
        >
          All
        </button>
        {SUBSYSTEMS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => selectSubsystem(s)}
            className={cn(
              "lab-mono rounded-full border px-2.5 py-0.5 text-[10px] uppercase tracking-wide transition-colors",
              selectedSubsystem === s ? "border-[var(--border-strong)] bg-accent-muted text-accent" : "border-border text-muted-foreground hover:text-foreground"
            )}
          >
            {SUBSYSTEM_LABEL[s]}
          </button>
        ))}
      </div>

      {mode === "CINEMATIC" ? (
        <CinematicView
          suit={suit}
          layers={layers}
          keysToShow={keysToShow}
          liveActivity={liveActivity}
          liveStatus={liveStatus}
          openQuestions={openQuestions}
          requirementCount={requirements.length}
          verifiedCount={verifiedCount}
          decisionCount={decisions.length}
          images={images}
        />
      ) : (
        <EngineeringView
          suit={suit}
          mode={mode}
          components={components}
          requirements={visibleRequirements}
          questions={visibleQuestions}
          decisions={decisions}
          selectedSubsystem={selectedSubsystem}
          onRequirementCreated={(r) => setRequirements((prev) => [r, ...prev])}
          onRequirementUpdated={(r) => setRequirements((prev) => prev.map((x) => (x.id === r.id ? r : x)))}
          onQuestionCreated={(q) => setQuestions((prev) => [q, ...prev])}
          onQuestionUpdated={(q) => setQuestions((prev) => prev.map((x) => (x.id === q.id ? q : x)))}
          onDecisionCreated={(d) => setDecisions((prev) => [d, ...prev])}
          localNotes={localNotes}
          noteText={noteText}
          setNoteText={setNoteText}
          addNote={addNote}
          images={images}
          setImages={setImages}
        />
      )}
    </div>
  );
}

function CinematicView({
  suit,
  layers,
  keysToShow,
  liveActivity,
  liveStatus,
  openQuestions,
  requirementCount,
  verifiedCount,
  decisionCount,
  images,
}: {
  suit: Parameters<typeof SuitDetailClient>[0]["suit"];
  layers: Set<SuitLayer>;
  keysToShow: readonly string[];
  liveActivity: LiveEvent[];
  liveStatus: string;
  openQuestions: QuestionDTO[];
  requirementCount: number;
  verifiedCount: number;
  decisionCount: number;
  images: SuitImageDTO[];
}) {
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-4">
        {images.length > 0 ? (
          <SuitCinematicGallery images={images} codename={suit.codename} />
        ) : (
          <HolographicPanel corners scanline className="flex flex-col items-center p-6">
            <span className="lab-mono mb-3 self-start rounded-full border border-border px-2.5 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              Procedural preview — concept art not yet produced
            </span>
            <HolographicModel
              colorPrimary={suit.colorPrimary}
              colorSecondary={suit.colorSecondary}
              silhouette={suit.silhouette}
              materialLanguage={suit.materialLanguage}
              patternStyle={suit.patternStyle}
              armorLevel={suit.armorLevel}
              maskLensStyle={suit.maskLensStyle}
              modelUrl={suit.modelUrl}
              archetype={suit.archetype}
              visibleLayers={layers}
              size={420}
            />
          </HolographicPanel>
        )}
        <HolographicPanel className="flex flex-col gap-2 p-4">
          {keysToShow.map((k) => (
            <StatBar key={k} statKey={k} value={(suit.stats as unknown as Record<string, number>)[k]} />
          ))}
        </HolographicPanel>
      </div>

      <div className="flex flex-col gap-4">
        <HolographicPanel className="p-4">
          <div className="flex items-center justify-between">
            <LabSectionLabel>Project Status</LabSectionLabel>
            <span className={cn("h-1.5 w-1.5 rounded-full", liveStatus === "open" ? "bg-success" : "bg-muted-foreground")} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-muted-foreground">Requirements</p>
              <p className="lab-mono text-foreground">{verifiedCount} / {requirementCount} verified</p>
            </div>
            <div>
              <p className="text-muted-foreground">Open questions</p>
              <p className="lab-mono text-foreground">{openQuestions.length}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Decisions logged</p>
              <p className="lab-mono text-foreground">{decisionCount}</p>
            </div>
            <div>
              <p className="text-muted-foreground">Reality status</p>
              <RealityStatusTag status={suit.realityStatus} />
            </div>
          </div>
        </HolographicPanel>

        {openQuestions.length > 0 ? (
          <HolographicPanel className="p-4">
            <LabSectionLabel>Needs Attention</LabSectionLabel>
            <div className="mt-3 flex flex-col gap-2">
              {openQuestions.slice(0, 4).map((q) => (
                <div key={q.id} className="flex items-start justify-between gap-2 text-sm">
                  <p className="text-foreground">{q.question}</p>
                  <span className={cn("lab-mono shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase", PRIORITY_CLASS[q.importance] ?? PRIORITY_CLASS.MEDIUM)}>
                    {q.importance}
                  </span>
                </div>
              ))}
            </div>
          </HolographicPanel>
        ) : null}

        <HolographicPanel className="p-4">
          <div className="flex items-center justify-between">
            <LabSectionLabel>Live Activity</LabSectionLabel>
            <span className="lab-mono text-[10px] text-muted-foreground">{liveStatus === "open" ? "live" : liveStatus}</span>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {liveActivity.length === 0 ? (
              <p className="text-sm text-muted">Nothing has happened on this project yet this session.</p>
            ) : (
              liveActivity.slice(0, 8).map((e) => (
                <div key={e.id} className="flex items-center justify-between text-xs">
                  <span className="capitalize text-foreground">{humanizeEventType(e.type)}</span>
                  <span className="lab-mono text-muted-foreground">{new Date(e.createdAt).toLocaleTimeString()}</span>
                </div>
              ))
            )}
          </div>
        </HolographicPanel>
      </div>
    </div>
  );
}

function EngineeringView({
  suit,
  mode,
  components,
  requirements,
  questions,
  decisions,
  selectedSubsystem,
  onRequirementCreated,
  onRequirementUpdated,
  onQuestionCreated,
  onQuestionUpdated,
  onDecisionCreated,
  localNotes,
  noteText,
  setNoteText,
  addNote,
  images,
  setImages,
}: {
  suit: Parameters<typeof SuitDetailClient>[0]["suit"];
  mode: "ENGINEERING" | "EVERYTHING";
  components: InspectionNode[];
  requirements: RequirementDTO[];
  questions: QuestionDTO[];
  decisions: DecisionDTO[];
  selectedSubsystem: string | null;
  onRequirementCreated: (r: RequirementDTO) => void;
  onRequirementUpdated: (r: RequirementDTO) => void;
  onQuestionCreated: (q: QuestionDTO) => void;
  onQuestionUpdated: (q: QuestionDTO) => void;
  onDecisionCreated: (d: DecisionDTO) => void;
  localNotes: { id: string; content: string; createdAt: string }[];
  noteText: string;
  setNoteText: (v: string) => void;
  addNote: () => void;
  images: SuitImageDTO[];
  setImages: (images: SuitImageDTO[]) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <SuitOverviewPanel suit={suit} components={components} />

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        <div className="flex flex-col gap-4">
          <HolographicPanel className="p-4">
            <LabSectionLabel>Component Inspection</LabSectionLabel>
            <div className="mt-3">
              <HolographicInspectionTree nodes={components} />
            </div>
          </HolographicPanel>

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

          <ConceptImagesPanel suitId={suit.id} images={images} onImagesChange={setImages} />
        </div>

        <div className="flex flex-col gap-4">
          <RequirementsPanel suitId={suit.id} requirements={requirements} selectedSubsystem={selectedSubsystem} onCreated={onRequirementCreated} onUpdated={onRequirementUpdated} />
          <QuestionsPanel suitId={suit.id} questions={questions} selectedSubsystem={selectedSubsystem} onCreated={onQuestionCreated} onUpdated={onQuestionUpdated} />
          <DecisionsPanel suitId={suit.id} decisions={decisions} onCreated={onDecisionCreated} />

          {mode === "EVERYTHING" ? (
            <HolographicPanel className="p-4">
              <LabSectionLabel>Version History</LabSectionLabel>
              <div className="mt-3 space-y-2">
                {suit.versions.map((v) => (
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
        </div>
      </div>
    </div>
  );
}

function RequirementsPanel({
  suitId,
  requirements,
  selectedSubsystem,
  onCreated,
  onUpdated,
}: {
  suitId: string;
  requirements: RequirementDTO[];
  selectedSubsystem: string | null;
  onCreated: (r: RequirementDTO) => void;
  onUpdated: (r: RequirementDTO) => void;
}) {
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!title.trim()) return;
    setBusy(true);
    const res = await fetch("/api/lab/requirements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suitId, title, subsystem: selectedSubsystem ?? undefined }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      onCreated(data.requirement);
      setTitle("");
    }
  }

  async function advanceStatus(req: RequirementDTO) {
    const order = ["HYPOTHESIS", "MODELED", "TESTED", "VERIFIED"];
    const idx = order.indexOf(req.status);
    if (idx === order.length - 1) return;
    const next = order[idx + 1];
    const body: Record<string, unknown> = { status: next };
    if (next === "VERIFIED" && !req.evidence) {
      const evidence = prompt("What evidence verifies this requirement? (required to mark VERIFIED)");
      if (!evidence || !evidence.trim()) return;
      body.evidence = evidence;
    }
    const res = await fetch(`/api/lab/requirements/${req.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      onUpdated(data.requirement);
    } else {
      const err = await res.json().catch(() => ({}));
      alert(err.error ?? "Couldn't update the requirement.");
    }
  }

  return (
    <HolographicPanel className="p-4">
      <LabSectionLabel>Requirements</LabSectionLabel>
      <div className="mt-3 flex flex-col gap-2">
        {requirements.length === 0 ? (
          <p className="text-sm text-muted">No requirements recorded{selectedSubsystem ? ` for ${SUBSYSTEM_LABEL[selectedSubsystem]}` : ""} yet.</p>
        ) : (
          requirements.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-xs)] border border-border px-2.5 py-1.5 text-sm">
              <div className="min-w-0 flex-1">
                <span className="lab-mono mr-2 text-[10px] text-muted-foreground">{r.code}</span>
                <span className="text-foreground">{r.title}</span>
              </div>
              <button
                type="button"
                onClick={() => advanceStatus(r)}
                title={r.status === "VERIFIED" ? "Verified" : "Click to advance verification status"}
                className={cn("lab-mono shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase", REQ_STATUS_CLASS[r.status] ?? REQ_STATUS_CLASS.HYPOTHESIS)}
              >
                {r.status}
              </button>
            </div>
          ))
        )}
      </div>
      <div className="mt-3 flex gap-2 border-t border-border pt-3">
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`New requirement${selectedSubsystem ? ` (${SUBSYSTEM_LABEL[selectedSubsystem]})` : ""}…`} />
        <Button size="sm" onClick={create} disabled={busy}>
          Add
        </Button>
      </div>
    </HolographicPanel>
  );
}

function QuestionsPanel({
  suitId,
  questions,
  selectedSubsystem,
  onCreated,
  onUpdated,
}: {
  suitId: string;
  questions: QuestionDTO[];
  selectedSubsystem: string | null;
  onCreated: (q: QuestionDTO) => void;
  onUpdated: (q: QuestionDTO) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!text.trim()) return;
    setBusy(true);
    const res = await fetch("/api/lab/questions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suitId, question: text, subsystem: selectedSubsystem ?? undefined }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      onCreated(data.question);
      setText("");
    }
  }

  async function resolve(q: QuestionDTO) {
    const answer = prompt("What's the answer / resolution?");
    if (!answer || !answer.trim()) return;
    const res = await fetch(`/api/lab/questions/${q.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolved: true, answer }),
    });
    if (res.ok) {
      const data = await res.json();
      onUpdated(data.question);
    }
  }

  return (
    <HolographicPanel className="p-4">
      <LabSectionLabel>Engineering Questions</LabSectionLabel>
      <div className="mt-3 flex flex-col gap-2">
        {questions.length === 0 ? (
          <p className="text-sm text-muted">No open questions{selectedSubsystem ? ` for ${SUBSYSTEM_LABEL[selectedSubsystem]}` : ""}.</p>
        ) : (
          questions.map((q) => (
            <div key={q.id} className="flex items-start justify-between gap-2 rounded-[var(--radius-xs)] border border-border px-2.5 py-1.5 text-sm">
              <p className={cn("flex-1", q.resolved ? "text-muted line-through" : "text-foreground")}>{q.question}</p>
              {q.resolved ? (
                <span className="lab-mono shrink-0 rounded border border-success/40 bg-success/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-success">Resolved</span>
              ) : (
                <button type="button" onClick={() => resolve(q)} className="lab-mono shrink-0 text-[9px] text-accent hover:underline">
                  Resolve
                </button>
              )}
            </div>
          ))
        )}
      </div>
      <div className="mt-3 flex gap-2 border-t border-border pt-3">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="New engineering question…" />
        <Button size="sm" onClick={create} disabled={busy}>
          Add
        </Button>
      </div>
    </HolographicPanel>
  );
}

function DecisionsPanel({ suitId, decisions, onCreated }: { suitId: string; decisions: DecisionDTO[]; onCreated: (d: DecisionDTO) => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    if (!text.trim()) return;
    setBusy(true);
    const res = await fetch("/api/lab/decisions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suitId, decision: text }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      onCreated(data.decision);
      setText("");
    }
  }

  return (
    <HolographicPanel className="p-4">
      <LabSectionLabel>Decision Log</LabSectionLabel>
      <div className="mt-3 flex flex-col gap-2">
        {decisions.length === 0 ? (
          <p className="text-sm text-muted">No decisions recorded yet — this becomes permanent project memory once added.</p>
        ) : (
          decisions.map((d) => (
            <div key={d.id} className="rounded-[var(--radius-xs)] border border-border px-2.5 py-1.5 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-foreground">{d.decision}</span>
                <span className="lab-mono text-[10px] text-muted-foreground">{new Date(d.createdAt).toLocaleDateString()}</span>
              </div>
              {d.rationale ? <p className="mt-1 text-xs text-muted">{d.rationale}</p> : null}
            </div>
          ))
        )}
      </div>
      <div className="mt-3 flex gap-2 border-t border-border pt-3">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Record a new decision…" />
        <Button size="sm" onClick={create} disabled={busy}>
          Add
        </Button>
      </div>
    </HolographicPanel>
  );
}
