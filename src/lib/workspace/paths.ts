/**
 * Path containment for the workspace tools.
 *
 * This module is the security boundary for everything the execution agent can
 * touch on disk, so it is deliberately small and deliberately paranoid.
 *
 * The threat is not hypothetical. The agent's plans are produced by a model
 * from text that may include a user's pasted reference, a provider's caption,
 * or a filename inside a generated artifact. A path that reaches a file tool
 * is therefore untrusted input, and "join it to the root and hope" is how that
 * becomes an arbitrary file read.
 *
 * Two separate checks, because they catch different things:
 *
 *   1. `resolve()` then prefix-check — stops `../../etc/passwd`.
 *   2. `realpath()` then prefix-check — stops a SYMLINK inside the workspace
 *      that points outside it. The first check passes for such a path, because
 *      lexically it is still under the root.
 *
 * A denylist sits on top for writes: even with the ACT grant, some paths are
 * never writable, because a permission to edit the project is not a permission
 * to rewrite its secrets or its generated client.
 */

import path from "node:path";
import { realpath } from "node:fs/promises";

/**
 * The workspace root.
 *
 * `VOX_WORKSPACE_ROOT` exists so a deployment can point the agent at a
 * checkout that is not the server's own cwd. It defaults to the project root,
 * which is what makes "fix the Suit Bay" mean this repository.
 */
export function workspaceRoot(): string {
  return path.resolve(process.env.VOX_WORKSPACE_ROOT ?? process.cwd());
}

export class PathOutsideWorkspaceError extends Error {
  constructor(relativePath: string) {
    super(`Path "${relativePath}" resolves outside the workspace.`);
    this.name = "PathOutsideWorkspaceError";
  }
}

export class ProtectedPathError extends Error {
  constructor(relativePath: string, why: string) {
    super(`Refusing to modify "${relativePath}": ${why}`);
    this.name = "ProtectedPathError";
  }
}

/**
 * Paths never readable by a tool, regardless of grant.
 *
 * `.env` and the SQLite files hold live secrets and user data; reading them
 * into a model's context is the exact leak SECURITY.md exists to prevent, and
 * no capability level should make it possible.
 */
const UNREADABLE = [
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\.git\//,
  /(^|\/)node_modules\//,
  /\.db(-journal|-wal|-shm)?$/,
  /(^|\/)\.next\//,
];

/**
 * Paths never writable, on top of everything unreadable.
 *
 * `src/generated/` is the Prisma client — regenerated from the schema, so a
 * hand edit is silently discarded on the next build and the agent would be
 * "fixing" something that cannot stay fixed. `prisma/migrations/` is applied
 * history: editing an applied migration desynchronises every other checkout.
 */
const UNWRITABLE = [
  /(^|\/)src\/generated\//,
  /(^|\/)prisma\/migrations\//,
  /(^|\/)package-lock\.json$/,
  /(^|\/)public\/artifacts\//,
];

function normalizeRelative(relativePath: string): string {
  // Backslashes are separators on Windows and ordinary characters on POSIX,
  // so a pattern written with `/` would miss `..\..\etc`. Normalising first
  // means the deny patterns only have to describe one shape.
  return relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function isReadablePath(relativePath: string): boolean {
  const normalized = normalizeRelative(relativePath);
  return !UNREADABLE.some((pattern) => pattern.test(normalized));
}

export function isWritablePath(relativePath: string): boolean {
  const normalized = normalizeRelative(relativePath);
  return isReadablePath(normalized) && !UNWRITABLE.some((pattern) => pattern.test(normalized));
}

/** Why a path is protected, in words a person can act on. */
export function protectionReason(relativePath: string): string | null {
  const normalized = normalizeRelative(relativePath);
  if (/(^|\/)\.env(\.|$)/.test(normalized)) return "it holds secrets";
  if (/\.db(-journal|-wal|-shm)?$/.test(normalized)) return "it is a database file";
  if (/(^|\/)\.git\//.test(normalized)) return "it is git's internal state";
  if (/(^|\/)node_modules\//.test(normalized)) return "it is an installed dependency";
  if (/(^|\/)\.next\//.test(normalized)) return "it is build output";
  if (/(^|\/)src\/generated\//.test(normalized)) return "it is regenerated from the Prisma schema, so an edit here cannot persist";
  if (/(^|\/)prisma\/migrations\//.test(normalized)) return "it is applied migration history";
  if (/(^|\/)package-lock\.json$/.test(normalized)) return "it is a resolved dependency lockfile";
  if (/(^|\/)public\/artifacts\//.test(normalized)) return "it is generated artifact content, not source";
  return null;
}

/**
 * Resolves a workspace-relative path to an absolute one, or throws.
 *
 * `mustExist` controls whether the symlink check runs: a file being CREATED
 * has no realpath yet, so its parent directory is checked instead. Skipping
 * the check entirely for new files would leave a hole — writing through a
 * symlinked directory is the same escape.
 */
export async function resolveWorkspacePath(
  relativePath: string,
  options: { mustExist?: boolean } = {},
): Promise<string> {
  const root = workspaceRoot();
  const normalized = normalizeRelative(relativePath);
  const absolute = path.resolve(root, normalized);

  // Lexical containment. `path.resolve` has already collapsed any `..`.
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    throw new PathOutsideWorkspaceError(relativePath);
  }

  // Physical containment. A symlink inside the workspace pointing out of it
  // passes the check above, because lexically it is still under the root.
  const target = options.mustExist === false ? path.dirname(absolute) : absolute;
  try {
    const real = await realpath(target);
    const realRoot = await realpath(root);
    if (real !== realRoot && !real.startsWith(realRoot + path.sep)) {
      throw new PathOutsideWorkspaceError(relativePath);
    }
  } catch (error) {
    if (error instanceof PathOutsideWorkspaceError) throw error;
    // ENOENT on a path we were told exists is the caller's problem to report,
    // with a better message than this module can give.
  }

  return absolute;
}

/** The workspace-relative form of an absolute path, for display and records. */
export function toRelative(absolutePath: string): string {
  return path.relative(workspaceRoot(), absolutePath).replace(/\\/g, "/");
}
