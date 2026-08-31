"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Field";
import { cn } from "@/lib/utils/cn";
import { ContextPanel, type ContextTrace } from "@/components/chat/ContextPanel";
import { VoxCore, type VoxCoreState } from "@/components/vox/VoxCore";
import { VoxErrorPanel } from "@/components/vox/VoxErrorPanel";
import { InlineRunProgress } from "@/components/chat/InlineRunProgress";
import { useVoice } from "@/lib/voice/useVoice";

function SpeakerIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 8v4h3l4 3V5L6 8H3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M13.5 7a4 4 0 0 1 0 6M15.8 4.7a7.5 7.5 0 0 1 0 10.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

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
  /** Set when this turn started a real orchestrated run. */
  runId?: string | null;
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
  let runId: string | undefined;
  if (raw.meta) {
    try {
      const parsed = JSON.parse(raw.meta);
      if (parsed?.context) context = parsed.context;
      // The run outlives the streaming turn, so the link has to come back on
      // reload. Without this a finished run is unreachable from the very
      // conversation that started it.
      if (typeof parsed?.runId === "string") runId = parsed.runId;
    } catch {
      // ignore malformed meta — context panel just won't show for this message
    }
  }
  return { id: raw.id, role: raw.role, content: raw.content, model: raw.model, context, runId };
}

export function ChatClient({ initialConversations }: { initialConversations: ConversationSummary[] }) {
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(initialConversations[0]?.id ?? null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [voiceReplies, setVoiceReplies] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  /** Distance from the bottom as of the last scroll the reader performed. */
  const fromBottomRef = useRef(0);

  const voice = useVoice((finalText) => {
    if (finalText) handleSend(finalText);
  });

  /**
   * Reloads the conversation from the server.
   *
   * The server is authoritative for an orchestrated turn: its assistant
   * message is written when the run starts and REWRITTEN when the run settles,
   * so the finished wording is fetched back rather than reconstructed on the
   * client. This is also what makes a reload mid-run recover — the message and
   * its runId are durable, and the live panel picks up from there.
   */
  const refreshMessages = useCallback(async () => {
    if (!activeId) return;
    const res = await fetch(`/api/conversations/${activeId}`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    const raw: RawMessage[] = data.conversation?.messages ?? [];
    setMessages(raw.map(fromRawMessage));
  }, [activeId]);

  useEffect(() => {
    // Scheduled rather than called: refreshMessages sets state, and doing that
    // synchronously inside an effect triggers a cascading render.
    const timer = setTimeout(() => void refreshMessages(), 0);
    return () => clearTimeout(timer);
  }, [refreshMessages]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  /**
   * Keeps the newest turn in view while late-arriving content grows the list.
   *
   * Scrolling on `messages` alone is no longer enough: an inline run panel
   * mounts empty and fills in after its first read, so the list gets taller
   * once the effect above has already run. On a conversation carrying several
   * runs that leaves the view stranded whole screens above the bottom after a
   * reload — the finished turn is on screen only if you scroll for it.
   *
   * Re-pins only when the reader was already at the bottom, measured BEFORE
   * the growth (a resize moves no scrollbar, so the last scroll the reader
   * performed is still the honest reading). Scrolling up to read history is
   * therefore never fought.
   */
  const hasMessages = messages.length > 0;
  useEffect(() => {
    const viewport = scrollRef.current;
    const content = contentRef.current;
    if (!viewport || !content || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (fromBottomRef.current > 64) return;
      viewport.scrollTo({ top: viewport.scrollHeight });
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [hasMessages]);

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

  async function handleSend(override?: string) {
    const text = (override ?? input).trim();
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
      let fullText = "";

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
            fullText += event.text;
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMessage.id ? { ...m, content: m.content + event.text } : m))
            );
          } else if (event.type === "run_started") {
            // The run exists from here on. Attaching the link now rather than
            // at message_stop means a long run is inspectable while it runs,
            // which is the case where the workspace is most useful.
            setMessages((prev) =>
              prev.map((m) => (m.id === assistantMessage.id ? { ...m, runId: event.runId } : m))
            );
          } else if (event.type === "message_stop") {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantMessage.id
                  ? { ...m, id: event.messageId, model: event.model, context: event.context, runId: event.runId ?? m.runId, pending: false }
                  : m
              )
            );
            if (voiceReplies) voice.speak(fullText);
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
  const coreState: VoxCoreState = voice.listening
    ? "listening"
    : streaming
      ? pendingAssistant?.content
        ? "responding"
        : "thinking"
      : voice.speaking
        ? "responding"
        : "idle";

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
              "vox-press truncate rounded-lg px-3 py-2.5 text-left text-sm transition-colors duration-200 ease-[var(--ease-luxury)] sm:py-2",
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
            className="instrument-float instrument-sheen absolute inset-y-0 left-0 flex w-64 flex-col rounded-none p-3 shadow-xl"
            style={{ paddingTop: "env(safe-area-inset-top)" }}
          >
            {conversationList}
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="instrument-float instrument-sheen flex items-center justify-between rounded-none border-x-0 border-t-0 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Conversations"
              className="vox-press -ml-1 flex h-10 w-10 items-center justify-center rounded-lg text-foreground hover:bg-surface-hover md:hidden"
              onClick={() => setListOpen(true)}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M3 5h14M3 10h10M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <VoxCore state={coreState} size="sm" showLabel />
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setVoiceReplies((v) => !v)}
              disabled={!voice.ttsSupported}
              title={
                voice.ttsSupported
                  ? voiceReplies
                    ? "Voice replies on — VOX will speak new responses"
                    : "Voice replies off"
                  : "Text-to-speech isn't supported in this browser"
              }
              aria-pressed={voiceReplies}
              className={cn(
                "vox-press flex h-9 w-9 items-center justify-center rounded-lg transition-colors duration-200 ease-[var(--ease-luxury)] disabled:opacity-30",
                voiceReplies ? "bg-accent-muted text-accent" : "text-muted hover:bg-surface-hover hover:text-foreground"
              )}
            >
              <SpeakerIcon />
            </button>
            <Button size="sm" variant="ghost" onClick={exportConversation} disabled={messages.length === 0}>
              Copy conversation
            </Button>
          </div>
        </div>

        <div
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            fromBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight;
          }}
          className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4"
        >
          {messages.length === 0 ? (
            <div className="mt-16 flex flex-col items-center gap-4 text-center">
              {voice.sttSupported ? (
                <button
                  type="button"
                  onClick={() => (voice.listening ? voice.stopListening() : voice.startListening())}
                  className="mt-6 flex flex-col items-center gap-6 sm:hidden"
                  aria-label={voice.listening ? "Stop listening" : "Tap to talk to VOX"}
                >
                  <span className="relative flex h-64 w-64 items-center justify-center">
                    <span
                      className="absolute inset-0 rounded-full blur-2xl"
                      style={{
                        background: "radial-gradient(circle, var(--accent) 0%, transparent 70%)",
                        opacity: voice.listening ? 0.55 : 0.32,
                      }}
                    />
                    <span
                      className="absolute inset-6 rounded-full border"
                      style={{
                        borderColor: "var(--accent)",
                        opacity: 0.4,
                        animation: voice.listening ? "vox-ambient-pulse 2.4s ease-in-out infinite" : undefined,
                      }}
                    />
                    <VoxCore state={voice.listening ? "listening" : "idle"} size="xl" />
                  </span>
                  <p className="text-base font-medium text-foreground">
                    {voice.listening ? "Listening…" : "Tap to talk to VOX"}
                  </p>
                </button>
              ) : null}
              <div className={cn("flex-col items-center gap-4", voice.sttSupported ? "hidden sm:flex" : "flex")}>
                <VoxCore state="idle" size="lg" />
                <p className="max-w-sm text-sm text-muted">
                  Say something to start. VOX remembers context across this conversation and your saved memories.
                </p>
              </div>
            </div>
          ) : (
            <div ref={contentRef} className="mx-auto flex max-w-2xl flex-col gap-4">
              {messages.map((m) => {
                if (m.role === "SYSTEM") {
                  return (
                    <div key={m.id} className="instrument instrument-sheen mx-auto max-w-[90%] rounded-full px-3 py-1 text-center text-xs text-muted">
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
                          "max-w-[85%] whitespace-pre-wrap rounded-[var(--radius-md)] px-4 py-2 text-sm",
                          m.role === "USER"
                            ? "bg-gradient-to-br from-accent to-accent-2 text-accent-foreground shadow-[var(--shadow-ambient-xs)]"
                            : "instrument instrument-sheen text-foreground"
                        )}
                      >
                        {m.content || (m.pending ? "…" : "")}
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        {m.model ? <span className="text-xs text-muted">{m.model}</span> : null}
                        {m.role === "ASSISTANT" && m.content && voice.ttsSupported ? (
                          <button
                            type="button"
                            onClick={() => (voice.speaking ? voice.stopSpeaking() : voice.speak(m.content))}
                            className="text-xs text-muted hover:text-accent"
                            title={voice.speaking ? "Stop" : "Play this message"}
                          >
                            {voice.speaking ? "■ stop" : "▶ play"}
                          </button>
                        ) : null}
                      </div>
                      {m.runId ? (
                        <InlineRunProgress
                          runId={m.runId}
                          // The message is rewritten server-side when the run
                          // settles, so the finished text is fetched back
                          // rather than guessed at here.
                          onSettled={() => void refreshMessages()}
                        />
                      ) : null}
                      {m.role === "ASSISTANT" && m.context ? <ContextPanel trace={m.context} /> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {error ? <div className="mt-4"><VoxErrorPanel message={error} /></div> : null}
        </div>

        <div className="instrument-float instrument-sheen rounded-none border-x-0 border-b-0 p-4" style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          <div className="mx-auto flex max-w-2xl items-end gap-2">
            <button
              type="button"
              disabled={!voice.sttSupported || streaming}
              onClick={() => (voice.listening ? voice.stopListening() : voice.startListening())}
              title={
                voice.sttSupported
                  ? voice.listening
                    ? "Stop listening"
                    : "Speak to VOX"
                  : "Speech recognition isn't supported in this browser — text is the only input path here."
              }
              aria-label={voice.listening ? "Stop listening" : "Voice input"}
              aria-pressed={voice.listening}
              className={cn(
                "vox-press relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors duration-200 ease-[var(--ease-luxury)] disabled:opacity-30",
                voice.listening
                  ? "bg-danger/15 text-danger"
                  : "text-muted hover:bg-surface-hover hover:text-foreground"
              )}
            >
              {voice.listening ? (
                <span
                  className="absolute inset-0 rounded-lg border border-danger"
                  style={{ animation: "vox-core-ring-expand 1.4s ease-out infinite" }}
                />
              ) : null}
              <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <rect x="7" y="2" width="6" height="10" rx="3" stroke="currentColor" strokeWidth="1.5" />
                <path d="M4 9.5a6 6 0 0 0 12 0M10 15.5v2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
            <div className="relative flex-1">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                placeholder={voice.listening ? "Listening…" : "Message VOX..."}
                rows={2}
                className="flex-1"
              />
              {voice.interimTranscript ? (
                <p className="pointer-events-none absolute inset-x-3 bottom-1.5 truncate text-xs italic text-muted">
                  {voice.interimTranscript}
                </p>
              ) : null}
            </div>
            <Button onClick={() => handleSend()} disabled={streaming || !input.trim()}>
              {streaming ? "Sending..." : "Send"}
            </Button>
          </div>
          {voice.error ? (
            <p className="mx-auto mt-2 max-w-2xl text-xs text-danger">{voice.error}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
