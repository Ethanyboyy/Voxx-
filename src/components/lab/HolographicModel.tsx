"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";

// A real interactive 3D viewer built from plain CSS 3D transforms (no
// three.js dependency) — six-face boxes composed into a humanoid rig,
// rotatable via pointer drag and zoomable via wheel/buttons. This is
// deliberately the "deterministic initial 3D model" the build spec calls
// for (section 42): the component's props (color, visibleLayers) are the
// stable boundary a future GLTF/three.js-based viewer would slot behind
// without any caller needing to change. See the build report for the
// documented tradeoff.

export type SuitLayer =
  | "outer"
  | "structural"
  | "thermal"
  | "electronics"
  | "sensors"
  | "mask"
  | "gloves"
  | "boots";

interface Box3DProps {
  w: number;
  h: number;
  d: number;
  color: string;
  glow?: boolean;
  style?: React.CSSProperties;
  className?: string;
}

function Box3D({ w, h, d, color, glow, style, className }: Box3DProps) {
  const faceBase: React.CSSProperties = {
    position: "absolute",
    background: color,
    border: "1px solid rgba(255,255,255,0.08)",
  };
  return (
    <div
      className={cn("absolute", className)}
      style={{
        width: w,
        height: h,
        transformStyle: "preserve-3d",
        boxShadow: glow ? `0 0 18px -2px ${color}` : undefined,
        ...style,
      }}
    >
      <div style={{ ...faceBase, width: w, height: h, transform: `translateZ(${d / 2}px)` }} />
      <div style={{ ...faceBase, width: w, height: h, transform: `translateZ(${-d / 2}px) rotateY(180deg)`, filter: "brightness(0.6)" }} />
      <div style={{ ...faceBase, width: d, height: h, transform: `rotateY(90deg) translateZ(${w / 2}px)`, filter: "brightness(0.75)" }} />
      <div style={{ ...faceBase, width: d, height: h, transform: `rotateY(-90deg) translateZ(${w / 2}px)`, filter: "brightness(0.75)" }} />
      <div style={{ ...faceBase, width: w, height: d, transform: `rotateX(90deg) translateZ(${h / 2}px)`, filter: "brightness(0.5)" }} />
      <div style={{ ...faceBase, width: w, height: d, transform: `rotateX(-90deg) translateZ(${h / 2}px)`, filter: "brightness(0.9)" }} />
    </div>
  );
}

export interface HolographicModelProps {
  colorPrimary: string;
  colorSecondary: string;
  visibleLayers?: Set<SuitLayer>;
  className?: string;
  size?: number;
}

const ALL_LAYERS: SuitLayer[] = ["outer", "structural", "thermal", "electronics", "sensors", "mask", "gloves", "boots"];

export function HolographicModel({
  colorPrimary,
  colorSecondary,
  visibleLayers = new Set(ALL_LAYERS),
  className,
  size = 340,
}: HolographicModelProps) {
  const [rx, setRx] = useState(-12);
  const [ry, setRy] = useState(28);
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const dragging = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragging.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
    (e.target as Element).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - dragging.current.x;
    const dy = e.clientY - dragging.current.y;
    dragging.current = { x: e.clientX, y: e.clientY };
    setRy((v) => v + dx * 0.5);
    setRx((v) => Math.max(-80, Math.min(80, v - dy * 0.5)));
  }, []);

  const onPointerUp = useCallback(() => {
    dragging.current = null;
    setIsDragging(false);
  }, []);

  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((v) => Math.max(0.5, Math.min(2.2, v - e.deltaY * 0.001)));
  }, []);

  const reset = () => {
    setRx(-12);
    setRy(28);
    setZoom(1);
  };

  const show = (l: SuitLayer) => visibleLayers.has(l);
  const outer = show("outer") ? colorPrimary : "rgba(255,255,255,0.05)";
  const accent = colorSecondary;

  return (
    <div className={cn("relative flex flex-col items-center", className)}>
      <div
        role="img"
        aria-label="Interactive holographic suit model — drag to rotate, scroll to zoom"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
        className="lab-hologram cursor-grab touch-none select-none active:cursor-grabbing"
        style={{ width: size, height: size, perspective: 900 }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            position: "relative",
            transformStyle: "preserve-3d",
            transform: `translateZ(-40px) rotateX(${rx}deg) rotateY(${ry}deg) scale(${zoom})`,
            transition: isDragging ? "none" : "transform 0.15s ease-out",
          }}
        >
          <div style={{ position: "absolute", left: "50%", top: "50%", transformStyle: "preserve-3d" }}>
            {/* Head */}
            {show("mask") && (
              <Box3D w={38} h={40} d={36} color={outer} glow style={{ transform: "translate3d(-19px,-150px,-18px)" }} />
            )}
            {show("sensors") && (
              <Box3D
                w={26}
                h={10}
                d={4}
                color={accent}
                glow
                style={{ transform: "translate3d(-13px,-140px,0px)" }}
              />
            )}
            {/* Torso */}
            <Box3D w={70} h={90} d={34} color={outer} glow style={{ transform: "translate3d(-35px,-108px,-17px)" }} />
            {show("electronics") && (
              <Box3D w={10} h={70} d={2} color={accent} glow style={{ transform: "translate3d(-5px,-98px,18px)" }} />
            )}
            {/* Arms */}
            <Box3D w={16} h={54} d={16} color={outer} style={{ transform: `translate3d(-52px,-104px,-8px) rotateZ(6deg)` }} />
            <Box3D w={16} h={54} d={16} color={outer} style={{ transform: `translate3d(36px,-104px,-8px) rotateZ(-6deg)` }} />
            {show("gloves") && (
              <>
                <Box3D w={16} h={20} d={16} color={accent} style={{ transform: "translate3d(-52px,-52px,-8px)" }} />
                <Box3D w={16} h={20} d={16} color={accent} style={{ transform: "translate3d(36px,-52px,-8px)" }} />
              </>
            )}
            {/* Legs */}
            <Box3D w={22} h={80} d={22} color={outer} style={{ transform: "translate3d(-26px,-16px,-11px)" }} />
            <Box3D w={22} h={80} d={22} color={outer} style={{ transform: "translate3d(4px,-16px,-11px)" }} />
            {show("boots") && (
              <>
                <Box3D w={22} h={18} d={26} color={accent} style={{ transform: "translate3d(-26px,62px,-13px)" }} />
                <Box3D w={22} h={18} d={26} color={accent} style={{ transform: "translate3d(4px,62px,-13px)" }} />
              </>
            )}
            {show("structural") && (
              <Box3D w={72} h={6} d={36} color={accent} style={{ transform: "translate3d(-36px,-64px,-18px)", opacity: 0.6 }} />
            )}
            {show("thermal") && (
              <Box3D w={72} h={6} d={36} color="#fbbf24" style={{ transform: "translate3d(-36px,-40px,-18px)", opacity: 0.35 }} />
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => setRy((v) => v - 30)}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-hover hover:text-foreground"
        >
          ⟲ Rotate
        </button>
        <button
          type="button"
          onClick={() => setZoom((v) => Math.min(2.2, v + 0.15))}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-hover hover:text-foreground"
        >
          + Zoom
        </button>
        <button
          type="button"
          onClick={() => setZoom((v) => Math.max(0.5, v - 0.15))}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-hover hover:text-foreground"
        >
          − Zoom
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-md border border-border px-2.5 py-1 text-xs text-muted hover:bg-surface-hover hover:text-foreground"
        >
          Reset View
        </button>
      </div>
    </div>
  );
}
