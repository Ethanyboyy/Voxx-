/**
 * The video provider used when no real one is configured.
 *
 * No mock, for the same reason there is no mock image provider: a simulated
 * job that returns a plausible video after a delay would become an
 * ArtifactVersion and be shown to the user as their footage.
 *
 * The message names the graceful degradation the brief asks for — when video
 * is unavailable, a still concept is still worth producing — so the caller and
 * the user both learn what CAN happen, not only what cannot.
 */

import type { VideoCapability, VideoJob, VideoProvider, VideoRequest } from "@/lib/video/types";

export class UnavailableVideoProvider implements VideoProvider {
  readonly id = "unavailable";
  readonly displayName = "No video provider configured";
  readonly defaultModel = "none";
  readonly capabilities: readonly VideoCapability[] = [];
  readonly isConfigured = false;
  readonly unavailableReason: string;

  constructor(reason: string) {
    this.unavailableReason = reason;
  }

  private fail(): never {
    throw new Error(
      `Cinematic generation is unavailable: ${this.unavailableReason} ` +
        "A still concept can still be generated if an image provider is configured.",
    );
  }

  async submit(_request: VideoRequest): Promise<VideoJob> {
    this.fail();
  }

  async poll(_providerJobId: string): Promise<VideoJob> {
    this.fail();
  }
}
