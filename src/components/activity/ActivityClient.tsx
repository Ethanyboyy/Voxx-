"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

interface EventItem {
  id: string;
  type: string;
  payload: string | null;
  consequential: boolean;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: string;
}

function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function ActivityClient({ initialEvents }: { initialEvents: EventItem[] }) {
  const [events, setEvents] = useState(initialEvents);
  const [refreshing, setRefreshing] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, EventItem[]>();
    for (const e of events) {
      const key = dayKey(e.createdAt);
      const list = map.get(key) ?? [];
      list.push(e);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [events]);

  async function refresh() {
    setRefreshing(true);
    try {
      const res = await fetch("/api/events");
      const data = await res.json();
      setEvents(data.events ?? []);
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="mt-6">
      <button
        type="button"
        onClick={refresh}
        disabled={refreshing}
        className="mb-4 text-sm font-medium text-accent disabled:opacity-50"
      >
        {refreshing ? "Refreshing…" : "Refresh"}
      </button>

      {events.length === 0 ? (
        <EmptyState title="No activity yet" description="Events accumulate here as VOX does things and notices things." />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(([day, dayEvents]) => (
            <div key={day}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{day}</p>
              <ol className="flex flex-col gap-2 border-l border-border pl-4">
                {dayEvents.map((e) => (
                  <li key={e.id} className="relative">
                    <span className="absolute -left-[1.1rem] top-1.5 h-2 w-2 rounded-full bg-accent" />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{e.type}</span>
                      {e.consequential ? <Badge tone="warning">consequential</Badge> : null}
                      {e.subjectType ? <Badge tone="neutral">{e.subjectType}</Badge> : null}
                      <span className="text-xs text-muted">
                        {new Date(e.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {e.payload ? (
                      <pre className="mt-1 max-w-full overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                        {formatPayload(e.payload)}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatPayload(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
