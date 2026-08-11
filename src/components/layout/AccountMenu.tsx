"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Theme = "light" | "dark";

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (theme === "dark") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

/**
 * Reference shows a single small icon in the header — no visible email
 * text, no separate theme/sign-out buttons. Same three controls
 * (identity, appearance, sign out) collapsed behind one trigger instead
 * of three, matching that visual density without losing functionality.
 */
export function AccountMenu({ userEmail }: { userEmail: string }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<Theme>("dark");
  const [loggingOut, setLoggingOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const stored = (localStorage.getItem("vox-theme") as Theme | null) ?? "dark";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(stored);
    applyTheme(stored);
  }, []);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [open]);

  function cycleTheme() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
    localStorage.setItem("vox-theme", next);
  }

  async function handleLogout() {
    setLoggingOut(true);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const initial = userEmail.trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-muted text-sm font-semibold text-accent hover:brightness-110"
      >
        {initial}
      </button>

      {open ? (
        <div role="menu" className="glass-panel-strong absolute right-0 z-50 mt-2 w-64 shadow-2xl">
          <div className="border-b border-border px-4 py-3">
            <p className="truncate text-sm font-medium text-foreground">{userEmail}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={cycleTheme}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm text-foreground hover:bg-surface-hover"
          >
            <span>Appearance</span>
            <span className="text-muted">{theme === "light" ? "Light" : "Obsidian"}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            disabled={loggingOut}
            className="w-full px-4 py-2.5 text-left text-sm text-foreground hover:bg-surface-hover disabled:opacity-60"
          >
            {loggingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
