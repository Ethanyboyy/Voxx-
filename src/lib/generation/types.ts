/**
 * Provider-agnostic 3D asset generation — the same shape as AIProvider /
 * ResearchProvider / EmbeddingProvider / ConnectionProvider (see CLAUDE.md
 * rule 2). Never call a generation vendor SDK outside src/lib/generation/.
 *
 * The reason this abstraction exists at all: every hosted 3D generation
 * service is currently unreachable from this environment (organizational
 * egress policy — see docs/3d-pipeline/MCP_DECISIONS.md for the measured
 * evidence). Rather than hardcode that limitation into the Suit Bay, the
 * pipeline is written against an interface, so the day one of those services
 * becomes reachable it is a single new module and nothing else changes.
 *
 * `isConfigured` is the technical enforcement, not a policy promise: a
 * provider whose real credentials/toolchain are absent reports false and
 * throws on use. It must NEVER return a fabricated asset — an invented GLB
 * path would flow straight into LabSuit.modelUrl and be presented to the
 * user as a real, inspectable object.
 */

/** What a provider can actually do. Deliberately narrow. */
export type GenerationCapability =
  /** Author geometry deterministically from a committed script. */
  | "SCRIPTED_GEOMETRY"
  /** Produce raster renders of a scene (QA sheets, previews, turntables). */
  | "RENDER"
  /** Synthesise a mesh from a text prompt. No local provider can do this. */
  | "TEXT_TO_3D"
  /** Synthesise a mesh from reference images. */
  | "IMAGE_TO_3D";

export interface GenerationRequest {
  /** Stable suit id — also the asset directory name under public/models/suits/. */
  suitId: string;
  /**
   * The build recipe: which committed authoring script to run, and the
   * parameters to run it with. Deliberately not free-text: a closed set of
   * scripts is auditable in a way "run this Python" is not.
   */
  recipe: string;
  parameters?: Record<string, string | number | boolean>;
  /** Optional reference images, for providers with IMAGE_TO_3D. */
  referenceImagePaths?: string[];
}

export interface GenerationResult {
  /** Absolute path on disk to the produced .glb. */
  glbPath: string;
  /** Public URL the app can store in LabSuit.modelUrl. */
  modelUrl: string;
  /** QA render paths, if the provider produced any. */
  renderPaths: string[];
  /** Wall-clock duration, measured — not estimated. */
  durationMs: number;
  /** Provider-reported log lines, for the Event row that records the run. */
  log: string[];
}

export interface GenerationProvider {
  readonly id: string;
  readonly displayName: string;
  /**
   * True only when this provider's real toolchain/credentials are actually
   * present. A provider may not report true because it *could* work in
   * principle — see CLAUDE.md rule 10's posture on isConfigured.
   */
  readonly isConfigured: boolean;
  readonly capabilities: readonly GenerationCapability[];
  /**
   * Why this provider is unavailable, in terms the user can act on
   * ("BLENDER_PYTHON not set", "host unreachable"). Null when configured.
   */
  readonly unavailableReason: string | null;

  /** Runs a generation. Throws if `isConfigured` is false. */
  generate(request: GenerationRequest): Promise<GenerationResult>;
}
