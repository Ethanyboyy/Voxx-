import { db } from "@/lib/db";

/**
 * Unauthenticated liveness/readiness probe for the deployment platform
 * (e.g. Fly.io's health checks). Verifies the database is actually
 * reachable, not just that the process is up — a stuck/corrupt SQLite
 * connection should fail health checks so the platform restarts the
 * instance rather than serving requests that will all 500. Returns only a
 * status string — no version info, no environment details, nothing an
 * unauthenticated caller shouldn't see.
 */
export async function GET() {
  try {
    await db.$queryRawUnsafe("SELECT 1");
    return Response.json({ status: "ok" }, { status: 200 });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
