/**
 * Pure-CSS "purple nebula over a mountain range" decorative art for the
 * dashboard greeting band — no external image asset, just layered
 * gradients and jagged silhouettes so it's crisp at any size and needs
 * no licensing/attribution.
 */
export function MountainHero() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" aria-hidden="true">
      <div
        className="absolute -right-16 -top-40 h-[560px] w-[560px] rounded-full blur-[100px]"
        style={{ background: "radial-gradient(circle, var(--accent) 0%, transparent 65%)", opacity: 0.6 }}
      />
      <div
        className="absolute right-24 -top-10 h-[320px] w-[320px] rounded-full blur-[60px]"
        style={{ background: "radial-gradient(circle, var(--accent-blue) 0%, transparent 70%)", opacity: 0.32 }}
      />
      <svg
        viewBox="0 0 1000 300"
        preserveAspectRatio="xMaxYMax slice"
        className="absolute inset-0 h-full w-full"
      >
        {/* back range — hazy, distant */}
        <polygon
          points="230,300 300,190 340,225 400,150 460,205 520,140 590,200 650,160 710,215 780,175 850,220 1000,180 1000,300"
          fill="var(--accent-2)"
          opacity="0.20"
        />
        {/* mid range */}
        <polygon
          points="320,300 380,215 420,240 470,175 520,235 580,190 620,245 690,195 730,240 800,200 870,240 1000,210 1000,300"
          fill="var(--accent)"
          opacity="0.30"
        />
        {/* front range — near-black, crisp silhouette */}
        <polygon
          points="420,300 470,235 505,255 555,205 600,250 655,220 700,255 760,225 800,255 860,235 900,260 1000,240 1000,300"
          fill="#150f26"
          opacity="0.92"
        />
      </svg>
      <div
        className="absolute inset-0"
        style={{
          background: "linear-gradient(90deg, var(--surface-solid) 0%, transparent 38%, transparent 100%)",
        }}
      />
    </div>
  );
}
