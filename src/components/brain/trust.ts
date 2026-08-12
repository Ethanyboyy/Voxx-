/**
 * The one place the Brain decides how to color/label confidence and
 * inference. Used by NodeCard and InspectorPanel so an inference can never
 * visually read as a confirmed fact in one place and something else
 * elsewhere — every trust signal in the Brain runs through this.
 */

export type TrustLevel = "CONFIRMED" | "HIGH" | "MEDIUM" | "LOW";

export const TRUST_COLOR: Record<TrustLevel, string> = {
  CONFIRMED: "var(--core-success)",
  HIGH: "var(--accent)",
  MEDIUM: "var(--warning)",
  LOW: "var(--border-strong)",
};

export const INFERENCE_COLOR = "var(--core-thinking)";

export function trustColor(confidence: string, category?: string | null): string {
  if (category === "INFERENCE") return INFERENCE_COLOR;
  return TRUST_COLOR[confidence as TrustLevel] ?? TRUST_COLOR.LOW;
}

export function trustLabel(confidence: string, category?: string | null): string {
  if (category === "INFERENCE") return "inference — not yet confirmed";
  return `${confidence.toLowerCase()} confidence`;
}
