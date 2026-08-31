/**
 * Provider-agnostic image generation and editing.
 *
 * Same shape as AIProvider / ResearchProvider / EmbeddingProvider /
 * GenerationProvider (CLAUDE.md rule 2): never call an image vendor SDK
 * outside src/lib/image/.
 *
 * `isConfigured` carries the same weight it does in src/lib/generation/, and
 * for the same reason. A provider whose credentials are absent reports false
 * and throws on use. It must NEVER return a fabricated image — a placeholder
 * that reaches an Artifact row is indistinguishable, downstream, from a real
 * generation, and would be presented to the user as their concept.
 *
 * Per CLAUDE.md rule 6, any provider here that sends user content to a third
 * party is strictly opt-in: absent by default, gated on an explicit env var,
 * and documented in both .env.example and SECURITY.md.
 */

export type ImageCapability =
  /** Make an image from text alone. */
  | "TEXT_TO_IMAGE"
  /** Make an image conditioned on one or more reference images. */
  | "IMAGE_TO_IMAGE"
  /** Modify a given image, preserving its identity where asked. */
  | "IMAGE_EDIT";

/** An input image, as bytes. Never a URL: a URL is someone else's server. */
export interface ImageInput {
  /** Raw bytes. Callers read these from the artifact store, not the network. */
  data: Uint8Array;
  mimeType: string;
}

export interface ImageRequest {
  prompt: string;
  /**
   * Reference images. Present for IMAGE_TO_IMAGE and IMAGE_EDIT; a provider
   * that lacks the capability must reject rather than silently ignore them —
   * quietly dropping the reference produces a plausible image of the wrong
   * thing, which is worse than an error.
   */
  references?: ImageInput[];
  /** How many images to return. Providers may return fewer; never more. */
  count?: number;
  /** Provider-specific model id. Falls back to the provider's default. */
  model?: string;
  /** Free-form, provider-specific. Recorded verbatim on the artifact version. */
  parameters?: Record<string, string | number | boolean>;
}

export interface GeneratedImage {
  data: Uint8Array;
  mimeType: string;
  /** Pixel dimensions when the provider reports or they can be parsed. */
  width: number | null;
  height: number | null;
}

export interface ImageResult {
  images: GeneratedImage[];
  /** The model that actually served the call, which may differ from the request. */
  model: string;
  provider: string;
  /** Measured wall clock, not estimated. */
  durationMs: number;
  /**
   * Provider-reported cost in USD, when the provider actually reports one.
   * NULL rather than a guess: an invented number in a budget ledger is worse
   * than an absent one, because it will be summed.
   */
  costUsd: number | null;
}

export interface ImageProvider {
  readonly id: string;
  readonly displayName: string;
  readonly defaultModel: string;
  /** True only when real credentials are present. Never aspirational. */
  readonly isConfigured: boolean;
  readonly capabilities: readonly ImageCapability[];
  /** Why unavailable, in terms the user can act on. Null when configured. */
  readonly unavailableReason: string | null;

  /** Runs a generation. Throws if `isConfigured` is false. */
  generate(request: ImageRequest): Promise<ImageResult>;
}
