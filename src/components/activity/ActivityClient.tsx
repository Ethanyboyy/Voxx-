"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { GlassPanel } from "@/components/ui/GlassPanel";
import { cn } from "@/lib/utils/cn";

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
      <div className="mb-4 flex items-center justify-between">
        <p className="vox-eyebrow">{events.length} recorded</p>
        <Button size="sm" variant="secondary" onClick={refresh} disabled={refreshing}>
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {events.length === 0 ? (
        <EmptyState title="No activity yet" description="Events accumulate here as VOX does things and notices things." />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(([day, dayEvents]) => (
            <div key={day}>
              <p className="vox-eyebrow mb-2">{day}</p>
              <GlassPanel className="flex flex-col divide-y divide-border overflow-hidden p-0">
                {dayEvents.map((e) => (
                  <div key={e.id} className="relative flex flex-col gap-1.5 px-4 py-3 pl-6">
                    <span
                      className={cn(
                        "absolute left-2 top-4 h-2 w-2 rounded-full",
                        e.consequential ? "bg-warning" : "bg-accent"
                      )}
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{e.type}</span>
                      {e.consequential ? <Badge tone="warning">consequential</Badge> : null}
                      {e.subjectType ? <Badge tone="neutral">{e.subjectType}</Badge> : null}
                      <span className="ml-auto text-xs text-muted">
                        {new Date(e.createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                    {e.payload ? (
                      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words text-xs text-muted-foreground">
                        {formatPayload(e.payload)}
                      </pre>
                    ) : null}
                  </div>
                ))}
              </GlassPanel>
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
