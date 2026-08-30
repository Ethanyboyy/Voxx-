# 3D / Generation MCP — evaluation and decision

**Decision: do not install a Blender MCP server. Use `bpy` (Blender's Python
API, from PyPI) directly, driven by scripts in `tools/3d-pipeline/`.**

This is not a preference. Every candidate MCP was evaluated against what this
container can actually do, and each one fails on a measured constraint. The
evidence is below so the decision can be re-checked — and reversed — if the
environment changes.

---

## 1. Candidates considered

| Candidate | Source | Verified how |
| --- | --- | --- |
| `blender-mcp` 1.9.0 | PyPI (`ahujasid/blender-mcp`) | Downloaded the wheel and read its source |
| `blender-remote` 1.3.3 | PyPI (`igamenovoer/blender-remote`) | PyPI metadata |
| Higgsfield MCP | `platform.higgsfield.ai` | Host reachability |
| Hyper3D / Rodin | `hyperhuman.deemos.com`, `queue.fal.run` | Host reachability |
| Hunyuan3D | `huggingface.co` (weights) | Host reachability |
| `bpy` (no MCP) | PyPI | **Installed and exercised end to end** |

GitHub MCP was available but is scoped to `ethanyboyy/voxx-` only —
`ahujasid/blender-mcp` returned *"Access denied: repository … is not configured
for this session."* So repository research went through PyPI's API and the
package's own source instead, which is a primary source either way.

---

## 2. Why `blender-mcp` cannot work here

Read directly from `blender_mcp-1.9.0-py3-none-any.whl`:

**2.1 It is a bridge to a *running Blender application*, not a renderer.**
`blender_mcp/bundled/addon.py` is a Blender addon (`bl_info` at line 29). It
opens a socket server on `localhost:9876` (line 446) and drains its command
queue from `bpy.app.timers` **on Blender's main thread** (lines 557–559). The
MCP server is a client of that socket. It does no 3D work itself — it forwards
Python into a Blender process that must already exist.

**2.2 There is no Blender application here, and there cannot be.**
`which blender` → empty. Blender's own download host is egress-blocked:

```
download.blender.org        curl: (56) CONNECT tunnel failed, response 403
mirrors.ocf.berkeley.edu    curl: (56) CONNECT tunnel failed, response 403
```

Obtaining the binary would require defeating an organizational egress control.
That is out of bounds, and it is the single hard blocker.

**2.3 Several of its tools need a GUI that a headless container does not have.**
`get_viewport_screenshot` (server.py:460) captures a Blender *viewport*. There
is no display server here.

**2.4 Every external service it integrates is blocked.** Extracted from its
source, then tested:

| Host it calls | Purpose | Reachability |
| --- | --- | --- |
| `hyperhuman.deemos.com` | Hyper3D / Rodin generation | **403 blocked** |
| `queue.fal.run` | Hyper3D via fal.ai | **403 blocked** |
| `api.sketchfab.com` | asset marketplace | **403 blocked** |
| `api.polyhaven.com` | HDRI/texture library | **403 blocked** |
| `api.poly.pizza` | model library | **403 blocked** |
| `*.supabase.co` | telemetry | **403 blocked** |

Not one is reachable. Installing it would buy zero working tools.

**2.5 It ships telemetry that is on by default.** `blender_mcp/telemetry.py`
sends usage data to a Supabase endpoint unless disabled via `DISABLE_TELEMETRY`
/ `BLENDER_MCP_DISABLE_TELEMETRY` / `MCP_DISABLE_TELEMETRY`, or the
`disable_telemetry` tool (server.py:349). Opt-*out* telemetry on a personal
Cognitive OS conflicts with `CLAUDE.md` rule 6 — anything shipping user content
to a third party must be strictly opt-in. Blocked or not, this is the wrong
default to adopt.

`blender-remote` fails for exactly the same root reason: it automates a Blender
*installation*, which cannot be obtained here.

---

## 3. Why the hosted generation MCPs cannot work here

Higgsfield, Hyper3D/Rodin, and Hunyuan3D were all evaluated and all fail at the
same step — the network:

```
platform.higgsfield.ai      403 blocked   (also confirmed in an earlier session)
api.hyper3d.ai              403 blocked
hyperhuman.deemos.com       403 blocked
queue.fal.run               403 blocked
huggingface.co              403 blocked   (Hunyuan3D weights)
```

Hunyuan3D deserves a specific note because it is self-hostable in principle and
so looks like a way around the egress problem: it is not. Its weights are
distributed via Hugging Face, which is blocked, and inference needs a CUDA GPU
this container does not have. Both halves fail independently.

**No credits were spent and no account was charged during this evaluation.**

---

## 4. What was chosen instead, and why it is better here

`bpy` — the Blender Python module, published to PyPI by the Blender Foundation.
PyPI is reachable, so this respects the egress policy completely.

Verified in this container, not assumed:

- `bpy 5.0.1`, `bpy-5.0.1-cp311-cp311-manylinux_2_28_x86_64.whl`, against
  Python 3.11.15.
- `import bpy` → `bpy.app.version_string == '5.0.1'`.
- Built geometry, applied `BEVEL` + `SUBSURF` modifiers, authored a Principled
  BSDF, rendered **Cycles / CPU / 24 samples / 320×320 in 2.1 s**, exported a
  1,076,480-byte GLB. The render was opened and visually checked.

It is worth being clear that this is not a downgrade forced by circumstance. On
the merits it is the better fit for this repository:

| | `blender-mcp` | `bpy` directly |
| --- | --- | --- |
| Needs a Blender install | Yes — **unobtainable here** | No, the wheel *is* Blender |
| Needs a GUI/viewport | Yes, for several tools | No |
| Works headless | Partially | Fully |
| Reproducible | Conversational, stateful GUI session | Scripts in git, same output every run |
| Reviewable in a PR | No | Yes — the model is source code |
| Telemetry | On by default | None |
| Network at author time | Required | None after install |

The last three are the ones that matter for VOX. An asset produced by a
committed script can be diffed, reviewed, re-run, and explained. An asset
produced by a GUI conversation cannot. For a project whose whole premise is that
claims must be traceable to real data, a scripted model is the honest form.

---

## 5. What is deliberately kept open

The `GenerationProvider` abstraction (`src/lib/generation/`) exists so this
decision is not a dead end. It mirrors `src/lib/ai/` exactly: providers are
selected by env var, absent by default, and a remote provider is added by
writing one module and registering it. If Higgsfield, Rodin, or a self-hosted
Hunyuan3D ever becomes reachable, it drops in without touching the pipeline, the
asset contract, or the viewer.

Per `CLAUDE.md` rule 6, any such provider ships user content to a third party and
must therefore be strictly opt-in, gated behind its own explicit env var, and
documented in `.env.example` and `SECURITY.md`. None is enabled today, and none
is faked: a provider that cannot reach its service reports that, and never
returns a fabricated asset.

---

## 6. Conditions that would reverse this decision

Concrete, so this can be re-tested rather than re-argued:

1. `download.blender.org` becomes reachable **and** a display server is
   available → `blender-mcp` becomes viable for interactive authoring. Even
   then, the scripted path stays the one that produces committed assets.
2. A generation host becomes reachable → add a `GenerationProvider`
   implementation; nothing else changes.
3. A GPU with CUDA plus reachable weights appear → self-hosted Hunyuan3D becomes
   a real option.

Re-run the reachability table in `ARCHITECTURE.md` §2.1 before assuming any of
these has changed.
