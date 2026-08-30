import type { GenerationCapability, GenerationProvider, GenerationRequest, GenerationResult } from "@/lib/generation/types";

/**
 * The honest default.
 *
 * When no generation toolchain is configured, this is what `getGenerationProvider()`
 * returns. It reports exactly why it cannot work and throws if asked to run.
 *
 * There is deliberately NO mock provider here, unlike src/lib/ai/. A mock AI
 * response is obviously a placeholder the moment you read it; a mock 3D asset
 * is a file that loads, renders, and looks like a real suit — it would flow
 * into LabSuit.modelUrl and be presented to the user as an inspectable object
 * with real cost and real engineering claims attached. The failure mode is not
 * symmetric, so the fallback isn't either.
 */
export class UnavailableGenerationProvider implements GenerationProvider {
  readonly id = "unavailable";
  readonly displayName = "No generation provider configured";
  readonly isConfigured = false;
  readonly capabilities: readonly GenerationCapability[] = [];
  readonly unavailableReason: string;

  constructor(reason: string) {
    this.unavailableReason = reason;
  }

  async generate(_request: GenerationRequest): Promise<GenerationResult> {
    throw new Error(`No 3D generation provider is available: ${this.unavailableReason}`);
  }
}
