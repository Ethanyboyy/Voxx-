"use client";

import { useEffect, useMemo, useRef } from "react";

interface Point3D {
  x: number;
  y: number;
  z: number;
}
interface ClusterCenter extends Point3D {
  radius: number;
}
interface AmbientPoint extends Point3D {
  r: number;
  kind: "ambient" | "mist";
  tw: number;
}
export interface HoloTaskPoint {
  id: string;
  colorVar: string; // e.g. "--core-error" — resolved from the live theme, never hardcoded
  size: "sm" | "md" | "lg";
  pulse: boolean;
  dim: boolean;
  selected: boolean;
}
interface TaskRenderPoint extends Point3D {
  id: string;
  colorVar: string;
  baseRadius: number;
  pulse: boolean;
  dim: boolean;
  selected: boolean;
  tw: number;
}

function mulberry32(seed: number) {
  let s = seed;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromString(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function fibonacciSphere(n: number): Point3D[] {
  const pts: Point3D[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const radiusAtY = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = ga * i;
    pts.push({ x: Math.cos(theta) * radiusAtY, y, z: Math.sin(theta) * radiusAtY });
  }
  return pts;
}

function buildClusterCenters(rng: () => number, side: -1 | 1): ClusterCenter[] {
  const sphere = fibonacciSphere(26);
  return sphere.map((p) => {
    const bottomTaper = p.y > 0.4 ? 1 - (p.y - 0.4) * 0.55 : 1;
    return {
      x: side * 36 + p.x * 58 * bottomTaper,
      y: p.y * 56 - 4,
      z: p.z * 48 * bottomTaper,
      radius: 27 + rng() * 14,
    };
  });
}

function sampleAround(center: Point3D & { radius: number }, rng: () => number): Point3D {
  const g = () => (rng() + rng() + rng() - 1.5) / 1.5;
  return {
    x: center.x + g() * center.radius,
    y: center.y + g() * center.radius * 0.85,
    z: center.z + g() * center.radius * 0.8,
  };
}

const SIZE_RADIUS: Record<HoloTaskPoint["size"], number> = { sm: 3.2, md: 4.2, lg: 5.4 };

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return [200, 140, 255];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/**
 * A rotatable 3D point-cloud brain rendered on canvas — purple/magenta
 * "hologram" particles densely filling a lumpy twin-hemisphere silhouette
 * (built from Fibonacci-sphere cluster centers, not a flat outline).
 * Drag to rotate with momentum; it auto-rotates slowly when idle. Task
 * neurons are brighter, larger, clickable points among decorative ambient
 * particles that carry no data of their own.
 */
export function HoloBrain({
  taskPoints,
  onSelectTask,
}: {
  taskPoints: HoloTaskPoint[];
  onSelectTask: (id: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSelectTaskRef = useRef(onSelectTask);
  useEffect(() => {
    onSelectTaskRef.current = onSelectTask;
  }, [onSelectTask]);

  const clusters = useMemo(() => {
    const rng = mulberry32(42);
    return [...buildClusterCenters(rng, -1), ...buildClusterCenters(rng, 1)];
  }, []);

  const decorativePoints = useMemo(() => {
    const rng = mulberry32(1337);
    const points: AmbientPoint[] = [];
    for (let i = 0; i < 2600; i++) {
      const center = clusters[Math.floor(rng() * clusters.length)]!;
      const p = sampleAround(center, rng);
      points.push({ ...p, r: 0.9 + rng() * 1.5, kind: "ambient", tw: rng() * Math.PI * 2 });
    }
    for (let i = 0; i < 900; i++) {
      const center = clusters[Math.floor(rng() * clusters.length)]!;
      const p = sampleAround(center, rng);
      points.push({ x: p.x * 1.05, y: p.y * 1.05, z: p.z * 1.05, r: 0.5 + rng() * 0.6, kind: "mist", tw: rng() * Math.PI * 2 });
    }
    return points;
  }, [clusters]);

  // Real task neurons — each pinned to a deterministic spot from its own id
  // (stable across re-renders) rather than reshuffling every render.
  const taskRenderPoints = useMemo<TaskRenderPoint[]>(() => {
    return taskPoints.map((t) => {
      const rng = mulberry32(seedFromString(t.id));
      const center = clusters[Math.floor(rng() * clusters.length)]!;
      const p = sampleAround(center, rng);
      return {
        ...p,
        id: t.id,
        colorVar: t.colorVar,
        baseRadius: SIZE_RADIUS[t.size],
        pulse: t.pulse,
        dim: t.dim,
        selected: t.selected,
        tw: rng() * Math.PI * 2,
      };
    });
  }, [taskPoints, clusters]);

  const taskRenderPointsRef = useRef(taskRenderPoints);
  useEffect(() => {
    taskRenderPointsRef.current = taskRenderPoints;
  }, [taskRenderPoints]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    // Closures below (frame/resize/pointer handlers) don't inherit the
    // narrowing from the null-check above — TS control-flow analysis
    // doesn't cross function boundaries — so re-bind to a variable whose
    // *declared* type is already non-null instead of a narrowed one.
    const ctx: CanvasRenderingContext2D = ctx2d;

    let width = 0;
    let height = 0;
    let dpr = Math.min(2, window.devicePixelRatio || 1);

    function resize() {
      if (!container || !canvas) return;
      width = container.clientWidth;
      height = container.clientHeight;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    // Live theme colors — read from CSS custom properties so canvas
    // rendering matches whatever palette (obsidian/light) is active,
    // re-read whenever the theme attribute flips.
    let palette: Record<string, [number, number, number]> = {};
    function readPalette() {
      const style = getComputedStyle(document.documentElement);
      const read = (name: string) => hexToRgb(style.getPropertyValue(name).trim() || "#a855f7");
      palette = {
        "--core-error": read("--core-error"),
        "--core-executing": read("--core-executing"),
        "--core-listening": read("--core-listening"),
        "--core-success": read("--core-success"),
        "--core-thinking": read("--core-thinking"),
      };
    }
    readPalette();
    const themeObserver = new MutationObserver(readPalette);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    let rotY = 0.35;
    let rotX = -0.12;
    let velY = 0;
    let velX = 0;
    let dragging = false;
    let lastPX = 0;
    let lastPY = 0;
    let idleSince = 0;
    let raf = 0;
    let t = 0;

    type Projected = { sx: number; sy: number; scale: number; z: number };
    function project(p: Point3D, cx: number, cy: number, zoom: number): Projected {
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const x1 = p.x * cosY + p.z * sinY;
      const z1 = -p.x * sinY + p.z * cosY;
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);
      const y2 = p.y * cosX - z1 * sinX;
      const z2 = p.y * sinX + z1 * cosX;
      const perspective = 480;
      const scale = perspective / (perspective + z2 + 260);
      return { sx: cx + x1 * scale * zoom, sy: cy + y2 * scale * zoom, scale, z: z2 };
    }

    const hitTargets: { id: string; sx: number; sy: number; r: number }[] = [];

    function frame() {
      t += 1;
      const now = performance.now();
      if (!dragging) {
        if (Math.abs(velY) > 0.0001 || Math.abs(velX) > 0.0001) {
          rotY += velY;
          rotX = Math.max(-1.1, Math.min(1.1, rotX + velX));
          velY *= 0.94;
          velX *= 0.94;
        } else if (now - idleSince > 1600) {
          rotY += 0.0026;
        }
      }

      const cx = width / 2;
      const cy = height / 2 + height * 0.06;
      const zoom = (Math.min(width, height) / 340) * 2.15;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, width, height);

      // holographic base platform
      const platformY = cy + Math.min(height * 0.32, 118);
      ctx.save();
      const gradBase = ctx.createRadialGradient(cx, platformY, 10, cx, platformY, 190);
      gradBase.addColorStop(0, "rgba(168,85,247,0.32)");
      gradBase.addColorStop(1, "rgba(168,85,247,0)");
      ctx.fillStyle = gradBase;
      ctx.beginPath();
      ctx.ellipse(cx, platformY, 190, 34, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(196,150,255,0.35)";
      ctx.lineWidth = 1;
      for (let ring = 1; ring <= 3; ring++) {
        ctx.beginPath();
        ctx.ellipse(cx, platformY, 52 * ring, 9.5 * ring, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      const decoProjected = decorativePoints.map((p) => ({ p, ...project(p, cx, cy, zoom) }));
      const taskProjected = taskRenderPointsRef.current.map((p) => ({ p, ...project(p, cx, cy, zoom) }));
      const all: { kind: "deco" | "task"; deco?: AmbientPoint; task?: TaskRenderPoint; sx: number; sy: number; scale: number; z: number }[] =
        [
          ...decoProjected.map((d) => ({ kind: "deco" as const, deco: d.p, sx: d.sx, sy: d.sy, scale: d.scale, z: d.z })),
          ...taskProjected.map((d) => ({ kind: "task" as const, task: d.p, sx: d.sx, sy: d.sy, scale: d.scale, z: d.z })),
        ];
      all.sort((a, b) => a.z - b.z);

      hitTargets.length = 0;
      ctx.globalCompositeOperation = "lighter";
      for (const item of all) {
        const fog = Math.max(0.12, Math.min(1, item.scale * 1.05));
        if (item.kind === "deco") {
          const p = item.deco!;
          if (p.kind === "mist") {
            const glow = 0.3 + 0.2 * Math.sin(t * 0.015 + p.tw);
            ctx.fillStyle = `rgba(196,90,255,${0.18 * fog * glow})`;
            ctx.beginPath();
            ctx.arc(item.sx, item.sy, p.r * item.scale * 1.3, 0, Math.PI * 2);
            ctx.fill();
          } else {
            const glow = 0.35 + 0.15 * Math.sin(t * 0.02 + p.tw);
            ctx.fillStyle = `rgba(210,70,255,${0.34 * fog * glow})`;
            ctx.beginPath();
            ctx.arc(item.sx, item.sy, p.r * item.scale * 1.7, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = `rgba(235,170,255,${0.7 * fog})`;
            ctx.beginPath();
            ctx.arc(item.sx, item.sy, p.r * item.scale * 0.75, 0, Math.PI * 2);
            ctx.fill();
          }
        } else {
          const p = item.task!;
          const [r, g, b] = palette[p.colorVar] ?? [200, 140, 255];
          const pulse = p.pulse ? 0.65 + 0.35 * Math.sin(t * 0.05 + p.tw) : 1;
          const dimMul = p.dim ? 0.45 : 1;
          const selMul = p.selected ? 1.6 : 1;
          const r2 = p.baseRadius * selMul;
          ctx.fillStyle = `rgba(${r},${g},${b},${0.22 * fog * dimMul})`;
          ctx.beginPath();
          ctx.arc(item.sx, item.sy, r2 * item.scale * 4.4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(${r},${g},${b},${0.9 * fog * pulse * dimMul})`;
          ctx.beginPath();
          ctx.arc(item.sx, item.sy, r2 * item.scale * 1.15, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = `rgba(255,255,255,${0.85 * fog * dimMul})`;
          ctx.beginPath();
          ctx.arc(item.sx, item.sy, r2 * item.scale * 0.4, 0, Math.PI * 2);
          ctx.fill();
          if (p.selected) {
            ctx.strokeStyle = `rgba(${r},${g},${b},${0.6 * fog})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(item.sx, item.sy, r2 * item.scale * 2.6, 0, Math.PI * 2);
            ctx.stroke();
          }
          hitTargets.push({ id: p.id, sx: item.sx, sy: item.sy, r: Math.max(10, r2 * item.scale * 2.4) });
        }
      }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    let downX = 0;
    let downY = 0;
    let moved = false;
    function onPointerDown(e: PointerEvent) {
      dragging = true;
      moved = false;
      velY = 0;
      velX = 0;
      lastPX = e.clientX;
      lastPY = e.clientY;
      downX = e.clientX;
      downY = e.clientY;
      try {
        canvas!.setPointerCapture(e.pointerId);
      } catch {
        // no active pointer session for this id (synthetic events, some
        // touch edge cases) — dragging still works via the window-level
        // listeners below, capture is just a nicety when it's available
      }
    }
    function onPointerMove(e: PointerEvent) {
      if (!dragging) return;
      const dx = e.clientX - lastPX;
      const dy = e.clientY - lastPY;
      lastPX = e.clientX;
      lastPY = e.clientY;
      if (Math.abs(e.clientX - downX) > 3 || Math.abs(e.clientY - downY) > 3) moved = true;
      rotY += dx * 0.008;
      rotX = Math.max(-1.1, Math.min(1.1, rotX - dy * 0.008));
      velY = dx * 0.008;
      velX = -dy * 0.008;
    }
    function onPointerUp(e: PointerEvent) {
      dragging = false;
      idleSince = performance.now();
      if (!moved) {
        const rect = canvas!.getBoundingClientRect();
        const cx0 = e.clientX - rect.left;
        const cy0 = e.clientY - rect.top;
        let best: { id: string; dist: number } | null = null;
        for (const target of hitTargets) {
          const d = Math.hypot(target.sx - cx0, target.sy - cy0);
          if (d <= target.r && (!best || d < best.dist)) best = { id: target.id, dist: d };
        }
        if (best) onSelectTaskRef.current(best.id);
      }
    }

    // pointerdown starts on the canvas; move/up listen on window so a fast
    // drag that leaves the canvas bounds (or an environment where pointer
    // capture silently fails) doesn't get stuck mid-drag.
    canvas.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
    };
  }, [decorativePoints]);

  return (
    <div ref={containerRef} className="relative h-full w-full touch-none">
      <canvas ref={canvasRef} className="cursor-grab active:cursor-grabbing" />
    </div>
  );
}
