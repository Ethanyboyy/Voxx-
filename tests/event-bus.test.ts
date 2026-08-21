import { describe, it, expect, vi } from "vitest";
import { publishEvent, subscribeToEvents, type LiveEvent } from "@/lib/events/bus";
import { recordEvent } from "@/lib/observability/events";
import { createTestUser } from "./helpers";

const sample: LiveEvent = {
  id: "evt-1",
  userId: "user-a",
  type: "test.event",
  subjectType: null,
  subjectId: null,
  payload: null,
  consequential: false,
  createdAt: new Date().toISOString(),
};

describe("event bus: publish/subscribe", () => {
  it("delivers a published event only to a subscriber for that userId", () => {
    const received: LiveEvent[] = [];
    const unsubscribe = subscribeToEvents("user-a", (e) => received.push(e));

    publishEvent(sample);
    publishEvent({ ...sample, id: "evt-2", userId: "user-b" });

    expect(received).toHaveLength(1);
    expect(received[0].id).toBe("evt-1");
    unsubscribe();
  });

  it("stops delivering events after unsubscribe", () => {
    const received: LiveEvent[] = [];
    const unsubscribe = subscribeToEvents("user-c", (e) => received.push(e));
    unsubscribe();

    publishEvent({ ...sample, userId: "user-c" });
    expect(received).toHaveLength(0);
  });

  it("supports multiple concurrent subscribers for the same user (multi-tab/device)", () => {
    const a: LiveEvent[] = [];
    const b: LiveEvent[] = [];
    const unsubA = subscribeToEvents("user-d", (e) => a.push(e));
    const unsubB = subscribeToEvents("user-d", (e) => b.push(e));

    publishEvent({ ...sample, userId: "user-d" });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    unsubA();
    unsubB();
  });
});

describe("event bus: real integration with recordEvent()", () => {
  it("recordEvent() publishes the exact row it just persisted — never a fabricated echo", async () => {
    const user = await createTestUser();
    const onEvent = vi.fn();
    const unsubscribe = subscribeToEvents(user.id, onEvent);

    const created = await recordEvent({
      userId: user.id,
      type: "test.integration_event",
      subjectType: "Task",
      subjectId: "task-123",
      payload: { note: "hello" },
    });

    expect(onEvent).toHaveBeenCalledTimes(1);
    const delivered = onEvent.mock.calls[0][0] as LiveEvent;
    expect(delivered.id).toBe(created.id);
    expect(delivered.type).toBe("test.integration_event");
    expect(delivered.subjectType).toBe("Task");
    expect(delivered.subjectId).toBe("task-123");
    expect(JSON.parse(delivered.payload!)).toEqual({ note: "hello" });
    unsubscribe();
  });

  it("a subscriber for a different user never receives another user's recordEvent()", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const onEvent = vi.fn();
    const unsubscribe = subscribeToEvents(userB.id, onEvent);

    await recordEvent({ userId: userA.id, type: "test.isolated_event" });

    expect(onEvent).not.toHaveBeenCalled();
    unsubscribe();
  });
});
