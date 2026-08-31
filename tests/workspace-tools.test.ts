import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, symlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  isReadablePath,
  isWritablePath,
  protectionReason,
  PathOutsideWorkspaceError,
  resolveWorkspacePath,
} from "@/lib/workspace/paths";
import {
  listDirectory,
  patchWorkspaceFile,
  projectStructure,
  readWorkspaceFile,
  searchWorkspace,
  writeWorkspaceFile,
} from "@/lib/workspace/fs";
import { VALIDATIONS, VALIDATION_NAMES, isValidationName } from "@/lib/workspace/validate";
import { getTool, listTools } from "@/lib/tools/registry";

let root: string;
let previousRoot: string | undefined;

beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), "vox-ws-"));
  previousRoot = process.env.VOX_WORKSPACE_ROOT;
  process.env.VOX_WORKSPACE_ROOT = root;

  await mkdir(path.join(root, "src", "lib"), { recursive: true });
  await mkdir(path.join(root, "node_modules", "junk"), { recursive: true });
  await writeFile(path.join(root, "src", "lib", "alpha.ts"), "export const alpha = 1;\n// TODO: fix the bay\n");
  await writeFile(path.join(root, "src", "lib", "beta.tsx"), "export const beta = 2;\n");
  await writeFile(path.join(root, "README.md"), "# Test workspace\n");
  await writeFile(path.join(root, ".env"), "SECRET_KEY=hunter2\n");
  await writeFile(path.join(root, "node_modules", "junk", "index.js"), "// TODO: never found\n");

  // A symlink inside the workspace pointing out of it — the escape a lexical
  // check alone does not catch.
  await mkdir(path.join(root, "outside-target"), { recursive: true });
  await writeFile(path.join(root, "..", `vox-escape-${path.basename(root)}.txt`), "escaped\n");
  await symlink(path.join(root, "..", `vox-escape-${path.basename(root)}.txt`), path.join(root, "escape-link.txt"));
});

afterAll(async () => {
  if (previousRoot === undefined) delete process.env.VOX_WORKSPACE_ROOT;
  else process.env.VOX_WORKSPACE_ROOT = previousRoot;
  await rm(root, { recursive: true, force: true });
  await rm(path.join(root, "..", `vox-escape-${path.basename(root)}.txt`), { force: true });
});

describe("workspace path containment", () => {
  it("rejects traversal out of the workspace", async () => {
    await expect(resolveWorkspacePath("../../etc/passwd")).rejects.toBeInstanceOf(PathOutsideWorkspaceError);
    await expect(resolveWorkspacePath("src/../../outside")).rejects.toBeInstanceOf(PathOutsideWorkspaceError);
  });

  it("rejects a symlink that escapes the workspace", async () => {
    // Lexically "escape-link.txt" is inside the root. Only the realpath check
    // catches this one.
    await expect(resolveWorkspacePath("escape-link.txt")).rejects.toBeInstanceOf(PathOutsideWorkspaceError);
  });

  it("accepts an ordinary path inside the workspace", async () => {
    const resolved = await resolveWorkspacePath("src/lib/alpha.ts");
    expect(resolved.startsWith(root)).toBe(true);
  });

  it("never allows reading secrets or databases, at any level", () => {
    expect(isReadablePath(".env")).toBe(false);
    expect(isReadablePath(".env.local")).toBe(false);
    expect(isReadablePath("prisma/dev.db")).toBe(false);
    expect(isReadablePath(".git/config")).toBe(false);
    expect(isReadablePath("node_modules/foo/index.js")).toBe(false);
    expect(protectionReason(".env")).toMatch(/secret/i);
  });

  it("normalises backslashes so a Windows-style path cannot dodge the patterns", () => {
    expect(isReadablePath("some\\path\\.env")).toBe(false);
    expect(isWritablePath("src\\generated\\client.ts")).toBe(false);
  });

  it("blocks writes to generated and applied-history paths that are readable", () => {
    expect(isReadablePath("src/generated/prisma/index.ts")).toBe(true);
    expect(isWritablePath("src/generated/prisma/index.ts")).toBe(false);
    expect(isWritablePath("prisma/migrations/1_init/migration.sql")).toBe(false);
    expect(protectionReason("src/generated/x.ts")).toMatch(/regenerated/i);
  });
});

describe("workspace filesystem", () => {
  it("lists a directory without exposing skipped trees", async () => {
    const entries = await listDirectory(".");
    const names = entries.map((e) => e.path);
    expect(names).toContain("README.md");
    expect(names).toContain("src");
    expect(names.some((n) => n.includes("node_modules"))).toBe(false);
    // .env is excluded by the read denylist, not merely hidden.
    expect(names.some((n) => n.endsWith(".env"))).toBe(false);
  });

  it("reads a file and reports its size", async () => {
    const result = await readWorkspaceFile("src/lib/alpha.ts");
    expect(result.content).toContain("export const alpha");
    expect(result.truncated).toBe(false);
  });

  it("reports truncation instead of silently cutting", async () => {
    // An agent reasoning about the end of a file it only saw the start of
    // produces confident, wrong edits.
    const result = await readWorkspaceFile("src/lib/alpha.ts", 10);
    expect(result.truncated).toBe(true);
    expect(result.content.length).toBeLessThanOrEqual(10);
  });

  it("refuses to read a protected file", async () => {
    await expect(readWorkspaceFile(".env")).rejects.toThrow(/secret/i);
  });

  it("searches file contents and skips dependency trees", async () => {
    const matches = await searchWorkspace("TODO");
    expect(matches.some((m) => m.path === "src/lib/alpha.ts")).toBe(true);
    expect(matches.some((m) => m.path.includes("node_modules"))).toBe(false);
  });

  it("filters search by glob", async () => {
    const all = await searchWorkspace("export const");
    const tsxOnly = await searchWorkspace("export const", { glob: "**/*.tsx" });
    expect(all.length).toBeGreaterThan(tsxOnly.length);
    expect(tsxOnly.every((m) => m.path.endsWith(".tsx"))).toBe(true);
  });

  it("rejects an invalid regular expression with a useful message", async () => {
    await expect(searchWorkspace("([")).rejects.toThrow(/Invalid search pattern/);
  });

  it("writes and creates parent directories", async () => {
    const result = await writeWorkspaceFile("src/new/thing.ts", "export const thing = true;\n");
    expect(result.created).toBe(true);
    expect(await readFile(path.join(root, "src/new/thing.ts"), "utf8")).toContain("thing = true");
  });

  it("refuses to write a protected path", async () => {
    await expect(writeWorkspaceFile(".env", "X=1")).rejects.toThrow(/secret/i);
    await expect(writeWorkspaceFile("src/generated/x.ts", "// no")).rejects.toThrow(/regenerated/i);
  });

  it("patches by exact string", async () => {
    await writeWorkspaceFile("src/lib/patchme.ts", "const value = 1;\nconst other = 2;\n");
    const result = await patchWorkspaceFile("src/lib/patchme.ts", "const value = 1;", "const value = 42;");
    expect(result.replacements).toBe(1);
    expect(await readFile(path.join(root, "src/lib/patchme.ts"), "utf8")).toContain("value = 42");
  });

  it("refuses an ambiguous patch rather than guessing which one", async () => {
    // The failure this prevents: an agent with a stale view silently editing
    // the wrong occurrence.
    await writeWorkspaceFile("src/lib/dupe.ts", "const x = 1;\nconst x = 1;\n");
    await expect(patchWorkspaceFile("src/lib/dupe.ts", "const x = 1;", "const x = 2;"))
      .rejects.toThrow(/appears 2 times/);
  });

  it("replaces every occurrence when explicitly asked", async () => {
    await writeWorkspaceFile("src/lib/dupe2.ts", "const x = 1;\nconst x = 1;\n");
    const result = await patchWorkspaceFile("src/lib/dupe2.ts", "const x = 1;", "const x = 2;", { replaceAll: true });
    expect(result.replacements).toBe(2);
  });

  it("refuses a patch whose text is absent, and says the file may have changed", async () => {
    await expect(patchWorkspaceFile("src/lib/alpha.ts", "nothing like this", "x"))
      .rejects.toThrow(/No match[\s\S]*changed/);
  });

  it("refuses a no-op patch", async () => {
    await expect(patchWorkspaceFile("src/lib/alpha.ts", "export const alpha = 1;", "export const alpha = 1;"))
      .rejects.toThrow(/identical/);
  });

  it("maps project structure within bounds", async () => {
    const structure = await projectStructure(2);
    expect(structure.some((n) => n.path === "src" && n.kind === "directory")).toBe(true);
  });
});

describe("validation is a closed set", () => {
  it("exposes only the project's own checks", () => {
    expect(VALIDATION_NAMES.sort()).toEqual(["build", "lint", "test", "typecheck"]);
    for (const name of VALIDATION_NAMES) {
      // Each maps to a real npm script name, never a composed command line.
      expect(typeof VALIDATIONS[name].script).toBe("string");
      expect(VALIDATIONS[name].script).not.toMatch(/[;&|`$]/);
    }
  });

  it("rejects anything not in the set", () => {
    expect(isValidationName("typecheck")).toBe(true);
    expect(isValidationName("rm -rf /")).toBe(false);
    expect(isValidationName("start")).toBe(false);
  });
});

describe("workspace tools in the existing registry", () => {
  it("registers the tools the execution agent needs", () => {
    for (const name of [
      "workspace.list", "workspace.structure", "workspace.read", "workspace.search",
      "workspace.git_status", "workspace.write", "workspace.patch", "workspace.validate",
    ]) {
      expect(getTool(name), `${name} should be registered`).toBeDefined();
    }
  });

  it("maps onto the EXISTING permission ladder, with writes at ACT", () => {
    // Phase 15: one authorization hierarchy, not two.
    const levels = new Set(listTools().map((t) => t.requiredLevel));
    for (const level of levels) {
      expect(["OBSERVE", "ANALYZE", "RECOMMEND", "ASK", "ACT"]).toContain(level);
    }

    expect(getTool("workspace.read")!.requiredLevel).toBe("OBSERVE");
    expect(getTool("workspace.validate")!.requiredLevel).toBe("ANALYZE");
    // The consequential ones. ACT is not granted by default.
    expect(getTool("workspace.write")!.requiredLevel).toBe("ACT");
    expect(getTool("workspace.patch")!.requiredLevel).toBe("ACT");
  });

  it("gives every workspace tool a capability key the permission system checks", () => {
    for (const tool of listTools().filter((t) => t.category === "workspace")) {
      expect(tool.capability).toMatch(/^workspace\./);
    }
  });

  it("exposes NO tool that runs an arbitrary command", () => {
    // The security boundary: agent plans come from a model reading untrusted
    // text, so a command-string tool would be remote code execution.
    for (const tool of listTools()) {
      const shape = JSON.stringify(tool.inputSchema);
      expect(tool.name).not.toMatch(/\b(exec|shell|bash|run_command|command)\b/);
      expect(shape).not.toContain("commandLine");
    }
  });

  it("validates tool input through the schema", () => {
    const validate = getTool("workspace.validate")!;
    expect(validate.inputSchema.safeParse({ check: "typecheck" }).success).toBe(true);
    expect(validate.inputSchema.safeParse({ check: "curl evil.example" }).success).toBe(false);
  });
});
