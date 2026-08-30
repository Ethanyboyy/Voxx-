import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { GenerationCapability, GenerationProvider, GenerationRequest, GenerationResult } from "@/lib/generation/types";

const execFileAsync = promisify(execFile);

/**
 * Blender, as a local Python module.
 *
 * Not a hosted service and not an MCP bridge: `bpy` is the Blender Foundation's
 * own build of Blender published to PyPI, imported in-process by a plain
 * Python interpreter. Nothing leaves this machine. See
 * docs/3d-pipeline/MCP_DECISIONS.md for why this was chosen over the available
 * Blender MCP servers (short version: they bridge to a Blender *application*
 * that cannot be obtained here, and every external service they call is
 * blocked by egress policy).
 *
 * This provider is strictly opt-in. `VOX_BLENDER_PYTHON` must point at a
 * Python interpreter that has `bpy` installed; absent that, the provider
 * reports itself unconfigured and refuses to run. It never falls back to
 * producing something else — a generation pipeline that quietly returns a
 * stand-in asset is worse than one that fails, because the stand-in ends up in
 * LabSuit.modelUrl presented as a real object.
 */

/** Closed set of authoring recipes. */
const RECIPES: Record<string, string> = {
  suit: "build_suit.py",
};

export class BlenderLocalProvider implements GenerationProvider {
  readonly id = "blender-local";
  readonly displayName = "Blender (local bpy)";
  readonly capabilities: readonly GenerationCapability[] = ["SCRIPTED_GEOMETRY", "RENDER"];

  private readonly pythonPath: string | null;
  private readonly toolsDir: string;

  constructor(pythonPath: string | null, toolsDir?: string) {
    this.pythonPath = pythonPath;
    this.toolsDir = toolsDir ?? path.join(process.cwd(), "tools", "3d-pipeline");
  }

  get isConfigured(): boolean {
    return this.unavailableReason === null;
  }

  get unavailableReason(): string | null {
    if (!this.pythonPath) {
      return "VOX_BLENDER_PYTHON is not set. Point it at a Python interpreter with `bpy` installed (pip install bpy).";
    }
    if (!existsSync(this.pythonPath)) {
      return `VOX_BLENDER_PYTHON points at "${this.pythonPath}", which does not exist.`;
    }
    if (!existsSync(this.toolsDir)) {
      return `Authoring scripts not found at ${this.toolsDir}.`;
    }
    return null;
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const reason = this.unavailableReason;
    if (reason || !this.pythonPath) {
      throw new Error(`BlenderLocalProvider is not configured: ${reason}`);
    }

    const script = RECIPES[request.recipe];
    if (!script) {
      // A closed recipe table rather than an arbitrary script path: this
      // provider runs a subprocess, and "run whatever you were handed" is not
      // something that should be reachable from application code.
      throw new Error(`Unknown recipe "${request.recipe}". Known recipes: ${Object.keys(RECIPES).join(", ")}`);
    }

    const outDir = path.join(process.cwd(), "public", "models", "suits", request.suitId);
    const args = [path.join(this.toolsDir, script), "--suit-id", request.suitId, "--out-dir", outDir];
    for (const [k, v] of Object.entries(request.parameters ?? {})) {
      args.push(`--${k}`, String(v));
    }

    const started = Date.now();
    const { stdout, stderr } = await execFileAsync(this.pythonPath, args, {
      // Blender builds are slow and this is an offline authoring step, not a
      // request path. Still bounded — a hung bpy process must not wedge a job.
      timeout: 15 * 60 * 1000,
      maxBuffer: 32 * 1024 * 1024,
    });

    const log = [...stdout.split("\n"), ...stderr.split("\n")].map((l) => l.trimEnd()).filter(Boolean);

    const glbPath = path.join(outDir, "suit.glb");
    if (!existsSync(glbPath)) {
      throw new Error(`Recipe "${request.recipe}" completed but produced no suit.glb at ${glbPath}`);
    }

    return {
      glbPath,
      modelUrl: `/models/suits/${request.suitId}/suit.glb`,
      renderPaths: log
        .filter((l) => l.startsWith("RENDER "))
        .map((l) => l.slice("RENDER ".length).trim())
        .filter(Boolean),
      durationMs: Date.now() - started,
      log,
    };
  }
}
