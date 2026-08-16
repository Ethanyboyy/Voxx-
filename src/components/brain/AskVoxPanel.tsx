"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { cn } from "@/lib/utils/cn";
import type { BrainState } from "@/lib/brain/graph";

interface AskMessage {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  /** From the real chat context trace — never fabricated, just surfaced. */
  memoriesUsed?: number;
}

const DEFAULT_QUESTIONS = [
  "Explain why this is ranked the way it is.",
  "What assumptions are driving this?",
  "What would make this fail?",
  "What's the single next step?",
];

/**
 * A real, minimal chat surface embedded in the Brain workspace — not a
 * scripted Q&A. Every question is sent through the same /api/chat +
 * /api/conversations path Chat itself uses, so the reply is a genuine model
 * response with genuine memory retrieval, and the conversation it creates
 * shows up in Chat history too (nothing parallel or fake).
 *
 * `visualContext` carries what the Brain workspace itself knows right now
 * (perspective, what's focused) so VOX can answer "what am I missing?"
 * questions with awareness of what the user is actually looking at.
 */
export function AskVoxPanel({
  contextText,
  contextLabel,
  visualContext,
  suggestedQuestions,
  onActivity,
}: {
  contextText: string;
  contextLabel: string;
  visualContext?: string;
  suggestedQuestions?: string[];
  onActivity?: (state: BrainState | null, detail: string | null) => void;
}) {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const idSeq = useRef(0);
  const nextId = (prefix: string) => `${prefix}-${idSeq.current++}`;

  async function ensureConversation(): Promise<string> {
    if (conversationId) return conversationId;
    const res = await fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: `Brain: ${contextLabel}`.slice(0, 190) }),
    });
    const data = await res.json();
    setConversationId(data.conversation.id);
    return data.conversation.id;
  }

  async function send(question: string) {
    const trimmed = question.trim();
    if (!trimmed || sending) return;
    setError(null);
    setInput("");

    const contextBlock = [contextText, visualContext].filter(Boolean).join("\n");
    const fullMessage = `[Context: ${contextBlock}]\n\n${trimmed}`;
    const userMsg: AskMessage = { id: nextId("local"), role: "USER", content: trimmed };
    const assistantMsg: AskMessage = { id: nextId("pending"), role: "ASSISTANT", content: "" };
    setMessages((prev) => [...prev, userMsg, assistantMsg]);
    setSending(true);
    onActivity?.("thinking", `Answering about ${contextLabel}`);

    try {
      const conversation = await ensureConversation();
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId: conversation, message: fullMessage }),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({ error: "Ask VOX failed." }));
        setError(body.error ?? "Ask VOX failed.");
        setMessages((prev) => prev.filter((m) => m.id !== assistantMsg.id));
        onActivity?.("error", body.error ?? "Ask VOX failed.");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "text_delta") {
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: m.content + event.text } : m))
            );
          } else if (event.type === "message_stop") {
            const memoriesUsed: number | undefined = event.context?.memoriesUsed?.length;
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMsg.id ? { ...m, id: event.messageId, memoriesUsed } : m))
            );
          } else if (event.type === "error") {
            setError(event.message);
            onActivity?.("error", event.message);
          }
        }
      }
      onActivity?.(null, null);
    } finally {
      setSending(false);
    }
  }

  const questions = suggestedQuestions ?? DEFAULT_QUESTIONS;

  return (
    <div className="flex flex-col gap-2">
      <p className="vox-eyebrow">Ask VOX about this</p>

      {messages.length === 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {questions.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => send(q)}
              className="vox-press rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors duration-200 ease-[var(--ease-luxury)] hover:border-[var(--border-strong)] hover:text-foreground"
            >
              {q}
            </button>
          ))}
        </div>
      ) : (
        <div className="flex max-h-56 flex-col gap-2 overflow-y-auto scrollbar-thin pr-1">
          {messages.map((m) => (
            <div key={m.id} className={cn("flex flex-col", m.role === "USER" ? "items-end" : "items-start")}>
              <div
                className={cn(
                  "max-w-[92%] whitespace-pre-wrap rounded-[var(--radius-sm)] px-2.5 py-1.5 text-xs",
                  m.role === "USER" ? "bg-accent-muted text-accent" : "bg-surface-hover text-foreground"
                )}
              >
                {m.content || (sending ? "…" : "")}
              </div>
              {m.role === "ASSISTANT" && m.memoriesUsed ? (
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  🔎 {m.memoriesUsed} relevant memor{m.memoriesUsed === 1 ? "y" : "ies"} retrieved
                </p>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {error ? <p className="text-xs text-danger">{error}</p> : null}

      <div className="flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          placeholder="Ask VOX about this…"
          rows={1}
          className="min-h-0 flex-1 py-1.5 text-xs"
        />
        <Button size="sm" disabled={sending || !input.trim()} onClick={() => send(input)}>
          Ask
        </Button>
      </div>
    </div>
  );
}
