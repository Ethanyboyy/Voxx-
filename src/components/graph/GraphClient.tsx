"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/Field";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { cn } from "@/lib/utils/cn";

const NODE_TYPES = ["ENTITY", "TOPIC", "PROJECT", "GOAL", "CONCEPT", "PERSON", "ORGANIZATION", "OTHER"] as const;

interface NodeItem {
  id: string;
  label: string;
  type: string;
  description: string | null;
  memoryId: string | null;
  projectId: string | null;
  goalId: string | null;
  taskId: string | null;
  decisionId: string | null;
  ideaId: string | null;
  experimentId: string | null;
  researchItemId: string | null;
}

interface ConnectionItem {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relation: string;
}

interface RelatedEntry {
  node: NodeItem;
  relation: string;
  direction: "outgoing" | "incoming";
  depth: number;
}

function linkedRecordLabel(node: NodeItem): string | null {
  if (node.memoryId) return "linked memory";
  if (node.projectId) return "linked project";
  if (node.goalId) return "linked goal";
  if (node.taskId) return "linked task";
  if (node.decisionId) return "linked decision";
  if (node.ideaId) return "linked idea";
  if (node.experimentId) return "linked experiment";
  if (node.researchItemId) return "linked research";
  return null;
}

export function GraphClient({
  initialNodes,
  initialConnections,
}: {
  initialNodes: NodeItem[];
  initialConnections: ConnectionItem[];
}) {
  const [nodes, setNodes] = useState(initialNodes);
  const [connections, setConnections] = useState(initialConnections);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [related, setRelated] = useState<RelatedEntry[]>([]);
  const [loadingRelated, setLoadingRelated] = useState(false);

  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<string>("PERSON");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [relation, setRelation] = useState("");

  const grouped = useMemo(() => {
    const groups = new Map<string, NodeItem[]>();
    for (const node of nodes) {
      const list = groups.get(node.type) ?? [];
      list.push(node);
      groups.set(node.type, list);
    }
    return groups;
  }, [nodes]);

  async function selectNode(id: string) {
    setSelectedId(id);
    setLoadingRelated(true);
    const res = await fetch(`/api/knowledge/nodes/${id}/related?depth=1`);
    const data = await res.json();
    setLoadingRelated(false);
    setRelated(data.related ?? []);
  }

  async function createNode() {
    if (!newLabel.trim()) return;
    const res = await fetch("/api/knowledge/nodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: newLabel, type: newType }),
    });
    if (res.ok) {
      const data = await res.json();
      setNodes((prev) => [data.node, ...prev]);
      setNewLabel("");
    }
  }

  async function createConnectionHandler() {
    if (!fromId || !toId || !relation.trim()) return;
    const res = await fetch("/api/knowledge/connections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fromNodeId: fromId, toNodeId: toId, relation }),
    });
    if (res.ok) {
      const data = await res.json();
      setConnections((prev) => [...prev, data.connection]);
      setRelation("");
      if (selectedId === fromId || selectedId === toId) selectNode(selectedId);
    }
  }

  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-2 pt-4">
            <p className="text-xs font-medium text-muted-foreground">Add an entity</p>
            <div className="flex gap-2">
              <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Label, e.g. a person's name" />
              <Select value={newType} onChange={(e) => setNewType(e.target.value)} className="w-36">
                {NODE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.toLowerCase()}
                  </option>
                ))}
              </Select>
              <Button size="sm" onClick={createNode} disabled={!newLabel.trim()}>
                Add
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex flex-col gap-2 pt-4">
            <p className="text-xs font-medium text-muted-foreground">Connect two nodes</p>
            <div className="grid grid-cols-2 gap-2">
              <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
                <option value="">from...</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </Select>
              <Select value={toId} onChange={(e) => setToId(e.target.value)}>
                <option value="">to...</option>
                {nodes.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex gap-2">
              <Input value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="relation, e.g. owns" />
              <Button size="sm" onClick={createConnectionHandler} disabled={!fromId || !toId || !relation.trim()}>
                Connect
              </Button>
            </div>
          </CardContent>
        </Card>

        {nodes.length === 0 ? (
          <EmptyState title="No entities yet" description="Add a person, organization, or concept above to start the graph." />
        ) : (
          <div className="flex flex-col gap-3">
            {Array.from(grouped.entries()).map(([type, items]) => (
              <div key={type}>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{type.toLowerCase()}</p>
                <div className="flex flex-col gap-1">
                  {items.map((node) => (
                    <button
                      key={node.id}
                      onClick={() => selectNode(node.id)}
                      className={cn(
                        "rounded-lg px-3 py-2 text-left text-sm",
                        node.id === selectedId ? "bg-accent-muted text-accent" : "text-foreground hover:bg-surface-hover"
                      )}
                    >
                      {node.label}
                      {linkedRecordLabel(node) ? (
                        <span className="ml-2 text-xs text-muted">{linkedRecordLabel(node)}</span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Card className="h-fit">
        <CardContent className="pt-4">
          {!selectedNode ? (
            <EmptyState title="Select a node" description="Pick an entity on the left to see what it's connected to." />
          ) : (
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold text-foreground">{selectedNode.label}</h2>
                <Badge>{selectedNode.type.toLowerCase()}</Badge>
              </div>
              {selectedNode.description ? <p className="mt-1 text-sm text-muted">{selectedNode.description}</p> : null}
              {linkedRecordLabel(selectedNode) ? (
                <p className="mt-1 text-xs text-accent">{linkedRecordLabel(selectedNode)}</p>
              ) : null}

              <p className="mt-4 text-xs font-medium text-muted-foreground">Connections ({connections.filter(c => c.fromNodeId === selectedNode.id || c.toNodeId === selectedNode.id).length})</p>
              {loadingRelated ? (
                <p className="mt-2 text-sm text-muted">Loading...</p>
              ) : related.length === 0 ? (
                <p className="mt-2 text-sm text-muted">Nothing connected yet.</p>
              ) : (
                <ul className="mt-2 flex flex-col gap-2">
                  {related.map((r) => (
                    <li key={r.node.id} className="flex items-center justify-between rounded-lg border border-border p-2 text-sm">
                      <button onClick={() => selectNode(r.node.id)} className="text-left text-foreground hover:underline">
                        {r.node.label}
                      </button>
                      <span className="text-xs text-muted">
                        {r.direction === "outgoing" ? `${selectedNode.label} —${r.relation}→` : `←${r.relation}— ${selectedNode.label}`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
