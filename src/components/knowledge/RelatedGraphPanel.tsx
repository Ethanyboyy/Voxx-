import Link from "next/link";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import type { RelatedNode } from "@/lib/knowledge/service";

const NODE_TYPE_LABEL: Record<string, string> = {
  ENTITY: "entity",
  TOPIC: "topic",
  PROJECT: "project",
  GOAL: "goal",
  CONCEPT: "concept",
  PERSON: "person",
  ORGANIZATION: "organization",
  OTHER: "other",
};

function entityHref(node: RelatedNode["node"]): string | null {
  if (node.memoryId) return `/memory/${node.memoryId}`;
  if (node.projectId) return `/projects/${node.projectId}`;
  return null;
}

export function RelatedGraphPanel({ related }: { related: RelatedNode[] }) {
  return (
    <Card className="vox-lift mt-6">
      <CardHeader>
        <CardTitle>Related</CardTitle>
        <Link href="/graph" className="text-xs text-accent underline underline-offset-2">
          Open knowledge graph
        </Link>
      </CardHeader>
      <CardContent>
        {related.length === 0 ? (
          <EmptyState
            title="Nothing connected yet"
            description="Connect this to other entities in the knowledge graph to see it here."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {related.map((r) => {
              const href = entityHref(r.node);
              const content = (
                <div className="flex flex-1 items-center gap-2 text-sm">
                  <span className="text-foreground">{r.node.label}</span>
                  <Badge>{NODE_TYPE_LABEL[r.node.type] ?? r.node.type.toLowerCase()}</Badge>
                  <span className="text-xs text-muted">
                    {r.direction === "outgoing" ? "→" : "←"} {r.relation}
                  </span>
                </div>
              );
              return (
                <li
                  key={r.node.id}
                  className="vox-lift instrument instrument-sheen flex items-center justify-between rounded-[var(--radius-sm)] p-3"
                >
                  {href ? (
                    <Link href={href} className="flex flex-1 items-center gap-2 hover:opacity-80">
                      {content}
                    </Link>
                  ) : (
                    content
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
