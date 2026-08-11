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

/** Rotation/pulse rhythm per state — the same three animated layers are reused
 * throughout, only their duration/direction changes, so this stays cheap. */
const STATE_TIMING: Record<VoxCoreState, { ring: string; core: string; ringSpeed: string }> = {
  idle: { ring: "vox-core-spin 14s linear infinite", core: "vox-core-breathe 4s ease-in-out infinite", ringSpeed: "14s" },
  listening: {
    ring: "vox-core-spin 3s linear infinite",
    core: "vox-core-pulse-fast 1.4s ease-in-out infinite",
    ringSpeed: "3s",
  },
  thinking: {
    ring: "vox-core-spin-reverse 2.2s linear infinite",
    core: "vox-core-breathe 1.8s ease-in-out infinite",
    ringSpeed: "2.2s",
  },
  responding: {
    ring: "vox-core-spin 4s linear infinite",
    core: "vox-core-pulse-fast 2s ease-in-out infinite",
    ringSpeed: "4s",
  },
  executing: {
    ring: "vox-core-spin 1.4s linear infinite",
    core: "vox-core-flicker 1.1s ease-in-out infinite",
    ringSpeed: "1.4s",
  },
  waiting: { ring: "vox-core-spin 20s linear infinite", core: "vox-core-breathe 5s ease-in-out infinite", ringSpeed: "20s" },
  success: { ring: "vox-core-spin 8s linear infinite", core: "vox-core-breathe 3s ease-in-out infinite", ringSpeed: "8s" },
  error: { ring: "vox-core-spin 8s linear infinite", core: "vox-core-flicker 0.7s ease-in-out 3", ringSpeed: "8s" },
};

const SIZE_PX: Record<"sm" | "md" | "lg" | "xl", number> = { sm: 28, md: 44, lg: 88, xl: 160 };

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

  return (
    <div className={cn("inline-flex flex-col items-center gap-2", className)}>
      <div
        className="vox-core-anim relative flex items-center justify-center"
        style={{ width: px, height: px }}
        role="img"
        aria-label={`VOX — ${STATE_LABEL[state]}`}
      >
        {/* outer glow */}
        <div
          className="absolute inset-0 rounded-full blur-md"
          style={{
            background: `radial-gradient(circle, ${color} 0%, transparent 70%)`,
            opacity: 0.55,
          }}
        />
        {/* rotating gradient ring */}
        <div
          className="absolute rounded-full"
          style={{
            inset: px * 0.06,
            background: `conic-gradient(from 0deg, var(--core-1), var(--core-2), var(--core-3), var(--core-1))`,
            animation: timing.ring,
            opacity: state === "waiting" ? 0.35 : 0.9,
          }}
        />
        {/* mask to turn the ring into a thin band */}
        <div
          className="absolute rounded-full"
          style={{ inset: px * 0.16, background: "var(--background)" }}
        />
        {/* core */}
        <div
          className="absolute rounded-full"
          style={{
            inset: px * 0.28,
            background: `radial-gradient(circle at 35% 30%, ${color}, color-mix(in srgb, ${color} 60%, black))`,
            animation: timing.core,
            boxShadow: `0 0 ${Math.max(6, px * 0.25)}px ${color}`,
          }}
        />
        {/* pulse rings for active states */}
        {state === "listening" || state === "executing" ? (
          <div
            className="absolute rounded-full border"
            style={{
              inset: 0,
              borderColor: color,
              animation: "vox-core-ring-expand 1.6s ease-out infinite",
            }}
          />
        ) : null}
      </div>
      {showLabel ? <span className="text-xs font-medium text-muted-foreground">{STATE_LABEL[state]}</span> : null}
    </div>
  );
}
