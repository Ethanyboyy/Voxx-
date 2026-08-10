import path from "node:path";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * `file:./relative` SQLite URLs resolve relative to process.cwd() here.
 * Kept in sync with the resolution strategy in prisma.config.ts so the CLI
 * and the running app always use the same database file.
 */
function resolveSqliteUrl(raw: string): string {
  const prefix = "file:";
  if (!raw.startsWith(prefix)) return raw;
  const target = raw.slice(prefix.length);
  // Not a dynamic import/require — just resolving a config string to an
  // absolute path, so this doesn't need Turbopack's filesystem tracing.
  const absolute = path.isAbsolute(target)
    ? target
    : path.resolve(/* turbopackIgnore: true */ process.cwd(), target);
  return prefix + absolute;
}

function createPrismaClient() {
  const url = resolveSqliteUrl(process.env.DATABASE_URL ?? "file:./prisma/dev.db");
  const adapter = new PrismaBetterSqlite3({ url });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

declare global {
  var __voxPrisma: PrismaClient | undefined;
}

// Reuse the client across hot reloads in dev so we don't exhaust SQLite
// connections; a fresh client per process in production/test.
const isNewClient = !globalThis.__voxPrisma;
export const db = globalThis.__voxPrisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalThis.__voxPrisma = db;
}

// WAL mode lets readers proceed concurrently with a writer instead of
// blocking on SQLite's default rollback-journal exclusive lock — matters
// once phone and laptop can both have requests in flight against the same
// always-on instance. Safe to set unconditionally: WAL is a durable,
// persistent setting written into the database file itself.
if (isNewClient) {
  db.$executeRawUnsafe("PRAGMA journal_mode=WAL;").catch((error) => {
    console.error("Failed to enable SQLite WAL mode:", error);
  });
}
