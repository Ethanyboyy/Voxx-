"use client";

import { useState } from "react";
import Image from "next/image";
import { HolographicPanel, LabSectionLabel } from "@/components/lab/primitives";
import { cn } from "@/lib/utils/cn";

export interface SuitImageDTO {
  id: string;
  kind: "CONCEPT" | "FRONT" | "REAR" | "SIDE" | "DETAIL";
  url: string;
  label: string | null;
}

const KIND_LABEL: Record<SuitImageDTO["kind"], string> = {
  CONCEPT: "Concept",
  FRONT: "Front",
  REAR: "Rear",
  SIDE: "Side",
  DETAIL: "Detail",
};

const HERO_PRIORITY: SuitImageDTO["kind"][] = ["CONCEPT", "FRONT", "SIDE", "REAR", "DETAIL"];

/**
 * The cinematic hero presentation for a suit's real concept artwork. VOX
 * never generates this artwork — every image here is a URL a human (or a
 * future dedicated image-generation workflow) supplied after producing and
 * approving it. When none exist yet, this renders an honest "not yet
 * produced" state rather than silently falling back to something that
 * could be mistaken for finished art.
 */
export function SuitCinematicGallery({ images, codename }: { images: SuitImageDTO[]; codename: string }) {
  const ordered = [...images].sort((a, b) => HERO_PRIORITY.indexOf(a.kind) - HERO_PRIORITY.indexOf(b.kind));
  const [activeId, setActiveId] = useState<string | null>(ordered[0]?.id ?? null);
  const active = ordered.find((i) => i.id === activeId) ?? ordered[0] ?? null;

  if (!active) {
    return (
      <HolographicPanel corners className="flex min-h-[420px] flex-col items-center justify-center gap-3 p-8 text-center">
        <span className="lab-mono rounded-full border border-warning/40 bg-warning/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-warning">
          Concept art pending
        </span>
        <p className="max-w-sm text-sm text-muted">
          No production concept art exists yet for {codename}. VOX does not generate suit artwork itself — real
          imagery is produced through a dedicated workflow and attached here once approved.
        </p>
      </HolographicPanel>
    );
  }

  return (
    <HolographicPanel corners className="overflow-hidden p-0">
      <div className="relative aspect-[4/5] w-full bg-background-2 sm:aspect-[16/10]">
        {/* Real, externally-sourced artwork — width/height are illustrative
            bounds for Next/Image's optimizer; the element itself fills the
            frame via `fill` + object-cover. */}
        <Image src={active.url} alt={active.label ?? `${codename} — ${KIND_LABEL[active.kind]}`} fill sizes="(max-width: 640px) 100vw, 70vw" className="object-cover" unoptimized />
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4">
          <p className="lab-mono text-[10px] uppercase tracking-wider text-white/70">{KIND_LABEL[active.kind]}</p>
          {active.label ? <p className="mt-0.5 text-sm text-white">{active.label}</p> : null}
        </div>
      </div>

      {ordered.length > 1 ? (
        <div className="flex gap-2 overflow-x-auto border-t border-border p-3">
          {ordered.map((img) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActiveId(img.id)}
              className={cn(
                "relative h-14 w-14 shrink-0 overflow-hidden rounded-[var(--radius-xs)] border transition-colors",
                img.id === active.id ? "border-accent" : "border-border hover:border-border-strong"
              )}
            >
              <Image src={img.url} alt={KIND_LABEL[img.kind]} fill sizes="56px" className="object-cover" unoptimized />
            </button>
          ))}
        </div>
      ) : null}
    </HolographicPanel>
  );
}

export function ConceptImagesPanel({
  suitId,
  images,
  onImagesChange,
}: {
  suitId: string;
  images: SuitImageDTO[];
  onImagesChange: (images: SuitImageDTO[]) => void;
}) {
  const [url, setUrl] = useState("");
  const [kind, setKind] = useState<SuitImageDTO["kind"]>("CONCEPT");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function addImage() {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/lab/suits/${suitId}/images`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), kind, label: label.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Could not attach that image.");
        return;
      }
      onImagesChange([...images, data.image]);
      setUrl("");
      setLabel("");
    } finally {
      setBusy(false);
    }
  }

  async function removeImage(id: string) {
    onImagesChange(images.filter((i) => i.id !== id));
    await fetch(`/api/lab/suits/${suitId}/images/${id}`, { method: "DELETE" });
  }

  return (
    <HolographicPanel className="p-4">
      <LabSectionLabel>Concept images</LabSectionLabel>
      <p className="mt-1 text-xs text-muted">
        Attach a URL to real, produced/approved concept art — VOX never generates this itself.
      </p>

      {images.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1.5">
          {images.map((img) => (
            <div key={img.id} className="flex items-center justify-between gap-2 rounded-[var(--radius-xs)] border border-border px-2.5 py-1.5 text-xs">
              <span className="lab-mono text-muted-foreground">{KIND_LABEL[img.kind]}</span>
              <span className="min-w-0 flex-1 truncate text-foreground">{img.label ?? img.url}</span>
              <button type="button" onClick={() => removeImage(img.id)} className="shrink-0 text-danger hover:underline">
                Remove
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
        <div className="flex gap-2">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as SuitImageDTO["kind"])}
            className="rounded-[var(--radius-xs)] border border-border bg-surface px-2 text-xs text-foreground"
          >
            {(Object.keys(KIND_LABEL) as SuitImageDTO["kind"][]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="min-w-0 flex-1 rounded-[var(--radius-xs)] border border-border bg-surface px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div className="flex gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Caption (optional)"
            className="min-w-0 flex-1 rounded-[var(--radius-xs)] border border-border bg-surface px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground"
          />
          <button
            type="button"
            onClick={addImage}
            disabled={busy || !url.trim()}
            className="lab-mono shrink-0 rounded-[var(--radius-xs)] border border-[var(--border-strong)] bg-accent-muted px-3 text-xs font-semibold uppercase tracking-wide text-accent disabled:opacity-50"
          >
            Attach
          </button>
        </div>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </div>
    </HolographicPanel>
  );
}
