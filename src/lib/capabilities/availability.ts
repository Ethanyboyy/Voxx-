/**
 * What VOX can actually do right now.
 *
 * The router takes availability as an input rather than resolving providers
 * itself, so that routing stays a pure, testable function. This module is the
 * bridge: it asks each provider whether it is configured and reports the
 * answer in the shape the router consumes.
 *
 * `isConfigured` is the single source of truth, which is why every provider
 * exposes it. A capability with no configured provider is one the router will
 * never plan, so the failure surfaces at routing time — where it can degrade
 * the plan and say so — rather than three steps in, after money has been spent
 * on the earlier stages.
 */

import { getImageProvider } from "@/lib/image";
import { getVideoProvider } from "@/lib/video";
import { getGenerationProvider } from "@/lib/generation";
import type { Capability } from "@/lib/capabilities/types";

export interface ProviderStatus {
  capability: Capability;
  providerId: string;
  displayName: string;
  configured: boolean;
  /** Actionable reason, e.g. "GOOGLE_API_KEY is not set." Null when configured. */
  reason: string | null;
}

/**
 * One row per externally-provided capability.
 *
 * EXECUTION, MEMORY and RESEARCH are deliberately absent: they are served by
 * subsystems that are always present (the agent executor, the memory service,
 * the research provider with its own mock fallback), so reporting them here
 * would imply a configuration switch that does not exist.
 */
export function getProviderStatuses(): ProviderStatus[] {
  const image = getImageProvider();
  const video = getVideoProvider();
  const model3d = getGenerationProvider();

  return [
    {
      capability: "IMAGE_GENERATION",
      providerId: image.id,
      displayName: image.displayName,
      configured: image.isConfigured,
      reason: image.unavailableReason,
    },
    {
      capability: "IMAGE_EDIT",
      providerId: image.id,
      displayName: image.displayName,
      // Editing needs the capability as well as a configured provider — a
      // text-to-image-only provider cannot honour a reference, and silently
      // ignoring one produces a plausible image of the wrong thing.
      configured: image.isConfigured && image.capabilities.includes("IMAGE_EDIT"),
      reason: image.isConfigured
        ? image.capabilities.includes("IMAGE_EDIT")
          ? null
          : `${image.displayName} cannot edit images.`
        : image.unavailableReason,
    },
    {
      capability: "VIDEO_GENERATION",
      providerId: video.id,
      displayName: video.displayName,
      configured: video.isConfigured,
      reason: video.unavailableReason,
    },
    {
      capability: "MODEL_3D",
      providerId: model3d.id,
      displayName: model3d.displayName,
      configured: model3d.isConfigured,
      reason: model3d.unavailableReason,
    },
  ];
}

/** The availability map the router consumes. */
export function getCapabilityAvailability(): Partial<Record<Capability, boolean>> {
  const map: Partial<Record<Capability, boolean>> = {};
  for (const status of getProviderStatuses()) {
    map[status.capability] = status.configured;
  }
  return map;
}
