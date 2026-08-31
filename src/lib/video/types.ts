/**
 * Provider-agnostic cinematic / video generation.
 *
 * Same contract as src/lib/image/ and src/lib/generation/ (CLAUDE.md rule 2):
 * never call a video vendor SDK outside src/lib/video/.
 *
 * Video generation is asynchronous almost everywhere — a call starts a job and
 * a later call collects it — so this interface is explicitly two-phase rather
 * than pretending a single awaited call is enough. A provider that happens to
 * be synchronous simply returns a job that is already COMPLETE.
 */

export type VideoCapability =
  /** Animate a still image into a shot. */
  | "IMAGE_TO_VIDEO"
  /** Generate a shot from text alone. */
  | "TEXT_TO_VIDEO"
  /** Explicit camera direction (push, orbit, crane) as a first-class input. */
  | "CAMERA_CONTROL"
  /** Keep a subject consistent across shots. */
  | "SUBJECT_CONSISTENCY"
  /** More than one shot, cut together. */
  | "MULTI_SHOT";

export interface VideoReference {
  data: Uint8Array;
  mimeType: string;
  /**
   * What this reference is FOR. A provider that supports SUBJECT_CONSISTENCY
   * needs to know which image is the subject and which is the environment;
   * collapsing them into one anonymous list loses that.
   */
  role: "subject" | "start_frame" | "style" | "environment";
}

export interface VideoRequest {
  prompt: string;
  references?: VideoReference[];
  /** Requested duration. Providers clamp to what they support. */
  durationSeconds?: number;
  aspectRatio?: string;
  /** Plain-language camera direction, when the provider supports it. */
  cameraMotion?: string;
  model?: string;
  parameters?: Record<string, string | number | boolean>;
}

export type VideoJobStatus = "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED";

export interface VideoJob {
  /** The provider's own job id — recorded so a run is reconstructible. */
  providerJobId: string;
  status: VideoJobStatus;
  /** 0-1 when the provider reports it; null when it does not. Never invented. */
  progress: number | null;
  /** Present only when COMPLETE. */
  video: { data: Uint8Array; mimeType: string; durationSeconds: number | null } | null;
  /** Present only when FAILED. */
  error: string | null;
  costUsd: number | null;
  model: string;
  provider: string;
}

export interface VideoProvider {
  readonly id: string;
  readonly displayName: string;
  readonly defaultModel: string;
  readonly isConfigured: boolean;
  readonly capabilities: readonly VideoCapability[];
  readonly unavailableReason: string | null;

  /** Starts a job. Throws if `isConfigured` is false. */
  submit(request: VideoRequest): Promise<VideoJob>;
  /** Polls a job. Throws if `isConfigured` is false. */
  poll(providerJobId: string): Promise<VideoJob>;
}
