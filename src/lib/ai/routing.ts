/**
 * Minimal multi-model routing foundation (§38 of the Phase 3/4 directive).
 * Not a new provider abstraction — reuses the existing AIProvider.generate()
 * `model` override (src/lib/ai/types.ts), which already exists and already
 * lets any call site pass a specific model id. This just gives job types a
 * name and an env var, so routing is configuration, not new plumbing.
 *
 * Unset env vars fall back to the provider's own defaultModel — zero cost
 * change out of the box, per the directive's cost-consciousness rule (§39).
 */
export type ModelJob = "FAST" | "REASONING";

export function modelForJob(job: ModelJob): string | undefined {
  switch (job) {
    case "FAST":
      return process.env.VOX_FAST_MODEL || undefined;
    case "REASONING":
      return process.env.VOX_REASONING_MODEL || undefined;
    default:
      return undefined;
  }
}
