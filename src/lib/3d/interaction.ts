/**
 * The reusable 3D interaction model.
 *
 * Selection, hover, drill-down, isolation and exploded view — expressed once,
 * over an abstract node tree, so suits, gadgets, the Brain and lab equipment
 * all behave identically.
 *
 * The Lab already had a version of this in `src/lib/lab/drilldown.ts`, but it
 * was written in terms of suit assemblies and slot ids, so the Brain grew a
 * second, incompatible implementation inside a 630-line component. Two
 * interaction models in one product is how an app starts feeling like several
 * apps. This is the shared one; the suit-specific module now describes only
 * what is genuinely suit-specific.
 */

/** A node in any inspectable asset. Depth is arbitrary. */
export interface AssetNode {
  id: string;
  label: string;
  /** Parent id, or null at the root of the asset. */
  parentId: string | null;
  /** Free-form kind, e.g. "assembly" | "component" | "device" | "region". */
  kind?: string;
}

export interface AssetTree {
  /** Every node, keyed by id. */
  nodes: Record<string, AssetNode>;
  /** Root node ids, in presentation order. */
  roots: string[];
}

export interface InteractionState {
  /** The node the camera is currently framing. Null = whole asset. */
  focusId: string | null;
  /** The node under the pointer, if any. */
  hoverId: string | null;
  /** The node explicitly selected, which drives the inspector. */
  selectedId: string | null;
  /** When true, siblings of the focused node are hidden rather than dimmed. */
  isolated: boolean;
  /** 0..1 exploded-view amount. */
  explode: number;
}

export const INITIAL_INTERACTION: InteractionState = {
  focusId: null,
  hoverId: null,
  selectedId: null,
  isolated: false,
  explode: 0,
};

export function buildTree(nodes: AssetNode[]): AssetTree {
  const byId: Record<string, AssetNode> = {};
  for (const node of nodes) byId[node.id] = node;
  const roots = nodes.filter((n) => n.parentId === null || !byId[n.parentId]).map((n) => n.id);
  return { nodes: byId, roots };
}

/** Ancestors of `id`, nearest first. Cycle-safe. */
export function ancestorsOf(tree: AssetTree, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  let current = tree.nodes[id]?.parentId ?? null;
  while (current && tree.nodes[current] && !seen.has(current)) {
    out.push(current);
    seen.add(current);
    current = tree.nodes[current].parentId;
  }
  return out;
}

export function childrenOf(tree: AssetTree, id: string | null): string[] {
  return Object.values(tree.nodes)
    .filter((n) => n.parentId === id)
    .map((n) => n.id);
}

/** Every descendant of `id`, including `id` itself. */
export function subtreeOf(tree: AssetTree, id: string): string[] {
  const out: string[] = [id];
  const queue = [id];
  const seen = new Set<string>([id]);
  while (queue.length) {
    const current = queue.shift()!;
    for (const child of childrenOf(tree, current)) {
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

/**
 * Resolves a click, given where the user already is.
 *
 * The rule is ONE LEVEL PER CLICK. Clicking a cartridge from the whole-asset
 * view frames the arm, not the cartridge: the intermediate framings are what
 * tell you which arm you are looking at. Jumping straight to the leaf
 * disorients, and it is the single most common way a drill-down feels broken.
 */
export function selectNode(tree: AssetTree, state: InteractionState, id: string): InteractionState {
  if (!tree.nodes[id]) return state;

  const chain = [...ancestorsOf(tree, id)].reverse(); // root-first
  const path = [...chain, id];

  // How deep are we already, along this node's own ancestry?
  const currentIndex = state.focusId ? path.indexOf(state.focusId) : -1;

  // Clicking something outside the current branch switches branches rather
  // than nesting — otherwise selecting a leg while inside an arm would read
  // as descending, which it is not.
  const next = currentIndex === -1 ? path[0] : path[Math.min(currentIndex + 1, path.length - 1)];

  return { ...state, focusId: next, selectedId: id };
}

/** Steps out one level. Bottoms out at the whole asset. */
export function focusUp(tree: AssetTree, state: InteractionState): InteractionState {
  if (!state.focusId) return state;
  const parent = tree.nodes[state.focusId]?.parentId ?? null;
  return { ...state, focusId: parent, selectedId: parent };
}

export function resetInteraction(state: InteractionState): InteractionState {
  return { ...INITIAL_INTERACTION, explode: state.explode };
}

/** Root → focus, for a breadcrumb. */
export function breadcrumb(tree: AssetTree, state: InteractionState): AssetNode[] {
  if (!state.focusId) return [];
  const chain = [...ancestorsOf(tree, state.focusId)].reverse();
  return [...chain, state.focusId].map((id) => tree.nodes[id]).filter(Boolean);
}

/**
 * Which node ids the camera should frame.
 *
 * Framing the focused node alone would crop off the context that makes it
 * legible, so this returns the node AND its descendants — selecting a forearm
 * frames the web-shooter mounted on it too.
 */
export function framedIds(tree: AssetTree, state: InteractionState): string[] {
  if (!state.focusId) return [];
  return subtreeOf(tree, state.focusId);
}

export type Visibility = "visible" | "dimmed" | "hidden";

/**
 * How each node should render given the current state.
 *
 * Isolation hides siblings; without it they dim. Dimming is the better default
 * — a component with everything else removed loses the sense of where it sits
 * on the asset, which is usually the question the user is actually asking.
 */
export function visibilityOf(tree: AssetTree, state: InteractionState, id: string): Visibility {
  if (!state.focusId) return "visible";
  const framed = new Set(framedIds(tree, state));
  if (framed.has(id)) return "visible";
  // Ancestors of the focus stay visible: they are the body the part sits on.
  if (ancestorsOf(tree, state.focusId).includes(id)) return "visible";
  return state.isolated ? "hidden" : "dimmed";
}

/**
 * Outward offset direction for exploded view, as a unit-ish vector.
 *
 * Derived from the node's own position relative to its parent, so explosion
 * follows the asset's real construction rather than a hand-authored table that
 * silently rots the moment a component moves.
 */
export function explodeOffset(
  centre: [number, number, number],
  parentCentre: [number, number, number],
  amount: number,
  distance = 0.25,
): [number, number, number] {
  const dx = centre[0] - parentCentre[0];
  const dy = centre[1] - parentCentre[1];
  const dz = centre[2] - parentCentre[2];
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-6 || amount <= 0) return [0, 0, 0];
  const scale = (amount * distance) / length;
  return [dx * scale, dy * scale, dz * scale];
}
