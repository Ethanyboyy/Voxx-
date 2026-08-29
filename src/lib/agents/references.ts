/**
 * Step-output references — how a plan step uses what an earlier step actually
 * produced.
 *
 * Every step's tool input used to be frozen at planning time, so step 2 could
 * never act on what step 1 returned. That put a hard ceiling on multi-step
 * work: a plan could only ever be a sequence of independent tool calls, not
 * an actual chain (search, then act on what was found).
 *
 * A planner can now emit `{{step0.output}}` or `{{step0.output.items.0.id}}`
 * inside a step's input, and the executor substitutes the real recorded
 * output before validating against the tool's schema.
 *
 * Deliberately limited to `output` — that is the machine-readable result
 * persisted on AgentStep, so a reference still resolves correctly when a run
 * pauses for permission and is resumed later from the database. A step's
 * human-readable `summary` is not persisted and would silently resolve to
 * nothing after a resume.
 */

/** `{{stepN.output}}` with an optional dotted path, tolerant of inner spaces. */
const REFERENCE_PATTERN = /\{\{\s*step(\d+)\.output((?:\.[A-Za-z0-9_]+)*)\s*\}\}/g;

export interface ResolutionResult {
  value: unknown;
  /** References that could not be resolved — an earlier step that never
   * completed, or a path that does not exist in its output. Never silently
   * ignored: the executor fails the step rather than handing a tool a literal
   * "{{step0.output}}" string and calling it success. */
  unresolved: string[];
}

/** True when the input contains at least one step reference. */
export function hasStepReference(input: unknown): boolean {
  if (typeof input === "string") {
    REFERENCE_PATTERN.lastIndex = 0;
    return REFERENCE_PATTERN.test(input);
  }
  if (Array.isArray(input)) return input.some(hasStepReference);
  if (input && typeof input === "object") return Object.values(input).some(hasStepReference);
  return false;
}

function walkPath(root: unknown, dottedPath: string): { found: boolean; value: unknown } {
  if (dottedPath === "") return { found: true, value: root };
  let current = root;
  for (const key of dottedPath.slice(1).split(".")) {
    if (current == null) return { found: false, value: undefined };
    if (Array.isArray(current)) {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) return { found: false, value: undefined };
      current = current[index];
      continue;
    }
    if (typeof current !== "object") return { found: false, value: undefined };
    const record = current as Record<string, unknown>;
    if (!(key in record)) return { found: false, value: undefined };
    current = record[key];
  }
  return { found: true, value: current };
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  return JSON.stringify(value);
}

/**
 * Replaces every step reference in `input` with the real output of the
 * referenced step.
 *
 * A string that is EXACTLY one reference resolves to the raw value, so an
 * object or number stays an object or number and reaches the tool's zod
 * schema with its real type intact. A reference embedded in surrounding text
 * is stringified and interpolated, which is the only sensible thing to do
 * inside a sentence.
 */
export function resolveStepReferences(input: unknown, outputsByOrder: Map<number, unknown>): ResolutionResult {
  const unresolved: string[] = [];

  function resolve(node: unknown): unknown {
    if (typeof node === "string") return resolveString(node);
    if (Array.isArray(node)) return node.map(resolve);
    if (node && typeof node === "object") {
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, resolve(value)]));
    }
    return node;
  }

  function lookup(orderText: string, path: string): { found: boolean; value: unknown } {
    const order = Number(orderText);
    if (!outputsByOrder.has(order)) return { found: false, value: undefined };
    return walkPath(outputsByOrder.get(order), path);
  }

  function resolveString(text: string): unknown {
    REFERENCE_PATTERN.lastIndex = 0;
    const matches = [...text.matchAll(REFERENCE_PATTERN)];
    if (matches.length === 0) return text;

    // Exactly one reference and nothing else — preserve the value's real type.
    if (matches.length === 1 && matches[0][0] === text.trim()) {
      const { found, value } = lookup(matches[0][1], matches[0][2]);
      if (!found) {
        unresolved.push(matches[0][0]);
        return text;
      }
      return value;
    }

    REFERENCE_PATTERN.lastIndex = 0;
    return text.replace(REFERENCE_PATTERN, (whole, orderText: string, path: string) => {
      const { found, value } = lookup(orderText, path);
      if (!found) {
        unresolved.push(whole);
        return whole;
      }
      return stringify(value);
    });
  }

  return { value: resolve(input), unresolved };
}
