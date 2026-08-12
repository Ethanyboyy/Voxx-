import type { BrainNode } from "@/lib/brain/graph";

/**
 * A 0..1 visual-weight signal from fields already on the node — never a new
 * ranking, just how prominently an already-real priority/confidence/status
 * should render (or, for density, whether it renders at all). Reuses the
 * same rankScore/priority/relevance/confidence the rest of the app already
 * computed; this only decides pixels, not order. Shared between NodeCard
 * (opacity/scale) and BrainWorkspace (density filtering) so both agree.
 */
export function importanceOf(node: BrainNode): number {
  switch (node.type) {
    case "OBJECTIVE":
      return 1;
    case "PROPOSAL":
      return node.status === "PROPOSED" ? 0.95 : 0.5;
    case "OPPORTUNITY": {
      if (node.meta.isNextBestAction) return 1;
      const score = node.meta.rankScore as number | null;
      return score == null ? 0.5 : Math.max(0.3, Math.min(1, score / 10));
    }
    case "TASK": {
      const priority = node.meta.priority as string | null;
      const base = priority === "HIGH" ? 0.9 : priority === "MEDIUM" ? 0.6 : 0.4;
      if (node.status === "DONE") return 0.25;
      return node.status === "IN_PROGRESS" ? Math.min(1, base + 0.1) : base;
    }
    case "RESEARCH": {
      const relevance = node.meta.relevance as number | null;
      return relevance == null ? 0.5 : Math.max(0.3, Math.min(1, relevance));
    }
    case "MEMORY": {
      const confidence = node.meta.confidence as string | null;
      return confidence === "CONFIRMED" ? 0.9 : confidence === "HIGH" ? 0.75 : confidence === "MEDIUM" ? 0.55 : 0.4;
    }
    case "AGENT_RUN":
      return node.status === "RUNNING" || node.status === "WAITING_FOR_PERMISSION" || node.status === "FAILED"
        ? 0.95
        : node.status === "COMPLETED"
          ? 0.4
          : 0.6;
    case "PROJECT":
      return node.status === "ACTIVE" ? 0.85 : node.status === "COMPLETED" ? 0.35 : 0.6;
    default:
      return 0.6;
  }
}

export function isStale(node: BrainNode): boolean {
  const days = (Date.now() - new Date(node.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
  return days > 30;
}
