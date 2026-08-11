import { cn } from "@/lib/utils/cn";

export type VoxCoreState =
  | "idle"
  | "listening"
  | "thinking"
  | "responding"
  | "executing"
  | "waiting"
  | "success"
  | "error";

const STATE_COLOR: Record<VoxCoreState, string> = {
  idle: "var(--core-idle)",
  listening: "var(--core-listening)",
  thinking: "var(--core-thinking)",
  responding: "var(--core-responding)",
  executing: "var(--core-executing)",
  waiting: "var(--core-waiting)",
  success: "var(--core-success)",
  error: "var(--core-error)",
};

const STATE_LABEL: Record<VoxCoreState, string> = {
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  responding: "Responding",
  executing: "Executing",
  waiting: "Waiting for you",
  success: "Done",
  error: "Something went wrong",
};

interface StateTiming {
  ring: string;
  ring2: string;
  core: string;
  particleDuration: number;
  particleCount: number;
  energy: number; // 0-1, drives glow strength + particle opacity
  showPulse: boolean;
}

/** Rotation/pulse rhythm per state — the same layered elements are reused throughout; only duration/direction/energy change, so this stays cheap. */
const STATE_TIMING: Record<VoxCoreState, StateTiming> = {
  idle: {
    ring: "vox-core-spin 18s linear infinite",
    ring2: "vox-core-spin-reverse 24s linear infinite",
    core: "vox-core-breathe 4.5s ease-in-out infinite",
    particleDuration: 14,
    particleCount: 2,
    energy: 0.3,
    showPulse: false,
  },
  listening: {
    ring: "vox-core-spin 3.5s linear infinite",
    ring2: "vox-core-spin-reverse 5s linear infinite",
    core: "vox-core-pulse-fast 1.3s ease-in-out infinite",
    particleDuration: 4,
    particleCount: 4,
    energy: 0.8,
    showPulse: true,
  },
  thinking: {
    ring: "vox-core-spin-reverse 2.4s linear infinite",
    ring2: "vox-core-spin 1.6s linear infinite",
    core: "vox-core-breathe 1.6s ease-in-out infinite",
    particleDuration: 2.4,
    particleCount: 5,
    energy: 0.9,
    showPulse: false,
  },
  responding: {
    ring: "vox-core-spin 4.5s linear infinite",
    ring2: "vox-core-spin-reverse 3.2s linear infinite",
    core: "vox-core-pulse-fast 1.8s ease-in-out infinite",
    particleDuration: 3.2,
    particleCount: 4,
    energy: 0.85,
    showPulse: true,
  },
  executing: {
    ring: "vox-core-spin 1.3s linear infinite",
    ring2: "vox-core-spin-reverse 0.9s linear infinite",
    core: "vox-core-flicker 1s ease-in-out infinite",
    particleDuration: 1.5,
    particleCount: 5,
    energy: 1,
    showPulse: true,
  },
  waiting: {
    ring: "vox-core-spin 22s linear infinite",
    ring2: "vox-core-spin-reverse 28s linear infinite",
    core: "vox-core-breathe 5s ease-in-out infinite",
    particleDuration: 16,
    particleCount: 2,
    energy: 0.25,
    showPulse: false,
  },
  success: {
    ring: "vox-core-spin 6s linear infinite",
    ring2: "vox-core-spin-reverse 8s linear infinite",
    core: "vox-core-breathe 2.4s ease-in-out infinite",
    particleDuration: 5,
    particleCount: 4,
    energy: 0.75,
    showPulse: true,
  },
  error: {
    ring: "vox-core-spin 8s linear infinite",
    ring2: "vox-core-spin-reverse 10s linear infinite",
    core: "vox-core-flicker 0.7s ease-in-out 3",
    particleDuration: 10,
    particleCount: 2,
    energy: 0.5,
    showPulse: false,
  },
};

const SIZE_PX: Record<"sm" | "md" | "lg" | "xl", number> = { sm: 28, md: 44, lg: 88, xl: 180 };

export function VoxCore({
  state = "idle",
  size = "md",
  showLabel = false,
  className,
}: {
  state?: VoxCoreState;
  size?: "sm" | "md" | "lg" | "xl";
  showLabel?: boolean;
  className?: string;
}) {
  const px = SIZE_PX[size];
  const color = STATE_COLOR[state];
  const timing = STATE_TIMING[state];
  const orbitR = px * 0.62;
  const particles = Array.from({ length: timing.particleCount });

  return (
    <div className={cn("inline-flex flex-col items-center gap-2", className)}>
      <div
        className="vox-core-anim relative flex items-center justify-center"
        style={{ width: px, height: px }}
        role="img"
        aria-label={`VOX — ${STATE_LABEL[state]}`}
      >
        {/* outer ambient glow */}
        <div
          className="absolute inset-0 rounded-full blur-xl"
          style={{
            background: `radial-gradient(circle, ${color} 0%, transparent 72%)`,
            opacity: 0.35 + timing.energy * 0.35,
          }}
        />

        {/* orbiting particles — layered orbital motion */}
        {particles.map((_, i) => (
          <div
            key={i}
            className="absolute left-1/2 top-1/2 h-full w-full"
            style={{
              // Delay folded into the shorthand (rather than a separate
              // animationDelay) — mixing shorthand and longhand for the same
              // property across rerenders (e.g. a state change swaps
              // particleDuration) makes React drop the longhand update.
              animation: `vox-core-particle ${timing.particleDuration}s linear ${(i / particles.length) * timing.particleDuration}s infinite`,
              ["--orbit-r" as string]: `${orbitR}px`,
            }}
          >
            <span
              className="absolute rounded-full"
              style={{
                width: Math.max(2, px * 0.035),
                height: Math.max(2, px * 0.035),
                background: color,
                opacity: 0.35 + timing.energy * 0.5,
                boxShadow: `0 0 ${px * 0.06}px ${color}`,
              }}
            />
          </div>
        ))}

        {/* outer rotating gradient ring */}
        <div
          className="absolute rounded-full"
          style={{
            inset: px * 0.05,
            background: "conic-gradient(from 0deg, var(--core-thinking), var(--core-listening), var(--core-responding), var(--core-thinking))",
            animation: timing.ring,
            opacity: 0.25 + timing.energy * 0.45,
          }}
        />
        {/* inner counter-rotating ring — depth */}
        <div
          className="absolute rounded-full"
          style={{
            inset: px * 0.16,
            background: `conic-gradient(from 180deg, transparent, ${color}, transparent 60%)`,
            animation: timing.ring2,
            opacity: 0.2 + timing.energy * 0.4,
          }}
        />
        {/* mask to turn the rings into thin bands */}
        <div className="absolute rounded-full" style={{ inset: px * 0.24, background: "var(--background)" }} />

        {/* core */}
        <div
          className="absolute rounded-full"
          style={{
            inset: px * 0.3,
            background: `radial-gradient(circle at 35% 30%, ${color}, color-mix(in srgb, ${color} 55%, black))`,
            animation: timing.core,
            boxShadow: `0 0 ${Math.max(8, px * 0.32)}px ${color}`,
          }}
        />
        {/* hot highlight */}
        <div
          className="absolute rounded-full"
          style={{
            width: px * 0.14,
            height: px * 0.14,
            top: px * 0.34,
            left: px * 0.38,
            background: "rgba(255,255,255,0.55)",
            filter: "blur(1px)",
          }}
        />

        {/* pulse ring for active/energetic states */}
        {timing.showPulse ? (
          <div
            className="absolute rounded-full border"
            style={{ inset: 0, borderColor: color, animation: "vox-core-ring-expand 1.6s ease-out infinite" }}
          />
        ) : null}
      </div>
      {showLabel ? (
        <span className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full vox-status-dot" style={{ background: color, color }} />
          {STATE_LABEL[state]}
        </span>
      ) : null}
    </div>
  );
}
