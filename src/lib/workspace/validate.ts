/**
 * Engineering validation: typecheck, lint, test, build.
 *
 * ------------------------------------------------------------------------
 * THERE IS NO "RUN AN ARBITRARY COMMAND" TOOL, AND THERE MUST NOT BE.
 * ------------------------------------------------------------------------
 *
 * The execution agent's plans come from a model, working over text that can
 * include a user's pasted reference, a caption from a generated image, or a
 * filename inside an artifact. A tool that accepts a command string turns all
 * of that into remote code execution on the server, and no permission level
 * makes that acceptable — ACT is a grant to edit this project, not a grant to
 * run anything at all.
 *
 * So the set below is CLOSED and hardcoded. Each entry names an npm script
 * that already exists in package.json. The agent chooses WHICH check to run;
 * it never composes one. Adding a check is a code change and a review, which
 * is the correct amount of friction.
 *
 * `execFile` with an argument array, never `exec` with a string: there is no
 * shell, so there is no shell metacharacter to inject even if a future caller
 * gets careless.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { workspaceRoot } from "@/lib/workspace/paths";

const run = promisify(execFile);

/** The checks the agent may run. Closed set — see the module docstring. */
export const VALIDATIONS = {
  typecheck: { script: "typecheck", label: "TypeScript", timeoutMs: 300_000 },
  lint: { script: "lint", label: "ESLint", timeoutMs: 300_000 },
  test: { script: "test", label: "Vitest", timeoutMs: 600_000 },
  build: { script: "build", label: "Production build", timeoutMs: 900_000 },
} as const;

export type ValidationName = keyof typeof VALIDATIONS;

export const VALIDATION_NAMES = Object.keys(VALIDATIONS) as ValidationName[];

export function isValidationName(name: string): name is ValidationName {
  return Object.prototype.hasOwnProperty.call(VALIDATIONS, name);
}

export interface ValidationResult {
  name: ValidationName;
  label: string;
  passed: boolean;
  /** Process exit code. Null when the process was killed (usually a timeout). */
  exitCode: number | null;
  durationMs: number;
  /**
   * The tail of combined stdout/stderr.
   *
   * The TAIL, not the head: a failing typecheck or test run prints its
   * summary and the failures last, and the first 4 KB of a build log is
   * dependency noise. This is the part an agent needs to act on.
   */
  output: string;
  timedOut: boolean;
}

/** Enough to see what failed, bounded so it cannot flood a model's context. */
const MAX_OUTPUT_CHARS = 6000;

function tail(text: string): string {
  if (text.length <= MAX_OUTPUT_CHARS) return text;
  return `…(${text.length - MAX_OUTPUT_CHARS} earlier characters omitted)\n` + text.slice(-MAX_OUTPUT_CHARS);
}

/**
 * Runs one validation.
 *
 * A non-zero exit is a RESULT, not an exception: "the tests failed" is exactly
 * the information the caller asked for, and throwing would make the executor
 * treat a legitimate red build as a tool malfunction and retry it.
 */
export async function runValidation(name: ValidationName): Promise<ValidationResult> {
  const spec = VALIDATIONS[name];
  const started = Date.now();

  try {
    const { stdout, stderr } = await run("npm", ["run", "--silent", spec.script], {
      cwd: workspaceRoot(),
      timeout: spec.timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      // A validation must never inherit an interactive TTY's assumptions, and
      // CI=1 is what makes watch-mode-by-default tools run once and exit.
      env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
    });
    return {
      name,
      label: spec.label,
      passed: true,
      exitCode: 0,
      durationMs: Date.now() - started,
      output: tail(`${stdout}\n${stderr}`.trim()),
      timedOut: false,
    };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
      killed?: boolean;
      signal?: string;
    };
    const timedOut = failure.killed === true || failure.signal === "SIGTERM";
    return {
      name,
      label: spec.label,
      passed: false,
      exitCode: typeof failure.code === "number" ? failure.code : null,
      durationMs: Date.now() - started,
      output: tail(`${failure.stdout ?? ""}\n${failure.stderr ?? ""}`.trim() || failure.message),
      timedOut,
    };
  }
}

/**
 * Git status and diff, read-only.
 *
 * Fixed argument arrays, and `--stat` rather than a full patch: an agent needs
 * to know WHAT it changed, and a complete diff of a large edit would consume
 * the context it needs for the actual work.
 */
export async function gitStatus(): Promise<{ branch: string; changed: string[]; stat: string }> {
  const cwd = workspaceRoot();
  const [branchOut, statusOut, statOut] = await Promise.all([
    run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }).catch(() => ({ stdout: "" })),
    run("git", ["status", "--porcelain"], { cwd }).catch(() => ({ stdout: "" })),
    run("git", ["diff", "--stat"], { cwd, maxBuffer: 4 * 1024 * 1024 }).catch(() => ({ stdout: "" })),
  ]);

  const changed = statusOut.stdout
    .split("\n")
    .map((line) => line.slice(3).trim())
    .filter(Boolean)
    .slice(0, 200);

  return {
    branch: branchOut.stdout.trim() || "unknown",
    changed,
    stat: tail(statOut.stdout.trim()),
  };
}
