"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import type { LabSearchResult } from "@/lib/lab/search";

const NAV_COMMANDS: { match: RegExp; href: string; label: string }[] = [
  { match: /open suit bay|suit bay/i, href: "/lab/suits", label: "Open Suit Bay" },
  { match: /open engineering|engineering bay/i, href: "/lab/engineering", label: "Open Engineering Bay" },
  { match: /open web lab|web lab/i, href: "/lab/web", label: "Open Web Lab" },
  { match: /open simulation|simulation center/i, href: "/lab/simulation", label: "Open Simulation Center" },
  { match: /open experiments|show (all )?(failed )?experiments/i, href: "/lab/experiments", label: "Open Experiments" },
  { match: /open training|training center/i, href: "/lab/training", label: "Open Training Center" },
  { match: /open scenario|scenario generator/i, href: "/lab/scenarios", label: "Open Scenario Generator" },
  { match: /open materials/i, href: "/lab/materials", label: "Open Materials" },
  { match: /open projects/i, href: "/lab/projects", label: "Open Projects" },
  { match: /open knowledge|open data/i, href: "/lab/knowledge", label: "Open Data / Knowledge" },
  { match: /^(open )?(home|laboratory|lab)$/i, href: "/lab", label: "Open Laboratory" },
];

/** "Speaking to the laboratory": real navigation for recognized phrasing
 * (section 29), live entity search, and an AI Lab Engineer fallback for
 * anything else — wired to the same /api/lab/ai endpoint the chat widget uses. */
export function LabCommandBar() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LabSearchResult[]>([]);
  const [aiReply, setAiReply] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Shift+L rather than Cmd/Ctrl+K — the global VOX CommandPalette
      // (src/components/command/CommandPalette.tsx) already owns Cmd/Ctrl+K
      // app-wide, including on /lab routes via AppShell.
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "l") {
        e.preventDefault();
        setOpen(true);
        setQuery("");
        setAiReply(null);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 20);
  }, [open]);

  useEffect(() => {
    if (!open || !query.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults([]);
      return;
    }
    const nav = NAV_COMMANDS.find((c) => c.match.test(query));
    if (nav) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/lab/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((r) => r.json())
        .then((d) => setResults(d.results ?? []))
        .catch(() => {});
    }, 200);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query, open]);

  async function submit() {
    const nav = NAV_COMMANDS.find((c) => c.match.test(query));
    if (nav) {
      router.push(nav.href);
      setOpen(false);
      return;
    }
    if (results.length > 0) {
      router.push(results[0].href);
      setOpen(false);
      return;
    }
    setAsking(true);
    setAiReply(null);
    try {
      const res = await fetch("/api/lab/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: query }),
      });
      const data = await res.json();
      setAiReply(data.reply ?? "No response.");
    } catch {
      setAiReply("The AI Lab Engineer is unavailable right now.");
    } finally {
      setAsking(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="glass-panel flex items-center gap-2 px-3 py-1.5 text-xs text-muted hover:text-foreground"
      >
        <span aria-hidden="true">◎</span>
        <span>Ask the laboratory…</span>
        <kbd className="lab-mono rounded border border-border px-1 text-[10px] text-muted-foreground">⌘⇧L</kbd>
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-24" onClick={() => setOpen(false)}>
      <div
        className="glass-panel-strong lab-corner-frame w-full max-w-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder='Try "Open Suit Bay", "Compare Nightcrawler and Vanguard", or ask anything…'
          className="w-full bg-transparent px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <div className="max-h-80 overflow-y-auto border-t border-border">
          {results.map((r) => (
            <button
              key={`${r.category}-${r.id}`}
              type="button"
              onClick={() => {
                router.push(r.href);
                setOpen(false);
              }}
              className={cn("flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-surface-hover")}
            >
              <span className="text-foreground">{r.title}</span>
              <span className="lab-mono text-[10px] uppercase text-muted-foreground">{r.category}</span>
            </button>
          ))}
          {asking ? <p className="px-4 py-3 text-xs text-muted">Consulting the AI Lab Engineer…</p> : null}
          {aiReply ? <p className="whitespace-pre-wrap px-4 py-3 text-sm text-foreground">{aiReply}</p> : null}
          {!results.length && !asking && !aiReply ? (
            <p className="px-4 py-3 text-xs text-muted-foreground">
              Press Enter to search the laboratory or ask the AI Lab Engineer.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
