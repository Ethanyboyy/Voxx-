/**
 * Running a Visual QA review.
 *
 * Uses the existing getAIProvider() with the image blocks added in
 * src/lib/ai/types.ts, rather than a separate vision provider abstraction —
 * there is one model call to make, and a second provider hierarchy for it
 * would be a second thing to configure, meter and keep in sync.
 *
 * The one hard rule: QA REFUSES TO RUN WITHOUT A VISION-CAPABLE PROVIDER.
 * A text-only model asked to judge an image will answer anyway, fluently and
 * entirely from the prompt. That verdict would then be stored as a real QA
 * result, gate a real iteration loop, and mark a real artifact approved — a
 * fabricated judgement about work nothing ever looked at. Refusing is the only
 * honest option, and it is why MockAIProvider.supportsVision is false.
 */

import { getAIProvider } from "@/lib/ai";
import { modelForJob } from "@/lib/ai/routing";
import { recordEvent } from "@/lib/observability/events";
import { isSupportedImageMimeType } from "@/lib/ai/types";
import type { ChatMessageInput, ContentBlock } from "@/lib/ai/types";
import {
  ALL_QA_CRITERIA,
  CRITERIA_PRESETS,
  QA_FAILURE_KINDS,
  type QaCriterion,
  type QaIssue,
  type QaResult,
  type QaSeverity,
} from "@/lib/qa/types";

export class VisionUnavailableError extends Error {
  constructor(providerId: string) {
    super(
      `Visual QA needs a vision-capable AI provider; "${providerId}" cannot see images. ` +
        "Set ANTHROPIC_API_KEY to enable it. VOX will not guess at a verdict it cannot form.",
    );
    this.name = "VisionUnavailableError";
  }
}

export interface QaImage {
  data: Uint8Array;
  mimeType: string;
  /** What this image IS, so the model is not left to infer it from order. */
  role: "reference" | "candidate";
  label?: string;
}

export interface QaRequest {
  /** What the user actually asked for. The thing being judged against. */
  requirements: string;
  images: QaImage[];
  /** Preset name or explicit list. Defaults to the generic preset. */
  criteria?: QaCriterion[] | keyof typeof CRITERIA_PRESETS;
  /** Passing score. Below this, the review is a FAIL even with no blockers. */
  passScore?: number;
  /** Correlates the review with the run that produced the candidate. */
  traceId?: string;
}

const DEFAULT_PASS_SCORE = 70;

function resolveCriteria(criteria: QaRequest["criteria"]): QaCriterion[] {
  if (Array.isArray(criteria)) {
    // Filter to the known set: an unknown criterion invites the model to
    // invent a dimension and then find fault along it.
    return criteria.filter((c) => ALL_QA_CRITERIA.includes(c));
  }
  const preset = CRITERIA_PRESETS[criteria ?? "generic"] ?? CRITERIA_PRESETS.generic;
  return [...preset];
}

/**
 * The instruction.
 *
 * Explicitly forbids reasoning in the output. The brief requires that no
 * chain-of-thought is exposed or stored, and the cheapest way to honour that
 * is to never ask for it — a "think step by step then answer" prompt produces
 * reasoning that then has to be stripped, and stripping is where it leaks.
 */
function buildSystemPrompt(criteria: QaCriterion[], passScore: number): string {
  return [
    "You are a visual quality reviewer. You are shown one or more images and a description of what was asked for.",
    "",
    "Judge ONLY these criteria:",
    ...criteria.map((c) => `- ${c.replace(/_/g, " ")}`),
    "",
    "Rules:",
    "- Report only what you can actually see. Do not infer defects you cannot observe.",
    "- Be specific: \"left hand has six fingers\", not \"anatomy issues\".",
    `- A result scoring below ${passScore} is a FAIL even if no single issue is a blocker.`,
    "- Any BLOCKER issue makes the result a FAIL regardless of score.",
    "- If there is nothing wrong, return an empty issues array. Do not invent problems to seem thorough.",
    "",
    "Each issue must carry a `kind` from this exact list:",
    QA_FAILURE_KINDS.filter((k) => k !== "PROVIDER_FAILURE").join(", "),
    "",
    "Respond with ONLY a JSON object, no prose, no explanation, no reasoning:",
    '{"status":"PASS"|"FAIL","score":0-100,"issues":[{"kind":"...","severity":"MINOR"|"MAJOR"|"BLOCKER","description":"..."}],"recommendations":["..."]}',
  ].join("\n");
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error("No JSON object found in the reviewer's output.");
  return JSON.parse(candidate.slice(start, end + 1));
}

/**
 * Parses the model's response into a QaResult, defensively.
 *
 * A malformed review must not become a PASS. Every unparseable field falls
 * back to the conservative reading — unknown status is FAIL, unknown severity
 * is MAJOR, unknown kind is GENERATION_ARTIFACT — because the failure mode of
 * a lenient parser here is silently approving bad output.
 */
export function parseQaResponse(
  raw: string,
  context: { criteria: QaCriterion[]; model: string; provider: string; durationMs: number; passScore: number },
): QaResult {
  const parsed = extractJson(raw) as Record<string, unknown>;

  const rawScore = Number(parsed.score);
  const score = Number.isFinite(rawScore) ? Math.max(0, Math.min(100, Math.round(rawScore))) : 0;

  const issues: QaIssue[] = Array.isArray(parsed.issues)
    ? parsed.issues.slice(0, 20).map((entry) => {
        const issue = (entry ?? {}) as Record<string, unknown>;
        const kind = QA_FAILURE_KINDS.includes(issue.kind as never)
          ? (issue.kind as QaIssue["kind"])
          : "GENERATION_ARTIFACT";
        const severity: QaSeverity =
          issue.severity === "BLOCKER" || issue.severity === "MINOR" || issue.severity === "MAJOR"
            ? issue.severity
            : "MAJOR";
        return { kind, severity, description: String(issue.description ?? "Unspecified issue.").slice(0, 300) };
      })
    : [];

  const recommendations: string[] = Array.isArray(parsed.recommendations)
    ? parsed.recommendations.slice(0, 8).map((r) => String(r).slice(0, 300))
    : [];

  // The verdict is RECOMPUTED rather than trusted. A model that says PASS with
  // a blocker present, or PASS at score 12, is contradicting itself, and the
  // rules are cheap to enforce here.
  const hasBlocker = issues.some((i) => i.severity === "BLOCKER");
  const claimedPass = parsed.status === "PASS";
  const status: QaResult["status"] = !hasBlocker && claimedPass && score >= context.passScore ? "PASS" : "FAIL";

  return {
    status,
    score,
    issues,
    recommendations,
    criteria: context.criteria,
    model: context.model,
    provider: context.provider,
    durationMs: context.durationMs,
  };
}

/** Runs a review. Throws only when it genuinely could not look. */
export async function runVisualQa(userId: string, request: QaRequest): Promise<QaResult> {
  const provider = getAIProvider();
  if (!provider.supportsVision) throw new VisionUnavailableError(provider.id);

  const candidates = request.images.filter((i) => i.role === "candidate");
  if (candidates.length === 0) throw new Error("Visual QA needs at least one candidate image to judge.");
  for (const image of request.images) {
    if (!isSupportedImageMimeType(image.mimeType)) {
      throw new Error(`Visual QA cannot read "${image.mimeType}".`);
    }
  }

  const criteria = resolveCriteria(request.criteria);
  const passScore = request.passScore ?? DEFAULT_PASS_SCORE;

  // Each image is labelled by role in an adjacent text block. Without that the
  // model has to guess which picture is the target and which is the attempt,
  // and it guesses wrong often enough to invert the whole verdict.
  const blocks: ContentBlock[] = [{ type: "text", text: `What was asked for:\n${request.requirements}` }];
  for (const image of request.images) {
    blocks.push({
      type: "text",
      text: image.role === "reference" ? `REFERENCE${image.label ? ` — ${image.label}` : ""}:` : `CANDIDATE${image.label ? ` — ${image.label}` : ""}:`,
    });
    blocks.push({ type: "image", data: Buffer.from(image.data).toString("base64"), mimeType: image.mimeType });
  }

  const messages: ChatMessageInput[] = [{ role: "user", content: blocks }];

  await recordEvent({
    userId,
    type: "qa.started",
    subjectType: "VisualQa",
    subjectId: request.traceId ?? "adhoc",
    payload: { criteria, images: request.images.length, traceId: request.traceId },
  });

  // modelForJob returns undefined when unset, which means "use the provider's
  // default". Resolved once so the recorded model is what actually ran rather
  // than an empty field.
  const model = modelForJob("REASONING") ?? provider.defaultModel;

  const started = Date.now();
  let raw: string;
  try {
    const response = await provider.generate({
      model,
      system: buildSystemPrompt(criteria, passScore),
      messages,
      maxTokens: 1500,
      // Low temperature: a review should be reproducible for the same image.
      temperature: 0,
    });
    raw = response.content;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordEvent({
      userId,
      type: "qa.failed",
      subjectType: "VisualQa",
      subjectId: request.traceId ?? "adhoc",
      payload: { error: message.slice(0, 300), traceId: request.traceId },
    });
    throw new Error(`Visual QA could not run: ${message}`);
  }

  let result: QaResult;
  try {
    result = parseQaResponse(raw, {
      criteria,
      model,
      provider: provider.id,
      durationMs: Date.now() - started,
      passScore,
    });
  } catch {
    // An unreadable review is a PROVIDER_FAILURE, and it is a FAIL. Treating
    // it as a pass would let a broken reviewer approve everything.
    result = {
      status: "FAIL",
      score: 0,
      issues: [{ kind: "PROVIDER_FAILURE", severity: "BLOCKER", description: "The reviewer's response could not be parsed." }],
      recommendations: [],
      criteria,
      model,
      provider: provider.id,
      durationMs: Date.now() - started,
    };
  }

  await recordEvent({
    userId,
    type: "qa.completed",
    subjectType: "VisualQa",
    subjectId: request.traceId ?? "adhoc",
    // Only the verdict and issue shape — never the model's prose.
    payload: {
      status: result.status,
      score: result.score,
      issueCount: result.issues.length,
      kinds: [...new Set(result.issues.map((i) => i.kind))],
      traceId: request.traceId,
    },
  });

  return result;
}
