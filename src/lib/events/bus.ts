// Internal live event bus — an in-process publish/subscribe channel that
// recordEvent() (src/lib/observability/events.ts) pushes every REAL event
// into, right after it's durably written. Nothing publishes here except
// recordEvent() itself, so nothing on this channel is ever fabricated —
// nothing that couldn't already be found in the Event table.
//
// Deployment note: this is a single-process in-memory EventEmitter, which is
// correct for VOX's current deployment (fly.toml: min_machines_running = 1,
// no horizontal scaling configured) but would NOT fan out across multiple
// server instances. The transport is fully isolated behind publishEvent()/
// subscribeToEvents() specifically so a real multi-instance deployment could
// swap this module's internals for a message broker (Redis pub/sub, etc.)
// without any caller (recordEvent, the SSE route, future consumers) changing.
import { EventEmitter } from "node:events";

export interface LiveEvent {
  id: string;
  userId: string;
  type: string;
  subjectType: string | null;
  subjectId: string | null;
  payload: string | null;
  consequential: boolean;
  createdAt: string;
}

const CHANNEL = "vox.event";
const emitter = new EventEmitter();
// Many concurrent SSE connections (browser tabs/devices) are expected and
// fine — this isn't a leak signal here the way it usually is.
emitter.setMaxListeners(0);

export function publishEvent(event: LiveEvent): void {
  emitter.emit(CHANNEL, event);
}

/** Subscribes to events for one user only. Returns an unsubscribe function —
 * callers (the SSE route) MUST call it when the connection closes. */
export function subscribeToEvents(userId: string, onEvent: (event: LiveEvent) => void): () => void {
  const listener = (event: LiveEvent) => {
    if (event.userId === userId) onEvent(event);
  };
  emitter.on(CHANNEL, listener);
  return () => emitter.off(CHANNEL, listener);
}
