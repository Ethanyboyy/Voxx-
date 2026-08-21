"use client";

import { useSpeechToText, useTextToSpeech } from "@/lib/voice/useSpeech";

/**
 * Unified voice status vocabulary. "processing" is included for a future
 * provider that genuinely has a distinct transcribing/buffering phase (e.g.
 * a server-streaming STT service) — the current browser provider never
 * emits it, since the Web Speech API has no such phase; that's an honest
 * omission, not a placeholder pretending to be implemented.
 */
export type VoiceStatus = "offline" | "ready" | "listening" | "processing" | "speaking" | "error";

export interface VoiceState {
  status: VoiceStatus;
  /** Which concrete implementation is backing this hook right now. Only
   * "browser" exists today (the native Web Speech API, client-side only —
   * see useSpeech.ts) — "none" when neither STT nor TTS is available in
   * this browser. A future remote provider would add another tag here. */
  provider: "browser" | "none";
  sttSupported: boolean;
  ttsSupported: boolean;
  listening: boolean;
  speaking: boolean;
  interimTranscript: string;
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  speak: (text: string) => void;
  stopSpeaking: () => void;
}

/**
 * The one entry point VOX's UI should use for voice — speech input and
 * output are the same capability whether they're driving chat, a future
 * Field/HUD mode, or anywhere else, per the "voice uses the same
 * orchestration as text, not a separate system" rule. Today this is a thin
 * wrapper over the real browser Web Speech API hooks (useSpeech.ts); the
 * point of the wrapper is the stable contract (VoiceState) a future
 * non-browser provider (e.g. a server-streaming STT/TTS service) could
 * satisfy without every caller changing.
 */
export function useVoice(onFinalTranscript: (text: string) => void): VoiceState {
  const stt = useSpeechToText(onFinalTranscript);
  const tts = useTextToSpeech();

  const provider: "browser" | "none" = stt.supported || tts.supported ? "browser" : "none";
  const status: VoiceStatus =
    provider === "none"
      ? "offline"
      : stt.error
        ? "error"
        : stt.listening
          ? "listening"
          : tts.speaking
            ? "speaking"
            : "ready";

  return {
    status,
    provider,
    sttSupported: stt.supported,
    ttsSupported: tts.supported,
    listening: stt.listening,
    speaking: tts.speaking,
    interimTranscript: stt.interimTranscript,
    error: stt.error,
    startListening: stt.start,
    stopListening: stt.stop,
    speak: tts.speak,
    stopSpeaking: tts.stop,
  };
}
