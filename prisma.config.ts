import path from "node:path";
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

/**
 * `file:./relative/path` SQLite URLs are resolved differently by the CLI
 * (relative to schema.prisma) and by driver adapters at runtime (relative to
 * process.cwd()). We pin both to an absolute path derived from cwd so the
 * CLI and the app always talk to the same database file.
 */
function resolveSqliteUrl(raw: string): string {
  const prefix = "file:";
  if (!raw.startsWith(prefix)) return raw;
  const target = raw.slice(prefix.length);
  const absolute = path.isAbsolute(target) ? target : path.resolve(process.cwd(), target);
  return prefix + absolute;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: resolveSqliteUrl(env("DATABASE_URL")),
  },
});
