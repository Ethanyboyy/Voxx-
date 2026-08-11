"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";

interface Command {
  id: string;
  label: string;
  hint?: string;
  href: string;
}

const COMMANDS: Command[] = [
  { id: "dashboard", label: "Go Home", href: "/dashboard" },
  { id: "chat", label: "Talk to VOX", href: "/chat" },
  { id: "memory", label: "Open Memory", href: "/memory" },
  { id: "goals", label: "Open Goals", href: "/goals" },
  { id: "projects", label: "Open Projects", href: "/projects" },
  { id: "tasks", label: "Open Tasks", href: "/tasks" },
  { id: "finance", label: "Open Finance", href: "/finance" },
  { id: "content", label: "Open Content", href: "/content" },
  { id: "graph", label: "Open Knowledge", href: "/graph" },
  { id: "agents", label: "Open Automations", href: "/agents" },
  { id: "new-agent-run", label: "Start a new automation", hint: "Automations", href: "/agents?new=1" },
  { id: "analytics", label: "Open Analytics", href: "/analytics" },
  { id: "connections", label: "Open Integrations", href: "/connections" },
  { id: "brain", label: "Open VOX Brain", href: "/brain" },
  { id: "cognition", label: "Open Observations", href: "/cognition" },
  { id: "proposals", label: "Open Proposals", href: "/proposals" },
  { id: "experiments", label: "Open Laboratory", href: "/experiments" },
  { id: "research", label: "Open Research", href: "/research" },
  { id: "activity", label: "Open Activity", href: "/activity" },
  { id: "settings", label: "Open Settings", href: "/settings" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function openPalette() {
    setQuery("");
    setActiveIndex(0);
    setOpen(true);
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => {
          if (v) return false;
          setQuery("");
          setActiveIndex(0);
          return true;
        });
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((c) => c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q));
  }, [query]);

  function select(command: Command) {
    setOpen(false);
    router.push(command.href);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPalette}
        aria-label="Search / command palette (⌘K)"
        title="What do you want VOX to do? (⌘K)"
        className="flex h-9 w-9 items-center justify-center rounded-lg text-foreground hover:bg-surface-hover"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="8.7" cy="8.7" r="5.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="m16.5 16.5-3.6-3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-24 backdrop-blur-sm">
      <button type="button" aria-label="Close" className="absolute inset-0" onClick={() => setOpen(false)} />
      <div className="glow-border relative w-full max-w-lg overflow-hidden rounded-xl glass-panel-strong shadow-2xl">
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && filtered[activeIndex]) {
              e.preventDefault();
              select(filtered[activeIndex]);
            }
          }}
          placeholder="What do you want VOX to do?"
          className="w-full border-b border-border bg-transparent px-4 py-3 text-base text-foreground placeholder:text-muted focus:outline-none sm:text-sm"
        />
        <div className="max-h-80 overflow-y-auto scrollbar-thin py-1">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">No matches.</p>
          ) : (
            filtered.map((c, i) => (
              <button
                key={c.id}
                type="button"
                onClick={() => select(c)}
                onMouseEnter={() => setActiveIndex(i)}
                className={cn(
                  "flex w-full items-center justify-between px-4 py-2.5 text-left text-sm",
                  i === activeIndex ? "bg-accent-muted text-accent" : "text-foreground"
                )}
              >
                {c.label}
                {c.hint ? <span className="text-xs text-muted">{c.hint}</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
