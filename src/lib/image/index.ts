import { GeminiImageProvider } from "@/lib/image/gemini";
import { UnavailableImageProvider } from "@/lib/image/unavailable";
import type { ImageProvider } from "@/lib/image/types";

export type {
  GeneratedImage,
  ImageCapability,
  ImageInput,
  ImageProvider,
  ImageRequest,
  ImageResult,
} from "@/lib/image/types";
export { GeminiImageProvider } from "@/lib/image/gemini";
export { UnavailableImageProvider } from "@/lib/image/unavailable";

let cached: ImageProvider | null = null;

/**
 * Resolves the active image provider.
 *
 * Gemini when GOOGLE_API_KEY is present; otherwise a provider that explicitly
 * says why it cannot run. There is no mock fallback — see
 * UnavailableImageProvider for why a fabricated image is a different class of
 * problem from a fabricated text completion.
 *
 * A second image provider would be added here gated on its own env var, and
 * the router's `available` map is what lets it be preferred or skipped without
 * any caller changing.
 */
export function getImageProvider(): ImageProvider {
  if (cached) return cached;

  const gemini = new GeminiImageProvider(
    process.env.GOOGLE_API_KEY ?? null,
    process.env.VOX_GEMINI_IMAGE_MODEL,
  );
  cached = gemini.isConfigured
    ? gemini
    : new UnavailableImageProvider(gemini.unavailableReason ?? "no image provider configured");
  return cached;
}

/** Test-only hook to reset the cached provider between specs. */
export function _resetImageProviderCache(): void {
  cached = null;
}
