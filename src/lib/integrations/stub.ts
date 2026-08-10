import type { ConnectionService } from "@/generated/prisma/enums";
import type { ConnectionProvider } from "@/lib/integrations/types";
import { getCatalogEntry } from "@/lib/integrations/catalog";

/**
 * Generic provider used for every service today. Reports `isConfigured:
 * false` unless every env var the catalog lists for this service is present
 * — and even then, this class never performs a real OAuth exchange, it just
 * throws a clear "not implemented" error. This is the procedural guarantee
 * (not just a policy statement) that no connection can reach CONNECTED in
 * this codebase: real per-vendor providers are a documented future
 * extension point, not built in this pass.
 */
export class StubConnectionProvider implements ConnectionProvider {
  readonly service: ConnectionService;
  readonly isConfigured: boolean;

  constructor(service: ConnectionService) {
    this.service = service;
    const entry = getCatalogEntry(service);
    const requiredEnvVars = entry?.requiredEnvVars ?? [];
    this.isConfigured = requiredEnvVars.length > 0 && requiredEnvVars.every((name) => Boolean(process.env[name]));
  }

  getAuthorizationUrl(_state: string): string {
    throw new Error(
      `${this.service} is not configured. No real OAuth client is registered yet — this is a scaffolded connection only.`
    );
  }

  async exchangeCode(_code: string): Promise<{ payload: Record<string, unknown>; expiresAt?: Date }> {
    throw new Error(
      `${this.service} is not configured. No real OAuth client is registered yet — this is a scaffolded connection only.`
    );
  }
}

export function getConnectionProvider(service: ConnectionService): ConnectionProvider {
  return new StubConnectionProvider(service);
}
