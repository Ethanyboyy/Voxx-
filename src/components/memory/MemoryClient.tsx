"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Select, Textarea } from "@/components/ui/Field";
import { Card, CardContent } from "@/components/ui/Card";
import { ConfidenceBadge, Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";

const CATEGORIES = [
  "FACT",
  "PREFERENCE",
  "GOAL",
  "PROJECT",
  "EXPERIENCE",
  "IDEA",
  "OBSERVATION",
  "HYPOTHESIS",
  "INFERENCE",
  "TEMPORARY_CONTEXT",
] as const;
const CONFIDENCE_LEVELS = ["LOW", "MEDIUM", "HIGH", "CONFIRMED"] as const;

interface MemoryItem {
  id: string;
  content: string;
  category: string;
  confidence: string;
  provenance: string | null;
  createdAt: string;
}

export function MemoryClient({ initialMemories }: { initialMemories: MemoryItem[] }) {
  const [memories, setMemories] = useState(initialMemories);
  const [content, setContent] = useState("");
  const [category, setCategory] = useState<string>("FACT");
  const [confidence, setConfidence] = useState<string>("MEDIUM");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [conflictStatus, setConflictStatus] = useState<Record<string, string>>({});

  async function handleCreate() {
    if (!content.trim()) return;
    setBusy(true);
    const res = await fetch("/api/memories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content, category, confidence }),
    });
    setBusy(false);
    if (res.ok) {
      const data = await res.json();
      setMemories((prev) => [
        { ...data.memory, createdAt: data.memory.createdAt, updatedAt: data.memory.updatedAt },
        ...prev,
      ]);
      setContent("");
    }
  }

  async function handleDelete(id: string) {
    setMemories((prev) => prev.filter((m) => m.id !== id));
    await fetch(`/api/memories/${id}`, { method: "DELETE" });
  }

  function startEdit(memory: MemoryItem) {
    setEditingId(memory.id);
    setEditContent(memory.content);
  }

  async function saveEdit(id: string) {
    const res = await fetch(`/api/memories/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: editContent }),
    });
    if (res.ok) {
      const data = await res.json();
      setMemories((prev) => prev.map((m) => (m.id === id ? { ...m, content: data.memory.content } : m)));
    }
    setEditingId(null);
  }

  async function checkContradictions(id: string) {
    setCheckingId(id);
    const res = await fetch(`/api/memories/${id}/check-contradictions`, { method: "POST" });
    setCheckingId(null);
    if (!res.ok) return;
    const data = await res.json();
    const count = data.proposals?.length ?? 0;
    setConflictStatus((prev) => ({
      ...prev,
      [id]: count > 0 ? `${count} possible contradiction${count === 1 ? "" : "s"} proposed for review` : "No contradictions found",
    }));
  }

  function handleExport() {
    fetch("/api/memories/export")
      .then((res) => res.json())
      .then((data) => {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "vox-memories-export.json";
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  return (
    <div className="mt-6 flex flex-col gap-6">
      <Card>
        <CardContent className="flex flex-col gap-3 pt-5">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Add something for VOX to remember..."
            rows={2}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-auto">
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c.toLowerCase()}
                </option>
              ))}
            </Select>
            <Select value={confidence} onChange={(e) => setConfidence(e.target.value)} className="w-auto">
              {CONFIDENCE_LEVELS.map((c) => (
                <option key={c} value={c}>
                  {c.toLowerCase()}
                </option>
              ))}
            </Select>
            <Button size="sm" onClick={handleCreate} disabled={busy || !content.trim()}>
              Add memory
            </Button>
            <Button size="sm" variant="ghost" onClick={handleExport} className="ml-auto">
              Export all
            </Button>
          </div>
        </CardContent>
      </Card>

      {memories.length === 0 ? (
        <EmptyState title="No memories yet" description="Anything you tell VOX explicitly, or that it infers with your confirmation, shows up here." />
      ) : (
        <ul className="flex flex-col gap-3">
          {memories.map((m) => (
            <li key={m.id}>
              <Card className={editingId === m.id ? undefined : "vox-lift"}>
                <CardContent className="flex flex-col gap-3 pt-4">
                  {editingId === m.id ? (
                    <div className="flex flex-col gap-2">
                      <Textarea value={editContent} onChange={(e) => setEditContent(e.target.value)} rows={2} />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => saveEdit(m.id)}>
                          Save
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm leading-relaxed text-foreground">{m.content}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge>{m.category.toLowerCase()}</Badge>
                        <ConfidenceBadge confidence={m.confidence} />
                        <span className="text-xs text-muted">{new Date(m.createdAt).toLocaleDateString()}</span>
                        <div className="ml-auto flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => checkContradictions(m.id)} disabled={checkingId === m.id}>
                            {checkingId === m.id ? "Checking..." : "Check for conflicts"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => startEdit(m)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(m.id)}>
                            Delete
                          </Button>
                        </div>
                      </div>
                      {conflictStatus[m.id] ? (
                        <p className="text-xs text-muted">
                          {conflictStatus[m.id]}
                          {conflictStatus[m.id].includes("proposed") ? (
                            <>
                              {" — "}
                              <Link href="/proposals" className="text-accent underline underline-offset-2">
                                review in Proposals
                              </Link>
                            </>
                          ) : null}
                        </p>
                      ) : null}
                    </>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
