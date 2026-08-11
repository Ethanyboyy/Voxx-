"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { cn } from "@/lib/utils/cn";
import { ContextPanel, type ContextTrace } from "@/components/chat/ContextPanel";
import { VoxCore, type VoxCoreState } from "@/components/vox/VoxCore";

interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

interface ChatMessage {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  model?: string | null;
  pending?: boolean;
  context?: ContextTrace;
}

interface RawMessage {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  model: string | null;
  meta: string | null;
}

function fromRawMessage(raw: RawMessage): ChatMessage {
  let context: ContextTrace | undefined;
  if (raw.meta) {
    try {
      const parsed = JSON.parse(raw.meta);
      if (parsed?.context) context = parsed.context;
    } catch {
      // ignore malformed meta — context panel just won't show for this message
    }
  }
  return { id: raw.id, role: raw.role, content: raw.content, model: raw.model, context };
}

export function ChatClient({ initialConversations }: { initialConversations: ConversationSummary[] }) {
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(initialConversations[0]?.id ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    fetch(`/api/conversations/${activeId}`)
      .then((res) => res.json())
      .then((data) => {
        const raw: RawMessage[] = data.conversation?.messages ?? [];
        if (!cancelled) setMessages(raw.map(fromRawMessage));
      });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function ensureConversation(): Promise<string> {
    if (activeId) return activeId;
    const res = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const data = await res.json();
    const conversation = data.conversation as ConversationSummary;
    setConversations((prev) => [conversation, ...prev]);
    setActiveId(conversation.id);
    return conversation.id;
  }

  async function handleNewConversation() {
    const res = await fetch("/api/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const data = await res.json();
    const conversation = data.conversation as ConversationSummary;
    setConversations((prev) => [conversation, ...prev]);
    setActiveId(conversation.id);
    setMessages([]);
  }

  async function handleSend() {
    const text = input.trim();
    if (!text || streaming) return;
    setError(null);
    setInput("");

    const conversationId = await ensureConversation();
    const userMessage: ChatMessage = { id: `local-${Date.now()}`, role: "USER", content: text };
    const assistantMessage: ChatMessage = { id: `pending-${Date.now()}`, role: "ASSISTANT", content: "", pending: true };
    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setStreaming(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, message: text }),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({ error: "Chat request failed." }));
        setError(body.error ?? "Chat request failed.");
        setMessages((prev) => prev.filter((m) => m.id !== assistantMessage.id));
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
              prev.map((m) => (m.id === assistantMessage.id ? { ...m, content: m.content + event.text } : m))
            );
          } else if (event.type === "message_stop") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessage.id
                  ? { ...m, id: event.messageId, model: event.model, context: event.context, pending: false }
                  : m
              )
            );
          } else if (event.type === "error") {
            setError(event.message);
          }
        }
      }
    } finally {
      setStreaming(false);
      setMessages((prev) => prev.map((m) => (m.pending ? { ...m, pending: false } : m)));
    }
  }

  const pendingAssistant = messages.find((m) => m.pending);
  const coreState: VoxCoreState = streaming ? (pendingAssistant?.content ? "responding" : "thinking") : "idle";

  function exportConversation() {
    const text = messages.map((m) => `${m.role}: ${m.content}`).join("\n\n");
    navigator.clipboard.writeText(text);
  }

  const conversationList = (
    <>
      <Button size="sm" variant="secondary" onClick={handleNewConversation} className="mb-3">
        New conversation
      </Button>
      <div className="flex flex-col gap-1 overflow-y-auto scrollbar-thin">
        {conversations.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              setActiveId(c.id);
              setListOpen(false);
            }}
            className={cn(
              "truncate rounded-lg px-3 py-2.5 text-left text-sm sm:py-2",
              c.id === activeId ? "bg-accent-muted text-accent" : "text-muted-foreground hover:bg-surface-hover"
            )}
          >
            {c.title}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <div className="flex h-full w-full">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-border p-3 md:flex">{conversationList}</aside>

      {/* Mobile: conversation list lives in a drawer — the desktop <aside> above
          is hidden below md, so this is the only way to start/switch conversations
          on a phone. */}
      {listOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close conversation list"
            className="absolute inset-0 bg-black/40"
            onClick={() => setListOpen(false)}
          />
          <div
            className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-surface p-3 shadow-xl"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            {conversationList}
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Conversations"
              className="-ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-foreground md:hidden"
              onClick={() => setListOpen(true)}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 5h14M3 10h10M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <VoxCore state={coreState} size="sm" />
            <h1 className="text-sm font-semibold text-foreground">Chat</h1>
          </div>
          <Button size="sm" variant="ghost" onClick={exportConversation} disabled={messages.length === 0}>
            Copy conversation
          </Button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4">
          {messages.length === 0 ? (
            <p className="mt-10 text-center text-sm text-muted">
              Say something to start. VOX remembers context across this conversation and your saved memories.
            </p>
          ) : (
            <div className="mx-auto flex max-w-2xl flex-col gap-4">
              {messages.map((m) => {
                if (m.role === "SYSTEM") {
                  return (
                    <div key={m.id} className="mx-auto max-w-[90%] rounded-full bg-surface-hover px-3 py-1 text-center text-xs text-muted">
                      {m.content}
                    </div>
                  );
                }
                return (
                  <div key={m.id} className={cn("flex items-end gap-2", m.role === "USER" ? "flex-row-reverse" : "flex-row")}>
                    {m.role === "ASSISTANT" ? (
                      <VoxCore state={m.pending ? coreState : "idle"} size="sm" className="mb-1 shrink-0" />
                    ) : null}
                    <div className={cn("flex flex-col", m.role === "USER" ? "items-end" : "items-start")}>
                      <div
                        className={cn(
                          "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm",
                          m.role === "USER" ? "bg-accent text-accent-foreground" : "bg-surface-hover text-foreground"
                        )}
                      >
                        {m.content || (m.pending ? "…" : "")}
                      </div>
                      {m.model ? <span className="mt-1 text-xs text-muted">{m.model}</span> : null}
                      {m.role === "ASSISTANT" && m.context ? <ContextPanel trace={m.context} /> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {error ? <p className="mx-auto mt-4 max-w-2xl text-sm text-danger">{error}</p> : null}
        </div>

        <div className="border-t border-border p-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="Message VOX..."
              rows={2}
              className="flex-1"
            />
            <Button onClick={handleSend} disabled={streaming || !input.trim()}>
              {streaming ? "Sending..." : "Send"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
