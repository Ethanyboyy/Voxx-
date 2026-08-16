/**
 * Pure-CSS "purple nebula over a mountain range" decorative art for the
 * dashboard greeting band — no external image asset, just layered
 * gradients and a jagged silhouette path so it's crisp at any size and
 * needs no licensing/attribution. Built by tracing the reference's
 * proportions: one dominant rocky peak backlit by a soft moon-glow,
 * rim-lit along its sunward edge, with a hazier ridge behind it.
 */
export function MountainHero() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[var(--radius-panel)]" aria-hidden="true">
      <div
        className="absolute -right-8 -top-24 h-[420px] w-[420px] rounded-full blur-[70px]"
        style={{
          background:
            "radial-gradient(circle, rgba(196,181,253,0.9) 0%, rgba(167,139,250,0.55) 35%, rgba(124,58,237,0.15) 60%, transparent 75%)",
        }}
      />
      <div
        className="absolute right-32 top-10 h-[160px] w-[160px] rounded-full blur-[30px]"
        style={{ background: "radial-gradient(circle, rgba(255,255,255,0.85) 0%, transparent 70%)" }}
      />
      <svg viewBox="0 0 1000 260" preserveAspectRatio="xMidYMax slice" className="absolute inset-0 h-full w-full">
        <defs>
          <linearGradient id="mtn-rim" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c4b5fd" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#c4b5fd" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* hazier back ridge for depth */}
        <path
          d="M 280,260 L 350,210 L 400,225 L 460,180 L 510,195 L 570,150 L 610,165 L 670,130 L 730,155 L 790,175 L 860,200 L 1000,210 L 1000,260 Z"
          fill="#2a2045"
          opacity="0.4"
        />
        {/* main jagged peak silhouette */}
        <path
          d="M 230,260 L 300,195 L 335,215 L 385,160 L 415,178 L 460,120 L 490,140 L 530,95 L 555,72 L 575,88 L 605,60 L 630,78 L 660,68 L 690,95 L 720,85 L 755,120 L 800,150 L 850,170 L 920,195 L 1000,215 L 1000,260 Z"
          fill="#140f24"
        />
        {/* rim light along the lit ridge edges near the glow */}
        <path
          d="M 490,140 L 530,95 L 555,72 L 575,88 L 605,60 L 630,78 L 660,68 L 690,95 L 720,85"
          fill="none"
          stroke="url(#mtn-rim)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          opacity="0.75"
        />
      </svg>
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(90deg, var(--surface-solid) 0%, transparent 40%, transparent 100%)",
        }}
      />
    </div>
  );
}
