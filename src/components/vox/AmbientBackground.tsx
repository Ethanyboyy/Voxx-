/**
 * Fixed, full-viewport ambient depth behind the whole shell — a few slowly
 * drifting blurred gradients, pure CSS. Mounted once in the root layout so
 * every page shares the same living backdrop instead of a flat color.
 */
export function AmbientBackground() {
  return (
    <div
      className="vox-ambient pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{ background: "var(--background)" }}
      aria-hidden="true"
    >
      <div
        className="absolute -left-1/4 -top-1/4 h-[70vh] w-[70vh] rounded-full blur-[120px]"
        style={{
          background: "radial-gradient(circle, var(--accent) 0%, transparent 70%)",
          opacity: 0.16,
          animation: "vox-ambient-drift-1 26s ease-in-out infinite",
        }}
      />
      <div
        className="absolute -right-1/4 top-1/3 h-[60vh] w-[60vh] rounded-full blur-[120px]"
        style={{
          background: "radial-gradient(circle, var(--accent-blue) 0%, transparent 70%)",
          opacity: 0.12,
          animation: "vox-ambient-drift-2 32s ease-in-out infinite",
        }}
      />
      <div
        className="absolute bottom-0 left-1/3 h-[50vh] w-[50vh] rounded-full blur-[130px]"
        style={{
          background: "radial-gradient(circle, var(--accent-2) 0%, transparent 70%)",
          opacity: 0.1,
          animation: "vox-ambient-pulse 12s ease-in-out infinite",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(167,139,250,0.08) 1px, transparent 0)",
          backgroundSize: "28px 28px",
          maskImage: "radial-gradient(ellipse at center, black 0%, transparent 75%)",
        }}
      />
    </div>
  );
}
