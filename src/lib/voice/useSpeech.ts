"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Minimal ambient types for the (non-standardized, webkit-prefixed on most
 * browsers) SpeechRecognition API — not in lib.dom.d.ts. Only the surface
 * this hook actually uses.
 */
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}
interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

const ERROR_MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. Allow it for this site and try again.",
  "no-speech": "Didn't catch any speech — try again.",
  "audio-capture": "No microphone was found.",
  network: "Speech recognition needs a network connection — check your connection and try again.",
  aborted: "Listening was cancelled.",
};
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Real speech-to-text via the browser's native SpeechRecognition — no
 * server round-trip, no new dependency, no secret. Support varies by
 * browser (solid in Chrome/Edge/Safari, absent in Firefox as of this
 * writing); `supported` reflects that honestly so callers can disable the
 * affordance rather than pretend it works everywhere.
 */
export function useSpeechToText(onFinalTranscript: (text: string) => void) {
  const [supported] = useState(() => getRecognitionCtor() !== null);
  const [listening, setListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(onFinalTranscript);

  useEffect(() => {
    onFinalRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  useEffect(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          onFinalRef.current(result[0].transcript.trim());
          setInterimTranscript("");
        } else {
          interim += result[0].transcript;
        }
      }
      if (interim) setInterimTranscript(interim);
    };
    recognition.onerror = (event) => {
      setListening(false);
      setError(ERROR_MESSAGES[event.error] ?? `Microphone error: ${event.error}`);
    };
    recognition.onend = () => {
      setListening(false);
      setInterimTranscript("");
    };
    recognitionRef.current = recognition;
    return () => {
      recognition.stop();
    };
  }, []);

  const start = useCallback(() => {
    if (!recognitionRef.current || listening) return;
    setError(null);
    setListening(true);
    try {
      recognitionRef.current.start();
    } catch {
      setListening(false);
      setError("Couldn't start listening — try again.");
    }
  }, [listening]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
  }, []);

  return { supported, listening, interimTranscript, error, start, stop };
}

/**
 * Real text-to-speech via the browser's native SpeechSynthesis. Same
 * honesty rule: `supported` reflects actual API availability.
 */
export function useTextToSpeech() {
  const [supported] = useState(() => typeof window !== "undefined" && "speechSynthesis" in window);
  const [speaking, setSpeaking] = useState(false);

  const speak = useCallback(
    (text: string) => {
      if (!supported || !text.trim()) return;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.onstart = () => setSpeaking(true);
      utterance.onend = () => setSpeaking(false);
      utterance.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(utterance);
    },
    [supported]
  );

  const stop = useCallback(() => {
    if (!supported) return;
    window.speechSynthesis.cancel();
    setSpeaking(false);
  }, [supported]);

  useEffect(() => {
    return () => {
      if (supported) window.speechSynthesis.cancel();
    };
  }, [supported]);

  return { supported, speaking, speak, stop };
}
