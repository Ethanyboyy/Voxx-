"use client";

import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

interface ActivityEvent {
  id: string;
  type: string;
  subjectType: string | null;
  subjectId: string | null;
  createdAt: string;
}

/**
 * What VOX has actually been doing — the same Event rows the Command Center
 * and Activity page read, just presented as the Brain's "activity"
 * perspective since a chronological log isn't a spatial graph.
 */
export function ActivityTimeline({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <EmptyState title="Nothing recorded yet" description="Activity shows up here as VOX does real things." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl overflow-y-auto scrollbar-thin p-6">
      <ol className="flex flex-col gap-3 border-l border-border pl-4">
        {events.map((e) => (
          <li key={e.id} className="relative text-sm">
            <span className="absolute -left-[1.15rem] top-1.5 h-2 w-2 rounded-full bg-accent" />
            <span className="text-foreground">{e.type.replace(/[._]/g, " ")}</span>
            {e.subjectType ? (
              <Badge className="ml-2" tone="neutral">
                {e.subjectType.toLowerCase()}
              </Badge>
            ) : null}
            <span className="ml-2 text-xs text-muted">{new Date(e.createdAt).toLocaleString()}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
