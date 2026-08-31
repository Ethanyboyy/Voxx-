/**
 * The image provider used when no real one is configured.
 *
 * There is deliberately NO mock image provider, and the distinction matters.
 * `src/lib/ai/mock.ts` exists because a fabricated text completion is
 * obviously fabricated the moment you read it — it says so. A fabricated
 * IMAGE is not: a placeholder PNG flows into an ArtifactVersion, gets a
 * lineage edge, appears in the Lab, and is indistinguishable from a real
 * generation to everything downstream, including the user.
 *
 * This is the same reasoning src/lib/generation/unavailable.ts records for 3D
 * assets, and it applies with more force here because images are cheap enough
 * to produce in bulk.
 */

import type { ImageCapability, ImageProvider, ImageRequest, ImageResult } from "@/lib/image/types";

export class UnavailableImageProvider implements ImageProvider {
  readonly id = "unavailable";
  readonly displayName = "No image provider configured";
  readonly defaultModel = "none";
  readonly capabilities: readonly ImageCapability[] = [];
  readonly isConfigured = false;
  readonly unavailableReason: string;

  constructor(reason: string) {
    this.unavailableReason = reason;
  }

  async generate(_request: ImageRequest): Promise<ImageResult> {
    throw new Error(
      `Image generation is unavailable: ${this.unavailableReason}. ` +
        "Set GOOGLE_API_KEY to enable it. VOX will not return a placeholder image.",
    );
  }
}
