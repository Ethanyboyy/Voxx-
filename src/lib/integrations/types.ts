import type { ConnectionCategory, ConnectionService } from "@/generated/prisma/enums";

/**
 * Provider-agnostic external-integration abstraction — same shape as
 * AIProvider/ResearchProvider/EmbeddingProvider (see CLAUDE.md). Never call a
 * vendor OAuth/API client outside src/lib/integrations/.
 *
 * `isConfigured` is the technical enforcement (not just a policy promise)
 * that a connection can't actually go live until real credentials are
 * supplied: every provider in this codebase today is a StubConnectionProvider
 * that reports `isConfigured: false` and throws on any connect attempt.
 */
export interface ConnectionProvider {
  readonly service: ConnectionService;
  readonly isConfigured: boolean;

  /** Builds the vendor authorization URL the user would be sent to. Throws if not configured. */
  getAuthorizationUrl(state: string): string;

  /** Exchanges an OAuth callback code for credentials. Throws if not configured. */
  exchangeCode(code: string): Promise<{ payload: Record<string, unknown>; expiresAt?: Date }>;
}

export interface CatalogEntry {
  service: ConnectionService;
  category: ConnectionCategory;
  displayName: string;
  description: string;
  /** Permission capability key for read access. */
  readCapability: string;
  /** Permission capability key for write access, or null if the service has no write mode. */
  writeCapability: string | null;
  /** Env vars a real provider implementation would need — informational only. */
  requiredEnvVars: string[];
  /** True by default recommendation posture (e.g. financial/health start read-only). */
  writeEnabledByDefault: boolean;
  /** Short note surfaced in the UI about current buildability (e.g. "no public API"). */
  notes?: string;
}
