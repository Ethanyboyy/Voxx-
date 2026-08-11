/**
 * Pure-CSS "purple nebula over a mountain range" decorative art for the
 * dashboard greeting band — no external image asset, just layered
 * gradients and clip-path silhouettes so it's crisp at any size and needs
 * no licensing/attribution.
 */
export function MountainHero() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" aria-hidden="true">
      <div
        className="absolute -right-10 -top-24 h-[420px] w-[420px] rounded-full blur-[80px]"
        style={{ background: "radial-gradient(circle, var(--accent) 0%, transparent 68%)", opacity: 0.55 }}
      />
      <div
        className="absolute right-10 top-0 h-[260px] w-[260px] rounded-full blur-[50px]"
        style={{ background: "radial-gradient(circle, var(--accent-blue) 0%, transparent 70%)", opacity: 0.28 }}
      />
      <svg
        viewBox="0 0 800 220"
        preserveAspectRatio="xMaxYMax slice"
        className="absolute inset-0 h-full w-full opacity-90"
      >
        <polygon points="380,220 520,80 620,160 700,110 800,220" fill="var(--accent-2)" opacity="0.22" />
        <polygon points="440,220 560,120 660,175 760,140 800,220" fill="var(--accent)" opacity="0.28" />
        <polygon points="500,220 600,155 680,195 800,160 800,220" fill="#1a1230" opacity="0.85" />
      </svg>
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(90deg, var(--surface-solid) 0%, transparent 45%, transparent 100%)",
        }}
      />
    </div>
  );
}
