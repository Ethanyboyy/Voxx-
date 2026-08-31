import { HiggsfieldVideoProvider } from "@/lib/video/higgsfield";
import { UnavailableVideoProvider } from "@/lib/video/unavailable";
import type { VideoProvider } from "@/lib/video/types";

export type {
  VideoCapability,
  VideoJob,
  VideoJobStatus,
  VideoProvider,
  VideoReference,
  VideoRequest,
} from "@/lib/video/types";
export { HiggsfieldVideoProvider } from "@/lib/video/higgsfield";
export { UnavailableVideoProvider } from "@/lib/video/unavailable";

let cached: VideoProvider | null = null;

/**
 * Resolves the active video provider.
 *
 * Higgsfield when both HIGGSFIELD_API_KEY and VOX_HIGGSFIELD_BASE_URL are set;
 * otherwise a provider that explicitly says why it cannot run. Requiring the
 * base URL as well as the key is deliberate — see HiggsfieldVideoProvider for
 * why an unverified endpoint shape must not be assumed.
 */
export function getVideoProvider(): VideoProvider {
  if (cached) return cached;

  const higgsfield = new HiggsfieldVideoProvider(
    process.env.HIGGSFIELD_API_KEY ?? null,
    process.env.VOX_HIGGSFIELD_BASE_URL ?? null,
    process.env.VOX_HIGGSFIELD_MODEL,
  );
  cached = higgsfield.isConfigured
    ? higgsfield
    : new UnavailableVideoProvider(higgsfield.unavailableReason ?? "no video provider configured");
  return cached;
}

/** Test-only hook to reset the cached provider between specs. */
export function _resetVideoProviderCache(): void {
  cached = null;
}
