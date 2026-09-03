/**
 * P4-B — CANONICAL SERIALIZATION AND HASHING FOR APPROVALS.
 *
 * WHY THIS IS DELICATE. An approval grant binds to a SHA-256 of its arguments.
 * The hash is the whole security property: if two logically identical argument
 * objects can hash differently, every approval fails closed at random and the
 * feature is unusable; if two logically DIFFERENT objects can hash the same, an
 * approval silently authorizes something a person never saw. The first failure
 * is annoying. The second is the vulnerability P4-B exists to close.
 *
 * So this module is deliberately strict and deliberately small. It does not
 * invent a cryptographic protocol — it produces one canonical string and hands
 * it to Node's own SHA-256, the same facility `src/lib/auth/session.ts` already
 * uses. No dependency is added.
 *
 * THE RULES, in full, because "canonical JSON" means different things to
 * different people and the exact choices are the contract:
 *
 *   OBJECTS   Keys are sorted, so insertion order cannot change the hash. That
 *             is the point of the exercise: a planner emitting
 *             `{content, path}` and a human reading `{path, content}` are
 *             approving the same call.
 *   ARRAYS    Order is PRESERVED and therefore significant. `["a","b"]` and
 *             `["b","a"]` are different arguments — for a list of file paths or
 *             version ids they plainly are — so sorting them would be a
 *             collision, not a normalization.
 *   STRINGS   Normalized to Unicode NFC before hashing, so a composed "é" and a
 *             decomposed "e"+U+0301 — identical on screen, different byte
 *             sequences — cannot produce two hashes for what a person read as
 *             one argument. Escaping is left to JSON.stringify, which is
 *             already deterministic for a single string.
 *   NUMBERS   Must be finite. NaN and Infinity are REJECTED rather than encoded,
 *             because JSON.stringify turns both into `null` and would quietly
 *             conflate them with each other and with a real null. `-0` is
 *             normalized to `0`, since they are the same value to every caller
 *             and `Object.is` is the only thing that disagrees.
 *   undefined In an object, the key is OMITTED — matching JSON.stringify, and
 *             matching what a zod-parsed optional absent field looks like, so
 *             `{path}` and `{path, note: undefined}` are one call, not two.
 *             In an ARRAY it is REJECTED: JSON.stringify would write `null` and
 *             make `[1, undefined]` indistinguishable from `[1, null]`.
 *   null      Encoded as `null`, distinct from an omitted key and from the
 *             string "null" (which is quoted).
 *   ANYTHING  Date, Map, Set, BigInt, symbol, function, class instance — all
 *   ELSE      REJECTED. None appears in a zod-parsed tool input today, and a
 *             silent `toJSON()` is exactly the kind of surprise that turns a
 *             hash into a lie. A throw forces whoever adds one to decide.
 *
 * Type ambiguity is impossible under these rules without tagging: `1` and `"1"`
 * serialize as `1` and `"1"`, `null` and `"null"` as `null` and `"null"`, an
 * array and an object as `[…]` and `{…}`. So the output is ordinary JSON that a
 * person can read in an audit, rather than a bespoke tagged encoding.
 */

import { createHash } from "node:crypto";

/** Raised when a value cannot be canonicalized unambiguously. Never swallowed. */
export class NonCanonicalizableValueError extends Error {
  constructor(
    readonly path: string,
    reason: string
  ) {
    super(`Cannot canonicalize value at ${path}: ${reason}`);
    this.name = "NonCanonicalizableValueError";
  }
}

/**
 * Bounds recursion. Tool inputs are shallow — the deepest registered schema is
 * three levels — so this is far above anything legitimate and exists only so a
 * hostile or cyclic structure fails with a clear error instead of a stack
 * overflow. Cycles are caught by this too, since a cycle is infinitely deep.
 */
const MAX_DEPTH = 32;

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const type = typeof value;
  if (type !== "object") return type;
  const name = (value as object).constructor?.name;
  return name && name !== "Object" ? name : "object";
}

function write(value: unknown, path: string, depth: number): string {
  if (depth > MAX_DEPTH) {
    throw new NonCanonicalizableValueError(path, `nesting exceeds ${MAX_DEPTH} levels (a cycle would look like this too)`);
  }

  if (value === null) return "null";

  switch (typeof value) {
    case "boolean":
      return value ? "true" : "false";

    case "number":
      if (!Number.isFinite(value)) {
        // JSON.stringify would write `null` here, conflating NaN, Infinity and
        // a genuine null into one hash. Refuse instead.
        throw new NonCanonicalizableValueError(path, `${String(value)} is not a finite number`);
      }
      // `-0` and `0` are the same argument to every caller. String() already
      // renders -0 as "0"; the explicit test documents that this is intended.
      return String(Object.is(value, -0) ? 0 : value);

    case "string":
      return JSON.stringify(value.normalize("NFC"));

    case "bigint":
      throw new NonCanonicalizableValueError(path, "bigint has no JSON representation");
    case "function":
      throw new NonCanonicalizableValueError(path, "a function is not data");
    case "symbol":
      throw new NonCanonicalizableValueError(path, "a symbol is not data");
    case "undefined":
      // Reachable only at the root or inside an array; object keys holding
      // undefined are dropped before recursing (see the object branch).
      throw new NonCanonicalizableValueError(path, "undefined cannot be encoded unambiguously here");
  }

  if (Array.isArray(value)) {
    // Order preserved: array order is meaningful in every tool input that has
    // one, so normalizing it would merge genuinely different calls.
    return `[${value.map((item, index) => write(item, `${path}[${index}]`, depth + 1)).join(",")}]`;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new NonCanonicalizableValueError(path, `${describe(value)} is not a plain object`);
  }

  // NFC-normalize keys for the same reason as string values, then reject a
  // collision rather than letting one key silently overwrite another.
  const normalized = new Map<string, unknown>();
  for (const key of Object.keys(value as Record<string, unknown>)) {
    const entry = (value as Record<string, unknown>)[key];
    // An absent optional and an explicitly-undefined optional are the same
    // call, and JSON.stringify already drops both.
    if (entry === undefined) continue;
    const normalizedKey = key.normalize("NFC");
    if (normalized.has(normalizedKey)) {
      throw new NonCanonicalizableValueError(
        `${path}.${key}`,
        `two keys collide after Unicode normalization ("${normalizedKey}")`
      );
    }
    normalized.set(normalizedKey, entry);
  }

  // Sorted by UTF-16 code unit, which is what the default comparator does and
  // is locale-independent — `localeCompare` would not be, and a hash that
  // depended on the server's locale would be a genuinely nasty bug.
  const keys = [...normalized.keys()].sort();
  const parts = keys.map(
    (key) => `${JSON.stringify(key)}:${write(normalized.get(key), `${path}.${key}`, depth + 1)}`
  );
  return `{${parts.join(",")}}`;
}

/**
 * The canonical string form of a value. Deterministic across processes,
 * machines, locales and key insertion orders.
 *
 * Throws {@link NonCanonicalizableValueError} rather than guessing. A hash that
 * cannot be computed is a refusal to approve; a hash computed from a guess is
 * an approval that means nothing.
 */
export function canonicalize(value: unknown): string {
  return write(value, "$", 0);
}

/** Lowercase hex SHA-256 of the canonical form. */
export function canonicalHash(value: unknown): string {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

/**
 * The hash an approval binds its ARGUMENTS to.
 *
 * Named separately from {@link canonicalHash} so call sites read as what they
 * are, and so the two uses can diverge later without either silently changing
 * the other's meaning.
 */
export function hashArguments(parsedArguments: unknown): string {
  return canonicalHash(parsedArguments);
}
