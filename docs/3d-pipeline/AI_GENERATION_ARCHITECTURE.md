# VOX 3D — AI-assisted generation architecture

**Status: BLOCKED at the authentication/connectivity gate. Neither engine can
run in this environment. No generation has been attempted and no credits have
been spent.**

The directive's own instruction was to prove both engines are connected before
rebuilding anything. They are not. This document records the audit, the exact
evidence, the architecture to build, and precisely what is needed to unblock it.

---

## 1. Connectivity verification — what was actually tested

### 1.1 Tooling installs cleanly

Both packages come from npm, which is on the proxy's bypass list, so the tooling
side is fine:

| Package | Version | Result |
| --- | --- | --- |
| `tripo-cli` | 0.3.1 | installed, binary at `/opt/node22/bin/tripo`, `--help` works |
| `@meshy-ai/meshy-mcp-server` | 0.5.1 | resolves and starts |

### 1.2 Both engines demand credentials that do not exist here

```
$ tripo make "test cube" --yes --json
{"error":"no API key configured","exit_code":3,
 "suggestion":"run \"tripo login\" to configure an API key"}

$ npx @meshy-ai/meshy-mcp-server
Fatal error: MESHY_API_KEY environment variable is required.
Get your API key from https://www.meshy.ai/settings/api
```

Searched for existing credentials and found none: no `TRIPO_*` or `MESHY_*` in
the process environment, and zero matches in `.env`.

### 1.3 Both APIs are blocked by organizational egress policy

This is the harder blocker, and it is independent of the credential problem —
**supplying an API key would not make either engine work.**

```
api.tripo3d.ai        curl: (56) CONNECT tunnel failed, response 403
platform.tripo3d.ai   curl: (56) CONNECT tunnel failed, response 403
tripo3d.ai            curl: (56) CONNECT tunnel failed, response 403
api.meshy.ai          curl: (56) CONNECT tunnel failed, response 403
www.meshy.ai          curl: (56) CONNECT tunnel failed, response 403
app.meshy.ai          curl: (56) CONNECT tunnel failed, response 403
assets.meshy.ai       curl: (56) CONNECT tunnel failed, response 403
```

Probed with a bearer token against the real endpoints the clients call
(`/v2/openapi/task`, `/openapi/v2/text-to-3d`) — same 403 at CONNECT, i.e. the
TLS session is never established. The proxy's own status endpoint classifies
these as `"gateway answered 403 to CONNECT (policy denial or upstream failure)"`.

Its bypass list is the whole allowlist, and it is narrow:

```
registry.npmjs.org, jsr.io, npm.jsr.io, pypi.org, files.pythonhosted.org,
index.crates.io, proxy.golang.org, api.anthropic.com, + private ranges
```

Package registries only. No asset or inference host of any kind is reachable —
consistent with every other hosted 3D service tested in this project
(Higgsfield, Hyper3D/Rodin, fal.run, Hugging Face, Sketchfab, PolyHaven).

**Per the directive: stopping at the authentication step. No credentials were
invented, no API key was fabricated, and no generation was attempted.**

---

## 2. What is needed to unblock

Both are required. Either alone is insufficient.

1. **Egress allowlist entries** for `api.tripo3d.ai`, `platform.tripo3d.ai`,
   `api.meshy.ai`, `assets.meshy.ai` (asset downloads land on a separate host
   from the API, so both must be permitted or generated models cannot be
   fetched). Added by whoever administers the environment's network policy —
   not something to work around from inside, and no attempt was made to.
2. **Credentials**, supplied as environment variables so they never enter the
   repository:
   - `TRIPO_API_KEY` — from the Tripo platform. The CLI also accepts
     `tripo login`, which writes `~/.tripo`; the env var is preferable here
     because the container is ephemeral.
   - `MESHY_API_KEY` — from `https://www.meshy.ai/settings/api`.

Both belong in `.env.example` as documented, absent-by-default entries when the
adapters land, per `CLAUDE.md` rule 6.

---

## 3. Verified engine capabilities

Read from the installed packages, not from documentation or memory.

### 3.1 Tripo CLI (`tripo make <input...>`)

| Flag | Relevance to VOX |
| --- | --- |
| `-n, --candidates <n>` | **Native A/B**: N parallel candidates in one command — exactly what Phase 24 needs |
| `--for <scenario>` | `game-mobile\|game-pc\|film\|print\|ar-web\|anim\|toy` — `game-pc` for hero, `ar-web` for delivery |
| `--then <steps>` | Chained post-processing, e.g. `texture,rig,convert:fbx` |
| `--seed <n>` | Reproducible geometry — the same seed re-derives a candidate |
| `--model <model>` | `tripo-v3.1`, `tripo-p1`, … |
| `--json`, `--no-wait` | Machine-readable output and submit-without-blocking, for the orchestrator |

Input accepts text, image files, a model file, a URL, a task id, or `@last` —
so image and multi-view workflows are first-class, which Phase 4 requires.

### 3.2 Meshy MCP tools

Twenty-nine registered tools. The ones that matter here:

- **Generation**: `meshy_text_to_3d`, `meshy_image_to_3d`,
  `meshy_multi_image_to_3d`, `meshy_text_to_3d_refine`
- **Concept**: `meshy_text_to_image`, `meshy_image_to_image` — lets the concept
  stage happen inside the same engine
- **Post**: `meshy_remesh`, `meshy_retexture`, `meshy_uv_unwrap`, `meshy_rig`,
  `meshy_animate`, `meshy_convert`, `meshy_resize`
- **Ops**: `meshy_get_task_status`, `meshy_list_tasks`, `meshy_cancel_task`,
  `meshy_download_model`, `meshy_check_balance`

Endpoints: `/openapi/v2/text-to-3d`, `/openapi/v1/image-to-3d`,
`/openapi/v1/multi-image-to-3d`, `/openapi/v1/remesh`, `/openapi/v1/retexture`,
`/openapi/v1/rigging`, `/openapi/v1/animations`, `/openapi/v1/text-to-image`,
`/openapi/v1/image-to-image`.

`meshy_check_balance` is the credit guard Phase 25 needs — the ledger can record
real balance before and after every job rather than estimating.

---

## 4. Repository audit — KEEP / ADAPT / DEPRECATE

Nothing is deleted. The procedural pipeline stops being the *creative* source
for hero characters and becomes the finishing and validation environment, which
is the role it is genuinely good at.

### KEEP — unchanged, still correct

| Component | Why |
| --- | --- |
| `src/lib/generation/assetContract.ts` | Engine-agnostic. Validates a bundle regardless of who produced the mesh. The 17 HERO checks apply to a Tripo or Meshy asset unchanged. |
| `tools/3d-pipeline/inspect_glb.py` | Parses the GLB container directly. More valuable with external assets, not less — a downloaded model is exactly the case where you cannot trust the producer's own claims. |
| `tools/3d-pipeline/meshops.py` | Validated mesh operations, boolean safety, non-manifold detection, UV unwrap. Applies to any mesh. |
| `tools/3d-pipeline/rendering.py` | Diagnostic + cinematic rigs and the 11-view QA set. This is the visual QA harness Phase 22 asks for; it already exists. |
| `tools/3d-pipeline/contract.py` | Bundle writing, measured stats, provenance. |
| `src/lib/generation/` provider abstraction | Written for exactly this: Tripo and Meshy become two more `GenerationProvider` implementations. `isConfigured`/`unavailableReason` already model the blocked state honestly. |
| Suit DB, `modelUrl`, drill-down, `FocusRig`, `WristSystem`, Brain, event bus | Untouched, per Phase 28. |

### ADAPT — keep, repoint

| Component | Change |
| --- | --- |
| `tools/3d-pipeline/texturing.py` | Its per-texel bake assumes a UV layout this pipeline generated. Retarget to bake VOX design language onto an externally generated mesh's UVs, or retire in favour of engine-produced PBR if that proves better. Decide on evidence, after the A/B. |
| `tools/3d-pipeline/build_suit.py` | Becomes a fallback recipe rather than the hero path. |
| `garment.py` seam/mask/lens code | The mask-from-head-surface technique is sound and engine-independent; reusable as a finishing operation. |

### DEPRECATE as the hero creative path — retain as fallback

`anatomy.py`, `body.py`, `sculpt.py` — the skeleton graph, Skin surfacing and
displacement fields. They produce a *competent athletic base* and will not reach
the stated bar; that is the finding this directive acts on. They stay for
fallback, validation, and deformation helpers, and they remain the only path
that works with zero network access.

### EXTEND — new, once unblocked

```
src/lib/3d/
  tripo/     client · generation · polling · download · metadata · errors · retry
  meshy/     client · MCP bridge · generation · polling · download
  director/  engine selection · candidate comparison · accept/reject · ledger
```

---

## 5. Target architecture

```
CONCEPT BRIEF (design bible)
      │
      ├─► Meshy text-to-image / image-to-image ──► concept sheet
      │                                                │
      │                                          VISUAL REVIEW  ◄── reject early,
      │                                                │            before 3D spend
      ├─► Tripo  make -n 3 --for game-pc ──┐     multi-view concept
      └─► Meshy  multi_image_to_3d ────────┤           │
                                           ▼           ▼
                                     CANDIDATE SET (Tripo A/B/C, Meshy A/B/C)
                                           │
                                     A/B COMPARISON  ── anatomy, silhouette,
                                           │            topology, materials
                                     SELECT / HYBRID
                                           │
                                     BLENDER FINISHING  ── cleanup, UVs, VOX
                                           │               materials, seams,
                                           │               web, components
                                     RENDER (11 views + clay)
                                           │
                                     VISUAL QA ── reject → regenerate from a
                                           │        better concept, never patch
                                           │        a bad generation
                                     TECHNICAL QA (assetContract + inspect_glb)
                                           │
                                     modelUrl assigned
```

**Claude is the art director**: writes briefs, reviews concepts, compares
candidates, rejects, and decides hybrids. **Tripo and Meshy are the modelling
engines. Blender is finishing. VOX is the runtime.**

### Engine selection, to be decided by the A/B and not assumed

Both engines get the same brief. The recorded hypothesis — to be confirmed or
refuted by real output, not asserted now:

- **Organic hero character** — Meshy's multi-image-to-3D fed by its own concept
  images keeps art direction in one loop.
- **Hard-surface components** (web-shooter, lens housing, lab tooling) — Tripo's
  `--for game-pc` and `-n` candidates suit mechanical forms and cheap variation.
- **Hybrid is an acceptable outcome** and is explicitly allowed.

---

## 6. Credit discipline

`docs/3d-pipeline/GENERATION_LEDGER.md` records every job before it is run:
engine, prompt, input reference, task id, credits, output, verdict, and the
reason for any rejection. `meshy_check_balance` gives real balance readings
rather than estimates. A failed generation is diagnosed before another is spent.

The ledger currently records zero jobs and zero credits.

---

## 7. Why the old pipeline is not simply deleted

It is the only path that works with no network at all, it owns the QA harness
and the asset contract that any external asset must still pass, and its
finishing operations are engine-independent. Deleting it would remove the
validation layer at the exact moment the project starts ingesting meshes from
third-party services — which is when validation matters most.
