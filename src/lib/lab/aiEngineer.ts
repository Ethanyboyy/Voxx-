// AI Lab Engineer — the laboratory's structured-data-grounded assistant.
// Reuses the existing provider-agnostic AI abstraction (src/lib/ai/) — never
// calls @anthropic-ai/sdk directly. Every answer is generated from real rows
// fetched here and injected into the prompt; the system prompt explicitly
// forbids inventing numbers not present in that data, and instructs the
// model to say so when something isn't known rather than guess.
import { getAIProvider } from "@/lib/ai";
import { db } from "@/lib/db";
import { getSuit, createSuitVersion, type SuitStatsInput } from "@/lib/lab/suits";
import { getLabDashboard } from "@/lib/lab/dashboard";

const GROUNDING_SYSTEM_PROMPT = `You are the AI Lab Engineer inside SPIDER-MAN LABORATORY, a personal R&D lab application for designing fictional suits, gadgets, and running engineering simulations.

Rules:
- Answer ONLY using the structured JSON data provided below the question. Never invent stats, components, or results that aren't in that data.
- If the data doesn't contain something the user asked about, say so plainly ("not recorded" / "unknown") instead of guessing.
- Every stat value from the data should be treated as ESTIMATED/HYPOTHETICAL design data, not real-world engineering fact — the lab is a design and simulation sandbox.
- Keep answers concise, technical, and confident in tone (like a lab engineer's briefing), but never present a simulation result as real-world safety validation.
- When asked to analyze weaknesses, reason from the numeric stats you were given (low relative values, high weight/complexity/cost, etc).`;

export interface LabAiResult {
  reply: string;
  action?: { type: string; label: string; href?: string };
}

async function ground(question: string, data: unknown): Promise<string> {
  const provider = getAIProvider();
  const result = await provider.generate({
    system: GROUNDING_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `${question}\n\n--- STRUCTURED LAB DATA (JSON) ---\n${JSON.stringify(data, null, 2)}`,
      },
    ],
    maxTokens: 700,
  });
  return result.content;
}

function findSuitByName(suits: { id: string; codename: string }[], text: string) {
  const lower = text.toLowerCase();
  return suits.find((s) => lower.includes(s.codename.toLowerCase()));
}

/** Routes a free-text command to a specific handler when it recognizes one
 * of the documented example commands, otherwise falls back to a grounded
 * general answer using the lab dashboard as context. */
export async function handleLabCommand(userId: string, message: string): Promise<LabAiResult> {
  const text = message.trim();
  const lower = text.toLowerCase();

  const suits = await db.labSuit.findMany({ where: { userId }, select: { id: true, codename: true } });

  if (/\b(compare)\b/.test(lower)) {
    const matches = suits.filter((s) => lower.includes(s.codename.toLowerCase()));
    if (matches.length >= 2) {
      const [a, b] = matches;
      const suitA = await getSuit(userId, a.id);
      const suitB = await getSuit(userId, b.id);
      const reply = await ground(text, { suitA, suitB });
      return { reply, action: { type: "compare", label: `Open comparison`, href: `/lab/suits/compare?ids=${a.id},${b.id}` } };
    }
  }

  if (/\b(analyz|weakness|strength)/.test(lower)) {
    const match = findSuitByName(suits, lower);
    if (match) {
      const suit = await getSuit(userId, match.id);
      const reply = await ground(text, suit);
      return { reply, action: { type: "view_suit", label: `Open ${match.codename}`, href: `/lab/suits/${match.id}` } };
    }
  }

  if (/\b(lighter|reduce weight|reduce mass)\b/.test(lower) || (/optimi[sz]e/.test(lower) && /mobil/.test(lower))) {
    const match = findSuitByName(suits, lower);
    if (match) {
      const variant = await createLighterVariant(userId, match.id);
      if (variant) {
        return {
          reply: `Created variant ${variant.label} of ${match.codename}: weight reduced, mobility increased, at the cost of some durability and manufacturing simplicity. Review the full stat diff on the suit's version history.`,
          action: { type: "view_suit", label: `Open ${match.codename}`, href: `/lab/suits/${match.id}` },
        };
      }
    }
  }

  if (/\b(component|breakdown)/.test(lower)) {
    const match = findSuitByName(suits, lower);
    if (match) {
      const suit = await getSuit(userId, match.id);
      const reply = await ground(text, { codename: suit?.codename, components: suit?.components });
      return { reply, action: { type: "view_suit", label: `Open ${match.codename}`, href: `/lab/suits/${match.id}` } };
    }
  }

  if (/\bassumption/.test(lower)) {
    const reply = await ground(
      text,
      "This lab labels every engineering value with a confidence source: VERIFIED (real data), ESTIMATED (model/calculation), HYPOTHETICAL (conceptual assumption), or UNKNOWN (insufficient information). Simulation results are always model outputs, never real-world validation."
    );
    return { reply };
  }

  // General fallback — grounded on the live dashboard summary.
  const dashboard = await getLabDashboard(userId);
  const reply = await ground(text, dashboard);
  return { reply };
}

/** A REAL deterministic design action (not a canned response): derives a new
 * suit version with mass reduced and mobility increased, trading off
 * durability/manufacturing complexity, and persists it as a genuine variant. */
export async function createLighterVariant(userId: string, suitId: string) {
  const suit = await getSuit(userId, suitId);
  const base = suit?.currentVersion?.stats;
  if (!base) return null;

  const nextLabel = `v${suit!.versions.length + 1}.0-lite`;
  const stats: SuitStatsInput = {
    stealth: base.stealth,
    durability: Math.max(10, Math.round(base.durability * 0.9)),
    mobility: Math.min(100, Math.round(base.mobility * 1.12)),
    stretchiness: base.stretchiness,
    weightKg: Number((base.weightKg * 0.85).toFixed(2)),
    thermalLoadC: base.thermalLoadC,
    protection: Math.max(10, Math.round(base.protection * 0.92)),
    environmentalResistance: base.environmentalResistance,
    manufacturingComplexity: Math.min(100, Math.round(base.manufacturingComplexity * 1.08)),
    estimatedBuildHours: Number((base.estimatedBuildHours * 1.05).toFixed(1)),
    estimatedCostUsd: Number((base.estimatedCostUsd * 1.1).toFixed(0)),
    flexibility: Math.min(100, Math.round(base.flexibility * 1.1)),
    impactResistance: Math.max(10, Math.round(base.impactResistance * 0.9)),
    visibility: base.visibility,
    noiseProfile: Math.max(0, Math.round(base.noiseProfile * 0.95)),
    sensorCapacity: base.sensorCapacity,
    energyRequirementW: base.energyRequirementW,
    maintenanceComplexity: Math.min(100, Math.round(base.maintenanceComplexity * 1.05)),
    confidence: "HYPOTHETICAL",
  };

  return createSuitVersion(userId, suitId, {
    label: nextLabel,
    note: "AI Lab Engineer variant: mass -15%, mobility +12%, durability -10%, manufacturing complexity +8%.",
    parentVersionId: suit!.currentVersion!.id,
    stats,
    makeCurrent: false,
  });
}
