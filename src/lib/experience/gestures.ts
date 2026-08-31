/**
 * Touch gesture recognition for the spatial surfaces.
 *
 * Written as a pure state machine over pointer events so it can be unit-tested
 * without a device — the alternative is gesture logic that only ever gets
 * exercised by hand on whatever phone happens to be nearby, which is how
 * long-press ends up firing on a scroll.
 *
 * The vocabulary is fixed across the product:
 *
 *   tap          select
 *   long press   inspect
 *   drag         orbit
 *   pinch        zoom
 *   double tap   isolate
 *
 * Thresholds below are the interesting part. A long press that fires at 300ms
 * competes with a tap; one at 800ms feels broken. A tap that tolerates 2px of
 * movement fails on a moving train. These numbers are the usual accessible
 * defaults, and they are named so they can be argued with.
 */

export const LONG_PRESS_MS = 500;
/** Movement beyond this (CSS px) means the user is dragging, not tapping. */
export const TAP_SLOP_PX = 10;
/** Two taps within this window, close together, are a double tap. */
export const DOUBLE_TAP_MS = 320;
export const DOUBLE_TAP_SLOP_PX = 28;
/** Below this, a two-finger scale change is noise from finger roll. */
export const PINCH_THRESHOLD = 0.02;

export type GestureName = "tap" | "double-tap" | "long-press" | "drag" | "pinch";

export interface GestureEvent {
  name: GestureName;
  x: number;
  y: number;
  /** Drag only: movement since the last emit, CSS px. */
  dx?: number;
  dy?: number;
  /** Pinch only: scale relative to the start of the pinch. */
  scale?: number;
}

interface Pointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startedAt: number;
}

export interface GestureRecognizerOptions {
  onGesture: (event: GestureEvent) => void;
  /** Injectable clock, so tests do not sleep. */
  now?: () => number;
  longPressMs?: number;
}

/**
 * Recognises the gesture set from raw pointer down/move/up.
 *
 * Deliberately does NOT own timers: `tick()` is called by the caller's frame
 * loop to fire long-press. A component that owns a render loop already has a
 * clock, and a setTimeout that survives unmount is a real leak.
 */
export class GestureRecognizer {
  private pointers = new Map<number, Pointer>();
  private lastTap: { at: number; x: number; y: number } | null = null;
  private longPressFired = false;
  private pinchStartDistance: number | null = null;
  private dragging = false;

  private readonly onGesture: (event: GestureEvent) => void;
  private readonly now: () => number;
  private readonly longPressMs: number;

  constructor(options: GestureRecognizerOptions) {
    this.onGesture = options.onGesture;
    this.now = options.now ?? (() => Date.now());
    this.longPressMs = options.longPressMs ?? LONG_PRESS_MS;
  }

  down(id: number, x: number, y: number): void {
    const at = this.now();
    this.pointers.set(id, { id, x, y, startX: x, startY: y, startedAt: at });
    this.longPressFired = false;
    this.dragging = false;
    if (this.pointers.size === 2) {
      this.pinchStartDistance = this.distance();
    }
  }

  move(id: number, x: number, y: number): void {
    const pointer = this.pointers.get(id);
    if (!pointer) return;
    const dx = x - pointer.x;
    const dy = y - pointer.y;
    pointer.x = x;
    pointer.y = y;

    // Two fingers: pinch takes over entirely. Emitting drag at the same time
    // makes the object spin while the user is only trying to zoom.
    if (this.pointers.size >= 2 && this.pinchStartDistance) {
      const scale = this.distance() / this.pinchStartDistance;
      if (Math.abs(scale - 1) > PINCH_THRESHOLD) {
        this.dragging = true; // suppresses the tap on release
        this.onGesture({ name: "pinch", x, y, scale });
      }
      return;
    }

    const travelled = Math.hypot(x - pointer.startX, y - pointer.startY);
    if (travelled > TAP_SLOP_PX) {
      this.dragging = true;
      this.onGesture({ name: "drag", x, y, dx, dy });
    }
  }

  /** Call once per frame. Fires long-press when the finger has stayed put. */
  tick(): void {
    if (this.longPressFired || this.dragging || this.pointers.size !== 1) return;
    const pointer = this.pointers.values().next().value;
    if (!pointer) return;
    if (this.now() - pointer.startedAt < this.longPressMs) return;
    if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > TAP_SLOP_PX) return;
    this.longPressFired = true;
    this.onGesture({ name: "long-press", x: pointer.x, y: pointer.y });
  }

  up(id: number): void {
    const pointer = this.pointers.get(id);
    this.pointers.delete(id);
    if (this.pointers.size < 2) this.pinchStartDistance = null;
    if (!pointer) return;

    // A gesture that already resolved does not also produce a tap.
    if (this.dragging || this.longPressFired) {
      if (this.pointers.size === 0) this.dragging = false;
      return;
    }
    if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > TAP_SLOP_PX) return;

    const at = this.now();
    const previous = this.lastTap;
    if (
      previous &&
      at - previous.at <= DOUBLE_TAP_MS &&
      Math.hypot(pointer.x - previous.x, pointer.y - previous.y) <= DOUBLE_TAP_SLOP_PX
    ) {
      this.lastTap = null;
      this.onGesture({ name: "double-tap", x: pointer.x, y: pointer.y });
      return;
    }

    this.lastTap = { at, x: pointer.x, y: pointer.y };
    this.onGesture({ name: "tap", x: pointer.x, y: pointer.y });
  }

  /** Pointer left the surface or the gesture was interrupted. */
  cancel(id: number): void {
    this.pointers.delete(id);
    if (this.pointers.size < 2) this.pinchStartDistance = null;
    if (this.pointers.size === 0) {
      this.dragging = false;
      this.longPressFired = false;
    }
  }

  private distance(): number {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }
}

/**
 * Minimum comfortable touch target, CSS px.
 *
 * Exported rather than sprinkled through class names so a control that is too
 * small is a lint-able mistake instead of a matter of taste.
 */
export const MIN_TOUCH_TARGET_PX = 44;
