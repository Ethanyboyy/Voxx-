"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import type { SearchResult } from "@/lib/search/service";

interface Command {
  id: string;
  label: string;
  hint?: string;
  href: string;
}

const COMMANDS: Command[] = [
  { id: "brain", label: "Open VOX Brain", href: "/brain" },
  { id: "dashboard", label: "Go Home", href: "/dashboard" },
  { id: "chat", label: "Talk to VOX", href: "/chat" },
  { id: "memory", label: "Open Memory", href: "/memory" },
  { id: "objectives", label: "Open Objectives", href: "/objectives" },
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
  { id: "cognition", label: "Open Observations", href: "/cognition" },
  { id: "proposals", label: "Open Proposals", href: "/proposals" },
  { id: "experiments", label: "Open Laboratory", href: "/experiments" },
  { id: "lab", label: "Open Spider-Man Lab", href: "/lab" },
  { id: "research", label: "Open Research", href: "/research" },
  { id: "activity", label: "Open Activity", href: "/activity" },
  { id: "settings", label: "Open Settings", href: "/settings" },
];

/** One flat, keyboard-navigable list merging static navigation commands with
 * live cross-domain search results — two different item shapes, one index. */
type PaletteItem =
  | { kind: "nav"; group: "Navigate"; command: Command }
  | { kind: "result"; group: string; result: SearchResult };

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function openPalette() {
    setQuery("");
    setResults([]);
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
          setResults([]);
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

  const matchingCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((c) => c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q));
  }, [query]);

  // Real cross-domain search — debounced, abortable, same pattern already
  // proven in the Lab's command bar (src/components/lab/LabCommandBar.tsx).
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d) => setResults(d.results ?? []))
        .catch(() => {})
        .finally(() => setSearching(false));
    }, 200);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query, open]);

  const items: PaletteItem[] = useMemo(() => {
    const navItems: PaletteItem[] = matchingCommands
      .slice(0, query.trim() ? 5 : matchingCommands.length)
      .map((command) => ({ kind: "nav", group: "Navigate", command }));
    const resultItems: PaletteItem[] = results.map((result) => ({ kind: "result", group: result.type, result }));
    return [...navItems, ...resultItems];
  }, [matchingCommands, results, query]);

  function selectItem(item: PaletteItem) {
    setOpen(false);
    router.push(item.kind === "nav" ? item.command.href : item.result.href);
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={openPalette}
        aria-label="Search / command palette (⌘K)"
        title="What do you want VOX to do? (⌘K)"
        className="vox-press flex h-9 w-9 items-center justify-center rounded-[var(--radius-xs)] text-foreground transition-colors duration-200 ease-[var(--ease-luxury)] hover:bg-surface-hover"
      >
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <circle cx="8.7" cy="8.7" r="5.2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <path d="m16.5 16.5-3.6-3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    );
  }

  let lastGroup: string | null = null;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/60 px-4 pt-24 backdrop-blur-sm">
      <button type="button" aria-label="Close" className="absolute inset-0" onClick={() => setOpen(false)} />
      <div className="vox-panel-in glow-border relative w-full max-w-lg overflow-hidden rounded-[var(--radius-lg)] instrument-float instrument-sheen shadow-[var(--shadow-ambient-lg)]">
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
              setActiveIndex((i) => Math.min(i + 1, items.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActiveIndex((i) => Math.max(i - 1, 0));
            } else if (e.key === "Enter" && items[activeIndex]) {
              e.preventDefault();
              selectItem(items[activeIndex]);
            }
          }}
          placeholder="Search memory, projects, research, the Lab…"
          className="w-full border-b border-border bg-transparent px-4 py-3.5 text-base text-foreground placeholder:text-muted focus:outline-none sm:text-sm"
        />
        <div className="max-h-96 overflow-y-auto scrollbar-thin p-1.5">
          {items.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted">
              {searching ? "Searching…" : "No matches."}
            </p>
          ) : (
            items.map((item, i) => {
              const key = item.kind === "nav" ? `nav-${item.command.id}` : `result-${item.result.source}-${item.result.id}`;
              const showGroupHeader = item.group !== lastGroup;
              lastGroup = item.group;
              return (
                <div key={key}>
                  {showGroupHeader ? (
                    <p className="vox-eyebrow px-3.5 pt-2.5 pb-1 text-[10px] text-muted-foreground">{item.group}</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => selectItem(item)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-[var(--radius-xs)] px-3.5 py-2.5 text-left text-sm transition-colors duration-150 ease-[var(--ease-luxury)]",
                      i === activeIndex ? "bg-accent-muted text-accent" : "text-foreground"
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      {item.kind === "nav" ? item.command.label : item.result.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted">
                      {item.kind === "nav" ? item.command.hint : item.result.subtitle}
                    </span>
                  </button>
                </div>
              );
            })
          )}
          {searching && items.length > 0 ? (
            <p className="px-3.5 py-1.5 text-xs text-muted-foreground">Searching…</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
