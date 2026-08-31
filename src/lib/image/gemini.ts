/**
 * Google Gemini image generation ("Nano Banana"), via the Generative Language
 * REST API.
 *
 * REST rather than @google/genai deliberately. The SDK is a large dependency
 * whose surface changes between minors, and the only thing needed here is one
 * POST that returns inline base64 image parts. Calling the documented HTTP
 * endpoint directly keeps the vendor coupling to a single fetch inside this
 * file — which is exactly what CLAUDE.md rule 2 asks for — and removes a whole
 * class of "the SDK's types changed" build breakage.
 *
 * REACHABILITY, MEASURED. From this environment:
 *
 *   $ curl "https://generativelanguage.googleapis.com/v1beta/models?key=NONE"
 *   {"error":{"code":400,"message":"API key not valid...", ...}}
 *
 * A structured API error means TLS completed and the service answered, so this
 * adapter is blocked only on a key — unlike the video provider, whose host the
 * egress proxy refuses outright. See MULTIMODAL_FABRIC_ARCHITECTURE.md §2.
 *
 * THIRD-PARTY DATA FLOW. This provider sends prompts and any reference images
 * to Google. Per CLAUDE.md rule 6 it is therefore absent by default, gated on
 * GOOGLE_API_KEY, and documented in .env.example and SECURITY.md.
 */

import type {
  GeneratedImage,
  ImageCapability,
  ImageProvider,
  ImageRequest,
  ImageResult,
} from "@/lib/image/types";

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta";

/**
 * The model id is configurable because Google's image model names move faster
 * than this repository will. `VOX_GEMINI_IMAGE_MODEL` overrides it; the
 * default is the current image-capable Gemini model. An unknown id produces a
 * real 404 from the API, which surfaces as a normal provider failure with
 * Google's own message — the honest outcome, and better than this module
 * pretending to know which ids exist.
 */
const DEFAULT_MODEL = "gemini-2.5-flash-image";

interface InlineDataPart {
  inlineData?: { mimeType?: string; data?: string };
  inline_data?: { mimeType?: string; mime_type?: string; data?: string };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: InlineDataPart[] } }[];
  promptFeedback?: { blockReason?: string };
  error?: { message?: string; status?: string };
}

function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString("base64");
}

/** Reads an inline image part under either the camelCase or snake_case key. */
function readInlinePart(part: InlineDataPart): { mimeType: string; data: string } | null {
  const inline = part.inlineData ?? part.inline_data;
  if (!inline?.data) return null;
  const mimeType = inline.mimeType ?? (inline as { mime_type?: string }).mime_type;
  if (!mimeType || !mimeType.startsWith("image/")) return null;
  return { mimeType, data: inline.data };
}

export class GeminiImageProvider implements ImageProvider {
  readonly id = "gemini";
  readonly displayName = "Google Gemini (Nano Banana)";
  readonly defaultModel: string;
  readonly capabilities: readonly ImageCapability[] = ["TEXT_TO_IMAGE", "IMAGE_TO_IMAGE", "IMAGE_EDIT"];

  private readonly apiKey: string | null;
  private readonly timeoutMs: number;

  constructor(apiKey: string | null, model?: string, timeoutMs = 120_000) {
    this.apiKey = apiKey && apiKey.trim().length > 0 ? apiKey.trim() : null;
    this.defaultModel = model?.trim() || DEFAULT_MODEL;
    this.timeoutMs = timeoutMs;
  }

  get isConfigured(): boolean {
    return this.apiKey !== null;
  }

  get unavailableReason(): string | null {
    return this.isConfigured ? null : "GOOGLE_API_KEY is not set.";
  }

  async generate(request: ImageRequest): Promise<ImageResult> {
    if (!this.apiKey) {
      // Throwing rather than returning an empty result: a caller that got back
      // zero images with no error would reasonably record an artifact with
      // nothing in it.
      throw new Error(`Gemini image provider is not configured — ${this.unavailableReason}`);
    }

    const model = request.model?.trim() || this.defaultModel;
    const parts: unknown[] = [{ text: request.prompt }];
    for (const reference of request.references ?? []) {
      parts.push({ inlineData: { mimeType: reference.mimeType, data: toBase64(reference.data) } });
    }

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${ENDPOINT}/models/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Header rather than a query parameter, so the key cannot end up in
          // a proxy access log or an error string containing the URL.
          "x-goog-api-key": this.apiKey,
        },
        body: JSON.stringify({ contents: [{ role: "user", parts }] }),
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Gemini image request failed: ${message}`);
    } finally {
      clearTimeout(timer);
    }

    const durationMs = Date.now() - started;
    const body = (await response.json().catch(() => null)) as GeminiResponse | null;

    if (!response.ok) {
      // Google's own message is more useful than anything invented here, but
      // it is truncated: an API error body can be long and ends up in an
      // Event payload.
      const detail = body?.error?.message ?? `HTTP ${response.status}`;
      throw new Error(`Gemini image generation failed: ${detail.slice(0, 300)}`);
    }

    if (body?.promptFeedback?.blockReason) {
      throw new Error(`Gemini declined the prompt: ${body.promptFeedback.blockReason}`);
    }

    const images: GeneratedImage[] = [];
    for (const candidate of body?.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        const inline = readInlinePart(part);
        if (!inline) continue;
        images.push({
          data: new Uint8Array(Buffer.from(inline.data, "base64")),
          mimeType: inline.mimeType,
          // Left null on purpose. The API does not report dimensions, and the
          // artifact store reads them from the file header — which is the
          // measurement, not a guess.
          width: null,
          height: null,
        });
        if (request.count && images.length >= request.count) break;
      }
    }

    if (images.length === 0) {
      // A 200 with no image part is a real, observed outcome (the model
      // answered in text). Treating it as success would create an empty
      // artifact; it is a failure of this request.
      throw new Error("Gemini returned no image data for this prompt.");
    }

    return {
      images,
      model,
      provider: this.id,
      durationMs,
      // The API does not return a per-call price, and inventing one would put
      // a fabricated number into the budget ledger where it would be summed.
      costUsd: null,
    };
  }
}
