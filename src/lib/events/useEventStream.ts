"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { LiveEvent } from "@/lib/events/bus";

export type EventStreamStatus = "connecting" | "open" | "unsupported";

// EventSource availability doesn't change after page load, so there's
// nothing to subscribe to — same rationale/pattern as useSpeech.ts's
// `supported` checks. useSyncExternalStore still gives hydration-safe
// behavior: the real value on the client, `false` for the server snapshot.
function subscribeNever() {
  return () => {};
}

export interface UseEventStreamOptions {
  /** Called for every real live event received over the stream. */
  onEvent?: (event: LiveEvent) => void;
}

/**
 * Client-side connection to the real live event bus (/api/events/stream —
 * see src/lib/events/bus.ts). Every event this surfaces traces back to a
 * real Event row written by recordEvent() elsewhere in the app; nothing
 * here is synthesized. Uses the browser's native EventSource, which
 * reconnects automatically on a dropped connection — `status` reflects
 * that honestly rather than latching permanently into an "offline" state.
 */
export function useEventStream(options: UseEventStreamOptions = {}): { status: EventStreamStatus } {
  const supported = useSyncExternalStore(subscribeNever, () => typeof EventSource !== "undefined", () => false);
  const [status, setStatus] = useState<EventStreamStatus>("connecting");
  const onEventRef = useRef(options.onEvent);

  useEffect(() => {
    onEventRef.current = options.onEvent;
  }, [options.onEvent]);

  useEffect(() => {
    if (!supported) return;

    const source = new EventSource("/api/events/stream");
    source.onopen = () => setStatus("open");
    source.onerror = () => setStatus("connecting"); // EventSource retries on its own
    source.onmessage = (e) => {
      try {
        onEventRef.current?.(JSON.parse(e.data) as LiveEvent);
      } catch {
        // malformed frame — drop it, the connection itself is still fine
      }
    };

    return () => {
      source.close();
    };
  }, [supported]);

  return { status: supported ? status : "unsupported" };
}
