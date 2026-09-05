import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { db } from "@/lib/db";
import { listTools, getTool } from "@/lib/tools/registry";
import { classifyAction } from "@/lib/policy/classification";
import { evaluatePolicy } from "@/lib/policy/gate";
import { startAgentRun, resumeAgentRun } from "@/lib/agents/service";
import { grantPermission, checkCapability } from "@/lib/permissions/service";
import { createTestUser, approveAndResume } from "./helpers";

/**
 * P4-E — CAPABILITY CLASSIFICATION.
 *
 * P4-D proved every consequential action is BEHIND the enforcement boundary.
 * That is a different claim from the one this file makes:
 *
 *   A CAPABILITY MUST NOT RECEIVE A LOWER-IMPACT CLASSIFICATION THAN THE
 *   MAXIMUM CONSEQUENCE OF WHAT ITS IMPLEMENTATION CAN ACTUALLY CAUSE.
 *
 * `workspace.validate` was the counter-example: fully inside the boundary, and
 * classified `ANALYZE + REVERSIBLE` → ALLOW at a required level every account
 * holds by default. Being gated meant nothing, because the gate was told the
 * action was harmless.
 *
 * So these tests are about what the implementation CAN do, and they check
 * behaviour — whether the run actually stops, whether the process actually
 * spawned — not enum equality, except where the enum IS the invariant.
 */

let workspace: string;
let previousWorkspaceRoot: string | undefined;

beforeAll(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), "vox-p4e-"));
  previousWorkspaceRoot = process.env.VOX_WORKSPACE_ROOT;
  process.env.VOX_WORKSPACE_ROOT = workspace;
});

afterAll(async () => {
  if (previousWorkspaceRoot === undefined) delete process.env.VOX_WORKSPACE_ROOT;
  else process.env.VOX_WORKSPACE_ROOT = previousWorkspaceRoot;
  await rm(workspace, { recursive: true, force: true });
});

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out = await Promise.all(
    entries.map(async (e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return e.name === "generated" ? [] : walk(full);
      return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
    })
  );
  return out.flat();
}

/**
 * Every module in `src/` that can start a process.
 *
 * The list is derived, not declared: whatever imports `node:child_process` is
 * a process-spawning module, whether or not anyone remembered to say so.
 */
async function subprocessModules(): Promise<string[]> {
  const found: string[] = [];
  for (const file of await walk("src")) {
    const source = await readFile(file, "utf8");
    const code = source
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith("//") && !t.startsWith("*") && !t.startsWith("/*");
      })
      .join("\n");
    if (code.includes('from "node:child_process"') || code.includes('require("node:child_process")')) {
      found.push(file);
    }
  }
  return found.sort();
}

describe("P4-E — the subprocess invariant", () => {
  it("knows exactly which modules can start a process", async () => {
    // A new module spawning processes fails this test, which is the point: it
    // has to be looked at and classified, not merely merged.
    expect(await subprocessModules()).toEqual([
      "src/lib/generation/blenderLocal.ts",
      "src/lib/workspace/validate.ts",
    ]);
  }, 60_000);

  it("classifies a tool that executes repository-controlled code at its real consequence", () => {
    // `workspace.validate` runs `npm run <script>`. The script NAMES are a
    // closed set; what those names DO is whatever package.json says, and all
    // four load repository-controlled JavaScript. That is the maximum
    // consequence, so the classification has to be at least ACT + IRREVERSIBLE.
    const { classification, known } = classifyAction("tool", "workspace.validate");
    expect(known).toBe(true);
    expect(classification.effect).toBe("ACT");
    expect(classification.reversibility).toBe("IRREVERSIBLE");
    // Its output is repository-controlled text handed back to the model.
    expect(classification.untrustedOutput).toBe(true);
    // And therefore the gate holds it.
    expect(evaluatePolicy({ action: classification }).decision).toBe("HOLD");
  });

  it("requires a real grant, not the level every account holds by default", async () => {
    const user = await createTestUser();
    const tool = getTool("workspace.validate")!;
    expect(tool.requiredLevel).toBe("ACT");

    // DEFAULT_GRANTED_LEVEL is ANALYZE. Before P4-E this tool asked for ANALYZE,
    // so a brand-new account could run it having granted nothing at all.
    const check = await checkCapability(user.id, tool.capability, tool.requiredLevel);
    expect(check.allowed).toBe(false);
    expect(check.effectiveLevel).toBe("ANALYZE");
  });

  it("does not spawn the process when the policy holds it", async () => {
    const user = await createTestUser();
    // The capability is GRANTED, isolating the classification from permission.
    await grantPermission(user.id, "workspace.validate", "ACT");

    const started = await db.event.count({ where: { userId: user.id, type: "execution.validation_started" } });
    const run = await startAgentRun({
      userId: user.id,
      objective: "Check the project.",
      steps: [{ description: "Typecheck.", toolName: "workspace.validate", input: { check: "typecheck" } }],
    });

    expect(run.status).toBe("WAITING_FOR_PERMISSION");
    // The behavioural assertion: the tool's own "I am starting" event is absent,
    // so `runValidation()` was never entered and no `npm` process was spawned.
    expect(await db.event.count({ where: { userId: user.id, type: "execution.validation_started" } })).toBe(started);
    await resumeAgentRun(user.id, run.id);
    expect(await db.event.count({ where: { userId: user.id, type: "execution.validation_started" } })).toBe(started);
  });

  it("git_status stays ALLOW — a fixed-argv read that cannot run repository code", () => {
    // The separation this phase declined to make inside `validate` IS available
    // between the two tools, and it already existed. `git rev-parse`,
    // `git status --porcelain` and `git diff --stat` take fixed argument arrays,
    // and `.git/` is unreadable and unwritable to the workspace tools, which
    // closes the config/hook/alias routes to repository-controlled execution.
    const { classification } = classifyAction("tool", "workspace.git_status");
    expect(classification.effect).toBe("ANALYZE");
    expect(evaluatePolicy({ action: classification }).decision).toBe("ALLOW");
    // What it prints is still repository-controlled, and that reaches the model.
    expect(classification.untrustedOutput).toBe(true);
  });

  it("blender's subprocess is not reachable from any registered tool", async () => {
    // The other process-spawning module. It is behind the generation provider,
    // which no tool in the registry calls — so it has no capability to classify.
    // If that changes, the module list test above fires first and this one says
    // what to do about it.
    const source = await readFile("src/lib/tools/registry.ts", "utf8");
    expect(source).not.toContain("getGenerationProvider");
  });
});

describe("P4-E — a capability's name is not a security guarantee", () => {
  it("the name says analyze; the classification says act", () => {
    // Named `workspace.validate`, categorised `workspace`, described as running
    // "the project's own checks" — every surface signal says harmless. The only
    // thing that decides is the table.
    const tool = getTool("workspace.validate")!;
    expect(tool.name).toContain("validate");
    expect(tool.description.toLowerCase()).toContain("check");
    expect(classifyAction("tool", tool.name).classification.effect).toBe("ACT");
  });

  it("every registered tool is classified, so nothing defaults into harmlessness", () => {
    // An unclassified action is refused outright by `enforceExecution`, which
    // is the right failure — but a tool shipping unclassified would be a
    // permanently broken feature discovered in production. Catch it here.
    for (const tool of listTools()) {
      expect({ tool: tool.name, known: classifyAction("tool", tool.name).known }).toEqual({
        tool: tool.name,
        known: true,
      });
    }
  });

  it("no tool asks for a permission level weaker than an ALLOW decision would imply", () => {
    // The pairing that produced the P4-E bug: a HOLD-worthy action asking for
    // the default-granted level. Anything the gate holds must also require more
    // than `DEFAULT_GRANTED_LEVEL` (ANALYZE), or the human is asked once and
    // never again.
    const RANK = { OBSERVE: 0, ANALYZE: 1, RECOMMEND: 2, ASK: 3, ACT: 4 } as const;
    const offenders = listTools()
      .filter((tool) => {
        const { classification } = classifyAction("tool", tool.name);
        const held = evaluatePolicy({ action: classification }).decision !== "ALLOW";
        return held && RANK[tool.requiredLevel] <= RANK.ANALYZE;
      })
      .map((t) => t.name);
    expect(offenders).toEqual([]);
  });
});

describe("P4-E — the corrected capability still works when authorized", () => {
  it("runs once the capability is granted and a human approves the exact check", async () => {
    const user = await createTestUser();
    await grantPermission(user.id, "workspace.validate", "ACT");

    const run = await startAgentRun({
      userId: user.id,
      objective: "Check the project.",
      steps: [{ description: "Lint.", toolName: "workspace.validate", input: { check: "lint" } }],
    });
    expect(run.status).toBe("WAITING_FOR_PERMISSION");

    // The temp workspace has no package.json, so `npm run lint` exits non-zero.
    // That is a RESULT, not an error — the tool reports a failing check rather
    // than throwing — and the point here is that it was REACHED, which the
    // held run above proves it otherwise is not.
    await approveAndResume(user.id, run.id);
    expect(
      await db.event.count({ where: { userId: user.id, type: "execution.validation_started" } })
    ).toBe(1);
  }, 60_000);
});
