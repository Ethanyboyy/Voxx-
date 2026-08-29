import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The instrument vocabulary — the shared material every VOX surface is built
 * from, so the Dashboard, the Brain, the Lab, Research, Memory and the Graph
 * read as different rooms in one environment rather than as separate apps.
 *
 * The construction is deliberately physical: a translucent housing, a
 * hairline of light along the top edge, a shaded underside, and a shadow
 * whose spread matches how far the surface sits off the page. What makes it
 * feel like an instrument is the restraint — emission is reserved for live
 * signal (see `live`), so when something glows it means something is
 * actually happening.
 *
 * See the "Instrument layer" section of globals.css for the material itself.
 */

export type InstrumentDepth = "well" | "panel" | "raised" | "float";

const DEPTH_CLASS: Record<InstrumentDepth, string> = {
  // Things sit INSIDE a well — canvases, scroll regions, feeds.
  well: "instrument-well",
  // The resting surface for content. Most panels are this.
  panel: "instrument",
  // The primary readout. Once or twice per screen: if everything is raised,
  // nothing is.
  raised: "instrument-raised",
  // Overlays, inspectors, modals, command surfaces.
  float: "instrument-float",
};

export interface InstrumentPanelProps extends HTMLAttributes<HTMLDivElement> {
  depth?: InstrumentDepth;
  /** Adds the fixed specular sweep. Off for wells, which are lit from below. */
  sheen?: boolean;
  /** Corner registration ticks — an alignment mark, not a sci-fi frame. */
  registration?: boolean;
  /**
   * True only when this surface represents something CURRENTLY happening —
   * an executing run, a streaming value. This is the one thing allowed to
   * bloom, so it stays readable as signal rather than decoration.
   */
  live?: boolean;
}

export function InstrumentPanel({
  className,
  depth = "panel",
  sheen = true,
  registration = false,
  live = false,
  ...props
}: InstrumentPanelProps) {
  return (
    <div
      className={cn(
        DEPTH_CLASS[depth],
        sheen && depth !== "well" && "instrument-sheen",
        registration && "vox-registration",
        live && "vox-signal-active",
        className
      )}
      {...props}
    />
  );
}

export interface PanelHeaderProps {
  /** Small-caps section mark. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** One line explaining what this panel actually shows. */
  description?: ReactNode;
  /** Controls, filters, links — right-aligned. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The header band of an instrument. Consistent everywhere so a reader can
 * find the same information in the same place in every room: what this is,
 * what it shows, what they can do with it.
 */
export function PanelHeader({ eyebrow, title, description, actions, className }: PanelHeaderProps) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-5 pt-4", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="vox-eyebrow">{eyebrow}</p> : null}
        <h2 className="vox-headline mt-0.5 truncate text-sm sm:text-base">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-relaxed text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export interface ReadoutProps {
  label: ReactNode;
  value: ReactNode;
  /** Unit or axis, rendered quietly so the value keeps the hierarchy. */
  unit?: ReactNode;
  /** Shown under the value — e.g. what the number is measured against. */
  note?: ReactNode;
  /** Marks a value that is currently changing. */
  live?: boolean;
  className?: string;
}

/**
 * A single measured value. Tabular figures are not a detail — without them a
 * changing number reflows its own digits, which immediately reads as a web
 * page rather than an instrument.
 */
export function Readout({ label, value, unit, note, live = false, className }: ReadoutProps) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="vox-unit truncate">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span
          className={cn(
            "vox-readout text-xl leading-none font-semibold text-foreground sm:text-2xl",
            live && "text-accent-blue"
          )}
        >
          {value}
        </span>
        {unit ? <span className="vox-unit">{unit}</span> : null}
      </p>
      {note ? <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{note}</p> : null}
    </div>
  );
}

/**
 * A horizontal proportion bar. Takes a value and a max rather than a
 * pre-computed percentage so it cannot be handed a number that overstates
 * what the underlying data supports; it clamps and reports the real ratio.
 *
 * `unknown` renders a distinct empty track: a metric with no reported value
 * must not be drawn as zero, which would read as a measured result.
 */
export function Meter({
  value,
  max,
  label,
  tone = "accent",
  className,
}: {
  value: number | null;
  max: number;
  label?: ReactNode;
  tone?: "accent" | "steel" | "success" | "warning" | "danger";
  className?: string;
}) {
  const unknown = value == null || max <= 0;
  const ratio = unknown ? 0 : Math.max(0, Math.min(1, value / max));

  const toneClass = {
    accent: "bg-accent",
    steel: "bg-accent-steel",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
  }[tone];

  return (
    <div className={cn("min-w-0", className)}>
      {label ? (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="vox-unit truncate">{label}</span>
          <span className="vox-readout text-[11px] text-muted">
            {unknown ? "not reported" : `${Math.round(ratio * 100)}%`}
          </span>
        </div>
      ) : null}
      <div
        className="instrument-well h-1.5 w-full overflow-hidden rounded-full"
        role="img"
        aria-label={
          unknown
            ? `${typeof label === "string" ? label : "value"}: not reported`
            : `${typeof label === "string" ? label : "value"}: ${Math.round(ratio * 100)} percent`
        }
      >
        {unknown ? null : (
          <div
            className={cn("h-full rounded-full transition-[width] duration-500", toneClass)}
            style={{ width: `${ratio * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * The atmospheric backdrop. One horizon shared by every room — this is most
 * of what makes the app feel like a single environment rather than a set of
 * screens. Absolutely positioned and inert; the caller supplies a
 * `relative` container.
 */
export function Atmosphere({ grid = true, className }: { grid?: boolean; className?: string }) {
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden="true">
      <div className="vox-atmosphere" />
      {grid ? <div className="vox-measure-grid" /> : null}
    </div>
  );
}

export interface RoomHeaderProps {
  /** Which system of VOX this room belongs to — Intelligence, Knowledge, Laboratory. */
  system: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/**
 * The entrance to a room. Every major screen opens with this, so moving
 * between the Dashboard, the Brain, the Lab and Memory feels like walking
 * between rooms in one building rather than switching between products.
 *
 * The lit rule under the system name is doing deliberate work: it is the
 * same machined seam used inside instruments, which ties the page furniture
 * to the panel material instead of leaving the header floating in its own
 * visual language.
 */
export function RoomHeader({ system, title, description, actions, children, className }: RoomHeaderProps) {
  return (
    <header className={cn("relative", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="vox-eyebrow">{system}</p>
          <h1 className="vox-headline mt-1.5 text-2xl sm:text-3xl">{title}</h1>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
      <Seam className="mt-3.5" />
      {description ? (
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{description}</p>
      ) : null}
      {children}
    </header>
  );
}

/** Machined seam between bands inside an instrument. */
export function Seam({ className }: { className?: string }) {
  return <hr className={cn("vox-seam", className)} />;
}
