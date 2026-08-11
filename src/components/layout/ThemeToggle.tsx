"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

// VOX's obsidian/violet identity is the default appearance — it doesn't
// follow the host OS's light/dark preference. "Light" is the one opt-out,
// applied via [data-theme="light"]; absence of the attribute is obsidian.
type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    // One-time sync from localStorage after mount: server and first client
    // render both default to "dark" (no access to localStorage during SSR),
    // so this intentionally causes a single extra render rather than risking
    // a hydration mismatch.
    const stored = (localStorage.getItem("vox-theme") as Theme | null) ?? "dark";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(stored);
    applyTheme(stored);
  }, []);

  function cycle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    localStorage.setItem("vox-theme", next);
  }

  const label = theme === "light" ? "Light theme" : "Obsidian theme";

  return (
    <Button variant="ghost" size="sm" onClick={cycle} title="Toggle appearance" aria-label={label}>
      {theme === "light" ? "Light" : "Obsidian"}
    </Button>
  );
}
