/**
 * Higgsfield cinematic generation.
 *
 * ------------------------------------------------------------------------
 * READ THIS BEFORE TRUSTING THIS ADAPTER
 * ------------------------------------------------------------------------
 *
 * Higgsfield's hosts are NOT REACHABLE from this environment. Measured:
 *
 *   $ curl -o /dev/null -w "%{http_code}" https://api.higgsfield.ai/
 *   curl: (56) CONNECT tunnel failed, response 403
 *   $ curl -o /dev/null -w "%{http_code}" https://higgsfield.ai/
 *   curl: (56) CONNECT tunnel failed, response 403
 *
 * The egress proxy refuses the tunnel outright — this is not a missing key,
 * it is a network policy. The same result was recorded previously for
 * platform.higgsfield.ai in docs/3d-pipeline/MCP_DECISIONS.md.
 *
 * CONSEQUENCE, stated plainly: the request/response shapes below could NOT be
 * verified against the live service. They are written against the two-phase
 * submit/poll pattern the VideoProvider interface defines, and the field names
 * are configurable precisely because they are the part most likely to be
 * wrong. This adapter therefore requires BOTH a key and an explicit
 * acknowledgement (`VOX_HIGGSFIELD_BASE_URL`) before it will report itself
 * configured — so it cannot quietly become "connected" in an environment where
 * nobody has checked it against the real API.
 *
 * What is NOT done here, deliberately: no mock, no simulated job that returns
 * a plausible video URL after a delay, no "demo mode". A fabricated video is
 * the same class of problem as a fabricated image — it becomes an
 * ArtifactVersion and is presented to the user as their footage.
 */

import type {
  VideoCapability,
  VideoJob,
  VideoJobStatus,
  VideoProvider,
  VideoRequest,
} from "@/lib/video/types";

/** Maps a provider status string onto ours, conservatively. */
function normalizeStatus(raw: unknown): VideoJobStatus {
  const value = String(raw ?? "").toLowerCase();
  if (["completed", "complete", "succeeded", "success", "done"].includes(value)) return "COMPLETE";
  if (["failed", "error", "cancelled", "canceled"].includes(value)) return "FAILED";
  if (["queued", "pending", "created", "submitted"].includes(value)) return "QUEUED";
  if (["running", "processing", "in_progress"].includes(value)) return "RUNNING";
  // An unrecognised status is treated as still running rather than complete.
  // Guessing COMPLETE would make the caller look for a video that is not there;
  // guessing FAILED would discard a job that may still succeed.
  return "RUNNING";
}

interface HiggsfieldJobBody {
  id?: string;
  job_id?: string;
  status?: string;
  progress?: number;
  error?: string;
  message?: string;
  output?: { url?: string; duration?: number };
  result?: { url?: string; duration?: number };
  cost?: number;
}

export class HiggsfieldVideoProvider implements VideoProvider {
  readonly id = "higgsfield";
  readonly displayName = "Higgsfield";
  readonly defaultModel: string;
  readonly capabilities: readonly VideoCapability[] = [
    "IMAGE_TO_VIDEO",
    "TEXT_TO_VIDEO",
    "CAMERA_CONTROL",
    "SUBJECT_CONSISTENCY",
  ];

  private readonly apiKey: string | null;
  private readonly baseUrl: string | null;
  private readonly timeoutMs: number;

  constructor(apiKey: string | null, baseUrl: string | null, model?: string, timeoutMs = 120_000) {
    this.apiKey = apiKey && apiKey.trim().length > 0 ? apiKey.trim() : null;
    this.baseUrl = baseUrl && baseUrl.trim().length > 0 ? baseUrl.trim().replace(/\/+$/, "") : null;
    this.defaultModel = model?.trim() || "default";
    this.timeoutMs = timeoutMs;
  }

  /**
   * Requires the base URL as well as the key.
   *
   * That is not belt-and-braces: because the API shape here is unverified,
   * requiring an operator to name the endpoint explicitly is the mechanism
   * that stops this adapter from reporting itself ready in an environment
   * where nobody has confirmed it works.
   */
  get isConfigured(): boolean {
    return this.apiKey !== null && this.baseUrl !== null;
  }

  get unavailableReason(): string | null {
    if (this.apiKey === null && this.baseUrl === null) {
      return "HIGGSFIELD_API_KEY and VOX_HIGGSFIELD_BASE_URL are not set. Note: Higgsfield hosts are unreachable from some environments (403 at the egress proxy) — see MULTIMODAL_FABRIC_ARCHITECTURE.md.";
    }
    if (this.apiKey === null) return "HIGGSFIELD_API_KEY is not set.";
    return "VOX_HIGGSFIELD_BASE_URL is not set — required so an unverified endpoint shape is never assumed.";
  }

  private assertConfigured(): { key: string; base: string } {
    if (!this.apiKey || !this.baseUrl) {
      throw new Error(`Higgsfield provider is not configured — ${this.unavailableReason}`);
    }
    return { key: this.apiKey, base: this.baseUrl };
  }

  private async call(path: string, init: RequestInit): Promise<HiggsfieldJobBody> {
    const { key, base } = this.assertConfigured();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(`${base}${path}`, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
          ...(init.headers ?? {}),
        },
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => null)) as HiggsfieldJobBody | null;
      if (!response.ok) {
        const detail = body?.error ?? body?.message ?? `HTTP ${response.status}`;
        throw new Error(`Higgsfield request failed: ${String(detail).slice(0, 300)}`);
      }
      if (!body) throw new Error("Higgsfield returned a non-JSON response.");
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  private toJob(body: HiggsfieldJobBody, model: string): VideoJob {
    const status = normalizeStatus(body.status);
    return {
      providerJobId: String(body.id ?? body.job_id ?? ""),
      status,
      // Only reported when the provider actually reports it.
      progress: typeof body.progress === "number" ? body.progress : null,
      // Bytes are fetched separately by the caller; a job body carries a URL,
      // and this adapter does not download on the caller's behalf so that
      // fetching untrusted bytes stays an explicit, auditable step.
      video: null,
      error: status === "FAILED" ? String(body.error ?? body.message ?? "Generation failed.") : null,
      costUsd: typeof body.cost === "number" ? body.cost : null,
      model,
      provider: this.id,
    };
  }

  async submit(request: VideoRequest): Promise<VideoJob> {
    this.assertConfigured();
    const model = request.model?.trim() || this.defaultModel;

    const body = await this.call("/v1/generate", {
      method: "POST",
      body: JSON.stringify({
        model,
        prompt: request.prompt,
        duration: request.durationSeconds,
        aspect_ratio: request.aspectRatio,
        camera_motion: request.cameraMotion,
        // References are sent as base64 with their role preserved — a provider
        // that supports subject consistency needs to know which image is the
        // subject, and an anonymous list loses that.
        references: (request.references ?? []).map((r) => ({
          role: r.role,
          mime_type: r.mimeType,
          data: Buffer.from(r.data).toString("base64"),
        })),
        ...(request.parameters ?? {}),
      }),
    });

    return this.toJob(body, model);
  }

  async poll(providerJobId: string): Promise<VideoJob> {
    this.assertConfigured();
    const body = await this.call(`/v1/jobs/${encodeURIComponent(providerJobId)}`, { method: "GET" });
    return this.toJob(body, this.defaultModel);
  }
}
