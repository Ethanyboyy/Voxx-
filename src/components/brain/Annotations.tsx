"use client";

import { polar, spreadAngleFull, type Point } from "@/components/brain/layout";

export interface AnnotationItem {
  id: string;
  label: string;
  value: string;
}

/**
 * "Pulling apart" a focused entity — small floating labels orbiting it,
 * connected by thin dashed lines, rather than another card. These are not
 * selectable nodes (see the Brain's "don't make everything a node" rule):
 * purely a transient visual layer over real fields already on the entity,
 * or over a real, on-demand memory-retrieval result. Nothing here is
 * persisted or fabricated.
 */
export function OrbitAnnotations({
  center,
  items,
  radius = 165,
  colorVar,
}: {
  center: Point;
  items: AnnotationItem[];
  radius?: number;
  colorVar: string;
}) {
  if (items.length === 0) return null;
  return (
    <>
      {items.map((item, i) => {
        const angle = spreadAngleFull(i, items.length);
        const pos = polar(center.x, center.y, radius, angle);
        return (
          <div
            key={item.id}
            className="pointer-events-none absolute z-20 max-w-[150px] rounded-[var(--radius-sm)] border px-2 py-1 shadow-[var(--shadow-ambient-xs)] backdrop-blur-sm transition-[left,top] duration-300 ease-[var(--ease-luxury)]"
            style={{
              left: pos.x,
              top: pos.y,
              transform: "translate(-50%, -50%)",
              borderColor: colorVar,
              background: "color-mix(in srgb, var(--surface-solid) 75%, transparent)",
            }}
          >
            <p className="vox-eyebrow truncate text-[9px]" style={{ color: colorVar }}>
              {item.label}
            </p>
            <p className="truncate text-[11px] text-foreground">{item.value}</p>
          </div>
        );
      })}
    </>
  );
}

/** Thin dashed connector lines from a center point out to each annotation position — rendered inside the shared world-space SVG. */
export function annotationConnectors(center: Point, items: AnnotationItem[], radius: number, colorVar: string) {
  return items.map((item, i) => {
    const angle = spreadAngleFull(i, items.length);
    const pos = polar(center.x, center.y, radius, angle);
    return (
      <line
        key={`ann-${item.id}`}
        x1={center.x}
        y1={center.y}
        x2={pos.x}
        y2={pos.y}
        stroke={colorVar}
        strokeWidth={1}
        strokeDasharray="3 3"
        opacity={0.45}
      />
    );
  });
}
