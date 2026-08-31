import { notFound } from "next/navigation";
import { getScenario, SCENARIO_IDS } from "@/lib/experience/scenarios";
import { PreviewClient } from "@/components/preview/PreviewClient";

/**
 * The visual QA environment.
 *
 * Deliberately OUTSIDE the (app) route group, so it never touches
 * `getCurrentUser()`, the session cookie, or any service that reads the
 * database. There is nothing here to redact because there is nothing real here
 * to begin with — which is a much stronger guarantee than a preview that loads
 * production state and tries to hide the sensitive parts.
 *
 * What IS real is the rendering: these are the production Brain, Suit Bay and
 * inspector components, driven by deterministic synthetic state. A preview made
 * of parallel mock components would verify nothing about the product.
 */

/**
 * Off in production unless explicitly switched on.
 *
 * The route holds no real data, so exposing it would not leak anything — but
 * shipping a new publicly reachable surface by default is not a decision to
 * make silently. `VOX_PREVIEW=1` turns it on for a QA build; every other
 * production build 404s it. Development always has it, because that is where
 * it is used.
 */
export function previewEnabled(): boolean {
  return process.env.VOX_PREVIEW === "1" || process.env.NODE_ENV !== "production";
}

export function generateStaticParams() {
  return previewEnabled() ? SCENARIO_IDS.map((scenario) => ({ scenario })) : [];
}

export const dynamic = "force-static";

export default async function PreviewScenarioPage({ params }: { params: Promise<{ scenario: string }> }) {
  if (!previewEnabled()) notFound();
  const { scenario: id } = await params;
  const scenario = getScenario(id);
  if (!scenario) notFound();

  return <PreviewClient scenario={scenario} />;
}
