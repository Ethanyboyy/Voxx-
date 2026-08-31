/**
 * Filesystem operations for the execution agent.
 *
 * Every function here goes through resolveWorkspacePath(), so containment is
 * enforced in one place rather than remembered at each call site.
 *
 * Everything is BOUNDED. An agent asking to read a file, list a tree or search
 * a repository is asking for something whose size it does not know, and the
 * result lands in a model's context window. Unbounded output there is not a
 * performance problem, it is a correctness problem: the interesting part gets
 * truncated by whatever happens to be last.
 */

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import {
  isReadablePath,
  isWritablePath,
  protectionReason,
  ProtectedPathError,
  resolveWorkspacePath,
  toRelative,
  workspaceRoot,
} from "@/lib/workspace/paths";

/** Directories never worth walking. Skipped for cost, not for safety. */
const SKIP_DIRECTORIES = new Set([
  "node_modules", ".git", ".next", "dist", "build", "coverage", ".turbo", "__pycache__",
]);

export const MAX_READ_BYTES = 512 * 1024;
export const MAX_LIST_ENTRIES = 500;
export const MAX_SEARCH_MATCHES = 100;
export const MAX_WRITE_BYTES = 2 * 1024 * 1024;

export interface FileEntry {
  path: string;
  kind: "file" | "directory";
  bytes: number | null;
}

/**
 * Lists a directory, one level deep.
 *
 * One level rather than recursive on purpose: a recursive listing of a real
 * repository is thousands of entries, and an agent that needs the shape of a
 * subtree is better served asking for the subtree it cares about. See
 * `projectStructure` for the bounded overview.
 */
export async function listDirectory(relativePath: string): Promise<FileEntry[]> {
  if (!isReadablePath(relativePath)) {
    throw new ProtectedPathError(relativePath, protectionReason(relativePath) ?? "it is protected");
  }
  const absolute = await resolveWorkspacePath(relativePath);
  const names = await readdir(absolute, { withFileTypes: true });

  const entries: FileEntry[] = [];
  for (const entry of names.slice(0, MAX_LIST_ENTRIES)) {
    if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
    const childRelative = path.posix.join(relativePath.replace(/\\/g, "/"), entry.name).replace(/^\.\//, "");
    if (!isReadablePath(childRelative)) continue;

    let bytes: number | null = null;
    if (entry.isFile()) {
      try {
        bytes = (await stat(path.join(absolute, entry.name))).size;
      } catch {
        // A file that vanished between readdir and stat is simply not listed.
      }
    }
    entries.push({ path: childRelative, kind: entry.isDirectory() ? "directory" : "file", bytes });
  }
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

export interface ReadResult {
  path: string;
  content: string;
  bytes: number;
  /** True when the file was longer than the byte budget and was cut. */
  truncated: boolean;
}

/**
 * Reads a text file, capped.
 *
 * Truncation is REPORTED rather than silent. An agent that reasons about the
 * end of a file it only saw the start of produces confident, wrong edits, and
 * the flag is what lets the executor and the model know to narrow the request.
 */
export async function readWorkspaceFile(relativePath: string, maxBytes = MAX_READ_BYTES): Promise<ReadResult> {
  if (!isReadablePath(relativePath)) {
    throw new ProtectedPathError(relativePath, protectionReason(relativePath) ?? "it is protected");
  }
  const absolute = await resolveWorkspacePath(relativePath);
  const info = await stat(absolute);
  if (!info.isFile()) throw new Error(`"${relativePath}" is not a file.`);

  const buffer = await readFile(absolute);
  const truncated = buffer.byteLength > maxBytes;
  const slice = truncated ? buffer.subarray(0, maxBytes) : buffer;

  return {
    path: toRelative(absolute),
    content: slice.toString("utf8"),
    bytes: info.size,
    truncated,
  };
}

export interface SearchMatch {
  path: string;
  line: number;
  text: string;
}

/**
 * Searches file contents for a regular expression.
 *
 * Implemented in Node rather than by shelling out to ripgrep or `git grep`.
 * Neither is guaranteed present, `git grep` only sees tracked files, and both
 * would mean building a command line from agent-supplied text — which is the
 * one thing the validation module exists to avoid. A bounded walk is slower
 * and has no injection surface.
 */
export async function searchWorkspace(
  pattern: string,
  options: { directory?: string; glob?: string; maxMatches?: number } = {},
): Promise<SearchMatch[]> {
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch (error) {
    throw new Error(`Invalid search pattern: ${error instanceof Error ? error.message : String(error)}`);
  }

  const globRegex = options.glob ? globToRegExp(options.glob) : null;
  const start = options.directory ?? ".";
  const maxMatches = options.maxMatches ?? MAX_SEARCH_MATCHES;
  const root = await resolveWorkspacePath(start);

  const matches: SearchMatch[] = [];
  const queue: string[] = [root];

  while (queue.length > 0 && matches.length < maxMatches) {
    const dir = queue.shift()!;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (matches.length >= maxMatches) break;
      const absolute = path.join(dir, entry.name);
      const relative = toRelative(absolute);

      if (entry.isDirectory()) {
        if (SKIP_DIRECTORIES.has(entry.name)) continue;
        if (!isReadablePath(relative + "/")) continue;
        queue.push(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isReadablePath(relative)) continue;
      if (globRegex && !globRegex.test(relative)) continue;

      let info;
      try {
        info = await stat(absolute);
      } catch {
        continue;
      }
      // Skip anything too large to be source. Reading a 50 MB binary to regex
      // it is pure cost.
      if (info.size > MAX_READ_BYTES) continue;

      let content: string;
      try {
        content = (await readFile(absolute)).toString("utf8");
      } catch {
        continue;
      }
      // A NUL byte in the first block is the usual binary tell.
      if (content.slice(0, 1024).includes("\u0000")) continue;

      const lines = content.split("\n");
      for (let i = 0; i < lines.length && matches.length < maxMatches; i++) {
        if (regex.test(lines[i])) {
          matches.push({ path: relative, line: i + 1, text: lines[i].slice(0, 300) });
        }
      }
    }
  }

  return matches;
}

/**
 * A minimal glob -> RegExp, supporting `*`, `**` and `?`.
 *
 * `**` is parked on a sentinel before `*` is expanded. Expanding `*` first
 * would turn `**` into two `[^/]*`, silently stopping it from crossing a
 * directory boundary — which is the one thing `**` is for.
 */
function globToRegExp(glob: string): RegExp {
  const DOUBLE_STAR = "\u0000";
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, DOUBLE_STAR)
    .replace(/\*/g, "[^/]*")
    .split(DOUBLE_STAR)
    .join(".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

export interface WriteResult {
  path: string;
  bytes: number;
  created: boolean;
}

/** Writes a file whole, creating parent directories as needed. */
export async function writeWorkspaceFile(relativePath: string, content: string): Promise<WriteResult> {
  if (!isWritablePath(relativePath)) {
    throw new ProtectedPathError(relativePath, protectionReason(relativePath) ?? "it is protected");
  }
  if (Buffer.byteLength(content, "utf8") > MAX_WRITE_BYTES) {
    throw new Error(`Refusing to write ${Buffer.byteLength(content, "utf8")} bytes; the limit is ${MAX_WRITE_BYTES}.`);
  }

  const absolute = await resolveWorkspacePath(relativePath, { mustExist: false });
  let created = true;
  try {
    await stat(absolute);
    created = false;
  } catch {
    // Absent is the normal case for a create.
  }

  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content, "utf8");
  return { path: toRelative(absolute), bytes: Buffer.byteLength(content, "utf8"), created };
}

export interface PatchResult {
  path: string;
  replacements: number;
}

/**
 * Replaces an exact string in a file.
 *
 * Exact-match rather than line numbers or a diff format, and it FAILS when the
 * match is not unique. Both choices are about the same failure: an agent
 * working from a file it read earlier has a stale view, and a line-numbered
 * edit applied to a shifted file corrupts it silently. A unique string either
 * matches the code the agent actually reasoned about or it does not.
 */
export async function patchWorkspaceFile(
  relativePath: string,
  find: string,
  replace: string,
  options: { replaceAll?: boolean } = {},
): Promise<PatchResult> {
  if (!isWritablePath(relativePath)) {
    throw new ProtectedPathError(relativePath, protectionReason(relativePath) ?? "it is protected");
  }
  if (find.length === 0) throw new Error("The string to find must not be empty.");
  if (find === replace) throw new Error("The replacement is identical to the text it replaces.");

  const absolute = await resolveWorkspacePath(relativePath);
  const original = (await readFile(absolute)).toString("utf8");

  const occurrences = original.split(find).length - 1;
  if (occurrences === 0) {
    throw new Error(`No match for that text in "${relativePath}". Read the file again — it may have changed.`);
  }
  if (occurrences > 1 && !options.replaceAll) {
    throw new Error(
      `That text appears ${occurrences} times in "${relativePath}". Include more surrounding context to make it unique, or ask for all occurrences.`,
    );
  }

  const updated = options.replaceAll ? original.split(find).join(replace) : original.replace(find, replace);
  await writeFile(absolute, updated, "utf8");
  return { path: toRelative(absolute), replacements: options.replaceAll ? occurrences : 1 };
}

export interface StructureNode {
  path: string;
  kind: "file" | "directory";
  children?: StructureNode[];
}

/**
 * A bounded overview of the project's shape.
 *
 * Depth-limited and breadth-limited so the result stays small enough to be
 * useful in a prompt. This answers "where do things live", not "list every
 * file" — an agent that needs the latter should search.
 */
export async function projectStructure(maxDepth = 2, maxPerDirectory = 40): Promise<StructureNode[]> {
  async function walk(relative: string, depth: number): Promise<StructureNode[]> {
    if (depth > maxDepth) return [];
    let entries: FileEntry[];
    try {
      entries = await listDirectory(relative);
    } catch {
      return [];
    }

    const nodes: StructureNode[] = [];
    for (const entry of entries.slice(0, maxPerDirectory)) {
      if (entry.kind === "directory") {
        nodes.push({ path: entry.path, kind: "directory", children: await walk(entry.path, depth + 1) });
      } else {
        nodes.push({ path: entry.path, kind: "file" });
      }
    }
    return nodes;
  }

  return walk(".", 0);
}

export { workspaceRoot };
