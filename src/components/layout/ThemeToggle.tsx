"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";

type Theme = "light" | "dark" | "system";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");

  useEffect(() => {
    // One-time sync from localStorage after mount: server and first client
    // render both use "system" (no access to localStorage during SSR), so
    // this intentionally causes a single extra render rather than risking a
    // hydration mismatch.
    const stored = (localStorage.getItem("vox-theme") as Theme | null) ?? "system";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(stored);
    applyTheme(stored);
  }, []);

  function cycle() {
    const next: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setTheme(next);
    applyTheme(next);
    localStorage.setItem("vox-theme", next);
  }

  const label = theme === "system" ? "System theme" : theme === "light" ? "Light theme" : "Dark theme";

  return (
    <Button variant="ghost" size="sm" onClick={cycle} title="Cycle theme" aria-label={label}>
      {theme === "system" ? "Auto" : theme === "light" ? "Light" : "Dark"}
    </Button>
  );
}
