import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { checkRateLimit } from "@/lib/security/rate-limit";

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const AUTH_PATHS = new Set(["/api/auth/login", "/api/auth/register"]);
const AUTH_RATE_LIMIT = 10;
const AUTH_RATE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Compares only host (not scheme) between Origin/Referer and the request's
 * own Host header. Deliberately host-only: behind a TLS-terminating proxy
 * (Fly.io's edge, Cloudflare, ...) the connection Next.js actually sees is
 * often plain HTTP even though the browser's Origin is https:, so a
 * scheme-inclusive comparison would false-positive-reject legitimate
 * same-origin requests. Host is reliably forwarded unchanged.
 */
function isSameOrigin(request: NextRequest): boolean {
  const expectedHost = request.headers.get("host") ?? request.nextUrl.host;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === expectedHost;
    } catch {
      return false;
    }
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === expectedHost;
    } catch {
      return false;
    }
  }
  // No Origin and no Referer on a mutating request is not how a browser
  // (VOX's only real client) behaves — reject rather than assume same-origin.
  return false;
}

/**
 * Single choke point for two cross-cutting protections, run before every
 * API request:
 *  - CSRF: the sameSite=lax session cookie already blocks the classic
 *    cross-site form-post attack, but this adds an explicit, defense-in-
 *    depth Origin/Referer check on every state-changing API call rather
 *    than relying on cookie behavior alone.
 *  - Brute-force protection on the two routes an attacker would actually
 *    target once VOX is internet-reachable: login and (until the first
 *    account exists) register.
 */
export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;

  if (MUTATING_METHODS.has(request.method) && !isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request blocked." }, { status: 403 });
  }

  if (request.method === "POST" && AUTH_PATHS.has(pathname)) {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    if (!checkRateLimit(`auth:${ip}`, AUTH_RATE_LIMIT, AUTH_RATE_WINDOW_MS)) {
      return NextResponse.json({ error: "Too many attempts. Try again in a few minutes." }, { status: 429 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
