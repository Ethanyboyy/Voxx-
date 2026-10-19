import { describe, it, expect, afterEach } from "vitest";
import { getAIProvider, _resetAIProviderCache } from "@/lib/ai";
import { MockAIProvider } from "@/lib/ai/mock";
import { estimateCostUsd } from "@/lib/ai/cost";

describe("AI provider abstraction", () => {
  afterEach(() => {
    _resetAIProviderCache();
    delete process.env.VOX_COST_PER_1K_INPUT_TOKENS;
    delete process.env.VOX_COST_PER_1K_OUTPUT_TOKENS;
  });

  it("resolves the mock provider when VOX_AI_PROVIDER=mock (set for the whole test run)", () => {
    const provider = getAIProvider();
    expect(provider.id).toBe("mock");
    expect(provider).toBeInstanceOf(MockAIProvider);
  });

  it("caches the resolved provider instance", () => {
    const first = getAIProvider();
    const second = getAIProvider();
    expect(first).toBe(second);
  });

  it("generate() echoes the last user message deterministically, with usage counts", async () => {
    const provider = new MockAIProvider();
    const result = await provider.generate({
      messages: [{ role: "user", content: "hello VOX" }],
    });
    expect(result.content).toContain("hello VOX");
    expect(result.provider).toBe("mock");
    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
  });

  it("stream() yields text_delta events followed by a message_stop event", async () => {
    const provider = new MockAIProvider();
    const events = [];
    for await (const event of provider.stream({ messages: [{ role: "user", content: "stream this" }] })) {
      events.push(event);
    }
    expect(events.some((e) => e.type === "text_delta")).toBe(true);
    expect(events.at(-1)?.type).toBe("message_stop");

    const joined = events
      .filter((e) => e.type === "text_delta")
      .map((e) => (e.type === "text_delta" ? e.text : ""))
      .join("");
    expect(joined).toContain("stream this");
  });

  it("estimateCostUsd returns null without configured rates (never fabricates a price)", () => {
    expect(estimateCostUsd({ inputTokens: 1000, outputTokens: 1000 })).toBeNull();
  });

  it("estimateCostUsd computes from explicit configured rates", () => {
    process.env.VOX_COST_PER_1K_INPUT_TOKENS = "3";
    process.env.VOX_COST_PER_1K_OUTPUT_TOKENS = "15";
    const cost = estimateCostUsd({ inputTokens: 1000, outputTokens: 1000 });
    expect(cost).toBeCloseTo(18, 5);
  });
});

// ---------------------------------------------------------------------------
// Provider failure classification
// ---------------------------------------------------------------------------
//
// These exist because of a real production outage. Chat failed with "The model
// provider returned an error. Please try again" while Anthropic was returning
// HTTP 401 `invalid x-api-key` — a failure that will recur identically on
// every retry forever. The log recorded the message and discarded the status,
// the provider's error type and the request id, so establishing the cause
// needed a shell inside the running container.
//
// Driven through the real AnthropicProvider with a stubbed `fetch`, so the SDK
// builds and throws its own typed error exactly as it does in production. A
// hand-constructed error object would prove only that the switch statement
// compiles.

describe("a refused provider call is classified, not flattened", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function stubStatus(status: number, body: unknown) {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", "request-id": "req_test_fixture" },
      })) as unknown as typeof fetch;
  }

  async function streamError(status: number, body: unknown) {
    const { AnthropicProvider } = await import("@/lib/ai/anthropic");
    stubStatus(status, body);
    // An obvious fixture, never a real credential.
    const provider = new AnthropicProvider("sk-ant-fixture-not-a-real-key");
    const events = [];
    for await (const event of provider.stream({ messages: [{ role: "user", content: "hi" }] })) {
      events.push(event);
    }
    const error = events.find((e) => e.type === "error");
    if (!error || error.type !== "error") throw new Error(`expected an error event, got ${JSON.stringify(events)}`);
    return error;
  }

  it("A 401 IS A REJECTED CREDENTIAL, NOT A RETRYABLE ERROR", async () => {
    // The exact production failure, reproduced.
    const error = await streamError(401, {
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
    });
    expect(error.reason).toBe("CREDENTIAL_REJECTED");
  }, 30_000);

  it("classifies the cases that need different action differently", async () => {
    expect((await streamError(403, { type: "error", error: { type: "permission_error", message: "no" } })).reason).toBe(
      "CREDENTIAL_REJECTED"
    );
    expect((await streamError(404, { type: "error", error: { type: "not_found_error", message: "model" } })).reason).toBe(
      "MODEL_UNAVAILABLE"
    );
    expect((await streamError(429, { type: "error", error: { type: "rate_limit_error", message: "slow" } })).reason).toBe(
      "RATE_LIMITED"
    );
    expect((await streamError(500, { type: "error", error: { type: "api_error", message: "boom" } })).reason).toBe(
      "PROVIDER_UNAVAILABLE"
    );
  }, 60_000);

  it("A BILLING FAILURE IS NOT A MALFORMED REQUEST, THOUGH BOTH ARRIVE AS 400", async () => {
    // Anthropic reports an exhausted balance as a 400. Bucketing it with
    // genuine schema rejections would tell the operator to go fix a bug in
    // VOX when what they need is to add credit.
    const quota = await streamError(400, {
      type: "error",
      error: { type: "invalid_request_error", message: "Your credit balance is too low to access the API." },
    });
    expect(quota.reason).toBe("QUOTA_EXHAUSTED");

    const malformed = await streamError(400, {
      type: "error",
      error: { type: "invalid_request_error", message: "messages: at least one message is required" },
    });
    expect(malformed.reason).toBe("REQUEST_REJECTED");
  }, 60_000);

  it("the error event never carries the credential", async () => {
    const error = await streamError(401, {
      type: "error",
      error: { type: "authentication_error", message: "invalid x-api-key" },
    });
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("sk-ant-fixture-not-a-real-key");
    expect(serialized).not.toContain("fixture-not-a-real-key");
  }, 30_000);
});
