// Small hand-rolled inline SVG icons for the Brain's bottom icon-toolbar —
// matches the rest of the app's convention (see AppShell's MenuIcon) rather
// than pulling in an icon library dependency for six glyphs.

function Svg({ children }: { children: React.ReactNode }) {
  return (
    <svg width="15" height="15" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      {children}
    </svg>
  );
}

export function ZoomInIcon() {
  return (
    <Svg>
      <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8.5 6v5M6 8.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}

export function ZoomOutIcon() {
  return (
    <Svg>
      <circle cx="8.5" cy="8.5" r="5.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M6 8.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M13 13l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </Svg>
  );
}

export function RotateIcon() {
  return (
    <Svg>
      <path
        d="M15.5 10a5.5 5.5 0 1 1-1.9-4.16"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path d="M13.2 3.4l.6 2.6-2.6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ResetIcon() {
  return (
    <Svg>
      <path d="M4 10a6 6 0 1 1 2 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M4 14.5v-3h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function FocusIcon() {
  return (
    <Svg>
      <path d="M4 4h3M4 4v3M16 4h-3M16 4v3M4 16h3M4 16v-3M16 16h-3M16 16v-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="1.5" />
    </Svg>
  );
}

export function LayerIcon() {
  return (
    <Svg>
      <path d="M10 3l7 3.5L10 10 3 6.5 10 3z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M3 10.5L10 14l7-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 13.5L10 17l7-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

export function ChevronRightIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M7.5 4.5l6 5.5-6 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
