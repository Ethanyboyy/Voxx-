# VOX 2.0 Design System

## Where this starts from

VOX already has a real design system (`src/app/globals.css`, `src/components/ui/*`)
that this session evolved once already: obsidian background, violet/purple
accent, glass panels, and — as of the last redesign pass — a "quiet luxury"
layer (`--shadow-ambient-*`, `--radius-*`, `--ease-luxury`, `.vox-eyebrow`/
`.vox-headline`/`.vox-lift`/`.vox-press`). That pass was a real improvement
over the original (neon glow → soft ambient shadow, ad-hoc spacing →
consistent tokens) but it kept purple/violet as the *dominant* surface
color, not just an accent. The VOX 2.0 master directive is explicit that
this needs to go further: **near-black neutral foundations, purple/indigo
as an accent language only, no excessive glow.** This document is that next
evolution — not a reversal of the last pass, a continuation of it.

## Visual language

PREMIUM · MINIMAL · TECHNICAL · CINEMATIC · DARK · RESTRAINED · POLISHED.
Reference: aerospace engineering displays + luxury automotive interior +
scientific visualization — not gamer HUD, not Iron Man cosplay, not SaaS
dashboard.

## Token evolution

Extend (not replace) the existing token set in `:root`:

```css
/* Neutral foundation — the base 90% of every surface. Purple no longer
   tints the background/surface tokens themselves. */
--background: #030304;        /* was #050308 — desaturate toward true near-black */
--background-2: #08090b;      /* was #0a0616 */
--surface: rgba(18, 19, 22, 0.6);       /* was purple-tinted rgba(22,15,38,...) */
--surface-solid: #0e0f12;
--surface-hover: rgba(255, 255, 255, 0.04);  /* neutral hover, not purple-tinted */
--border: rgba(255, 255, 255, 0.08);
--border-strong: rgba(255, 255, 255, 0.16);
--foreground: #f2f2f4;
--muted: #9a9aa2;
--muted-foreground: #77777f;

/* Accent — purple/indigo stays, but as a SIGNAL color: active nav, focus
   rings, primary CTA, brain-state "thinking", key data highlights. Not
   painted across ambient panel backgrounds/borders by default anymore. */
--accent: #a855f7;
--accent-2: #6366f1;
--accent-foreground: #0a0714;
--accent-muted: rgba(168, 85, 247, 0.12);   /* reserved for active/selected state, not decoration */

/* Secondary accent — cool steel/graphite blue, the "engineering" register
   for Lab/telemetry/data-viz contexts, so the whole app doesn't read as
   one color. */
--accent-steel: #7c94a8;
--accent-steel-muted: rgba(124, 148, 168, 0.12);

--accent-blue: #38bdf8;   /* kept: cognition/telemetry signal color */
--success: #34d399;
--warning: #fbbf24;
--danger: #f87171;
```

Glass surfaces (`.glass-panel`, `.glass-panel-strong`) keep their blur/
elevation mechanics unchanged but drop the purple tint from `--glass-bg`/
`--glass-border` in favor of the neutral `--surface`/`--border` tokens
above — depth comes from `--shadow-ambient-*` (already correct, keep as
is), not from color.

**Rule going forward: `--accent` and `--accent-2` may only be used for (a)
an actively-selected/focused state, (b) a primary call-to-action, (c) a
state indicator that is genuinely signaling something (VOX is thinking,
this is unread, this needs approval). Never as a panel's resting
background or border color.** This is the literal fix for "excessive
purple neon."

Typography, motion (`--ease-luxury`), radii (`--radius-*`), and the
`.vox-eyebrow`/`.vox-headline`/`.vox-lift`/`.vox-press` utilities from the
last pass are correct and stay unchanged — they're the "restrained,
technical, sophisticated spacing" half of the brief and don't need
revisiting.

## Primitive mapping

The master directive names a primitive set (`VOXSurface`, `VOXPanel`,
`VOXButton`, etc.). Building 16 new components in parallel with the
existing `src/components/ui/*` kit would itself violate the quality
standard's "no duplicated UI" rule. Instead, evolve/rename in place:

| Directive name | Maps to (existing) | Action |
|---|---|---|
| `VOXSurface` | `src/components/ui/GlassPanel.tsx` | Rename export, apply neutral tokens above. |
| `VOXPanel` | `src/components/ui/Card.tsx` | Rename export; keep `CardHeader`/`CardTitle`/`CardContent` sub-components. |
| `VOXButton` | `src/components/ui/Button.tsx` | Rename export; primary variant becomes the one legitimate large-area accent use. |
| `VOXInput` | `src/components/ui/Field.tsx` (`Input`/`Textarea`/`Select`) | Rename exports. |
| `VOXCommandBar` | `src/components/command/CommandPalette.tsx` + `src/components/lab/LabCommandBar.tsx` | Unify into one `VOXCommandBar` with a `scope` prop (`"global" \| "lab"`), rather than two parallel implementations. |
| `VOXStatus` | New — small addition to `primitives`, generalizing `LabStatusBadge`/`Badge` tone logic | Build once in `src/components/ui/`, have both Lab and core badges consume it. |
| `VOXMetric` | New — generalize the dashboard's `StatCard` pattern already used in `dashboard/page.tsx` | Extract to `src/components/ui/`. |
| `VOXDataRow` | New — generalize the list-row pattern already repeated in `ProjectsClient`/`TasksClient`/`GoalsClient` | Extract once, replace the repeated hand-rolled rows. |
| `VOXSection` | `LabSectionLabel` generalized, or the `.vox-eyebrow` + heading pattern already used everywhere | Formalize as a component instead of a class + manual `<h2>` per page. |
| `VOXModal` / `VOXDrawer` | New — no current modal/drawer primitive exists (settings/forms use inline expand-in-place) | Build once when the first real modal need appears (Milestone 6+); do not build speculatively. |
| `VOXTelemetry` / `VOXGraph` / `VOXTimeline` | New — data-viz primitives for Lab stats, Brain graph, Activity feed | Build against real data shapes already in use (`StatBar`, `UnitStat`, the Activity timeline markup) rather than a generic charting library. |
| `VOXEnvironment` | `src/components/lab/three/HolographicSuitCanvas.tsx` | Already exists as the Lab's 3D environment; the concept generalizes, the implementation doesn't need duplicating outside the Lab yet. |
| `VOXStateIndicator` | New — generalizes `BrainStateBadge` | Extract from `src/components/brain/BrainStateBadge.tsx` into a shared primitive; reuse for the offline/degraded connectivity indicator (Milestone 15). |

Every rename is additive-safe: keep a type alias / re-export at the old
name for one milestone if a rename would otherwise require touching many
call sites in the same commit as unrelated work — but do not let both names
persist past the milestone that introduces the rename.

## Explicit rejection list (unchanged from the master directive, restated as the working checklist)

Generic cards without purpose · excessive rounded-everything · excessive
gradients · excessive purple · excessive glow · fake glassmorphism ·
arbitrary one-off shadows · inconsistent spacing/typography · dead controls
· duplicate UI · fake 3D where real 3D is warranted · unfinished loading
states · broken empty states · placeholder copy · animation with no
communicative purpose · "coming soon" screens presented as finished.

## Motion

Keep the existing `--ease-luxury` cubic-bezier and the reduced-motion
guarding already in place (`@media (prefers-reduced-motion: reduce)` zeroes
`.vox-lift`/`.vox-press`/`.vox-core-anim`/`.lab-*` animations — verified
present and correct in the current `globals.css`, extend the same pattern
to any new animated primitive rather than inventing a second convention).
Animation must always encode state/depth/hierarchy/feedback/transition —
never decoration for its own sake.

## Responsive baseline

Mobile-first for every new primitive and page from here forward (Milestone
16 makes this explicit for the whole app, but new work should not
introduce new desktop-first regressions in the meantime). Minimum tap
target 44px is already enforced globally for coarse-pointer input
(`@media (pointer: coarse)` in `globals.css`) — keep relying on it rather
than hand-setting heights per component.
