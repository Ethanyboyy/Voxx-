"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

export type InfoMode = "CINEMATIC" | "ENGINEERING" | "EVERYTHING";

const InfoModeContext = createContext<{ mode: InfoMode; setMode: (m: InfoMode) => void }>({
  mode: "ENGINEERING",
  setMode: () => {},
});

export function InfoModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<InfoMode>("ENGINEERING");

  useEffect(() => {
    const stored = localStorage.getItem("lab-info-mode") as InfoMode | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) setMode(stored);
  }, []);

  function update(next: InfoMode) {
    setMode(next);
    localStorage.setItem("lab-info-mode", next);
  }

  return <InfoModeContext.Provider value={{ mode, setMode: update }}>{children}</InfoModeContext.Provider>;
}

export function useInfoMode() {
  return useContext(InfoModeContext);
}

const MODES: { value: InfoMode; label: string }[] = [
  { value: "CINEMATIC", label: "Cinematic" },
  { value: "ENGINEERING", label: "Engineering" },
  { value: "EVERYTHING", label: "Everything" },
];

export function InfoModeToggle() {
  const { mode, setMode } = useInfoMode();
  return (
    <div className="lab-mono inline-flex rounded-full border border-border bg-surface p-0.5 text-[11px]">
      {MODES.map((m) => (
        <button
          key={m.value}
          type="button"
          onClick={() => setMode(m.value)}
          className={cn(
            "rounded-full px-3 py-1 font-semibold uppercase tracking-wider transition-colors",
            mode === m.value ? "bg-accent-muted text-accent shadow-[0_0_10px_-4px_var(--accent)]" : "text-muted-foreground hover:text-foreground"
          )}
          aria-pressed={mode === m.value}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
