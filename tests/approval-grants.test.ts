import { describe, it, expect } from "vitest";
import { db } from "@/lib/db";
import { canonicalize, canonicalHash, hashArguments, NonCanonicalizableValueError } from "@/lib/policy/canonical";
import {
  createApprovalGrant,
  consumeApprovalGrant,
  matchesApproval,
  classificationSnapshot,
  hashClassification,
  hashRegisteredClassification,
  listLiveApprovalGrants,
  DEFAULT_APPROVAL_TTL_MS,
  MAX_APPROVAL_TTL_MS,
  type ApprovalMatchInput,
} from "@/lib/policy/approvals";
import { classifyAction, type ActionClassification } from "@/lib/policy/classification";
import { createTestUser } from "./helpers";

/** The classification `workspace.write` really has — used throughout. */
const WORKSPACE_WRITE = classifyAction("tool", "workspace.write").classification;

/** A grant for `workspace.write`, plus the match input that should satisfy it. */
async function grantFor(
  userId: string,
  over: { parsedArguments?: unknown; ttlMs?: number; amplification?: number; targetType?: string; targetId?: string } = {}
) {
  const parsedArguments = over.parsedArguments ?? { path: "src/config.ts", content: "export const a = 1;" };
  const grant = await createApprovalGrant({
    userId,
    registry: "tool",
    actionId: "workspace.write",
    parsedArguments,
    policyDecision: "HOLD",
    capability: "workspace.write",
    requiredLevel: "ACT",
    ...over,
  });
  const input: ApprovalMatchInput = {
    userId,
    registry: "tool",
    actionId: "workspace.write",
    argumentsHash: hashArguments(parsedArguments),
    classificationHash: hashRegisteredClassification("tool", "workspace.write")!.hash,
    capability: "workspace.write",
    requiredLevel: "ACT",
    ...(over.targetType ? { targetType: over.targetType } : {}),
    ...(over.targetId ? { targetId: over.targetId } : {}),
  };
  return { grant, input };
}

describe("P4-B — canonical serialization", () => {
  it("1. same object, different key order → same hash", () => {
    expect(hashArguments({ path: "config.ts", content: "hello" })).toBe(
      hashArguments({ content: "hello", path: "config.ts" })
    );
  });

  it("2. a different value → a different hash", () => {
    expect(hashArguments({ path: "config.ts" })).not.toBe(hashArguments({ path: "other.ts" }));
    // And a different TYPE with the same text is different too — no ambiguity
    // between the string "1" and the number 1.
    expect(hashArguments({ n: 1 })).not.toBe(hashArguments({ n: "1" }));
    expect(hashArguments({ n: null })).not.toBe(hashArguments({ n: "null" }));
  });

  it("3. nested key order does not matter", () => {
    expect(hashArguments({ a: { x: 1, y: [{ p: 1, q: 2 }] } })).toBe(
      hashArguments({ a: { y: [{ q: 2, p: 1 }], x: 1 } })
    );
  });

  it("4. array ORDER does matter", () => {
    expect(hashArguments({ ids: ["a", "b"] })).not.toBe(hashArguments({ ids: ["b", "a"] }));
    // An array is also never confusable with an object.
    expect(canonicalize(["a"])).not.toBe(canonicalize({ 0: "a" }));
  });

  it("5. Unicode is normalized deterministically", () => {
    const composed = "café"; // é as one code point
    const decomposed = "café"; // e + combining acute
    expect(composed).not.toBe(decomposed);
    expect(hashArguments({ name: composed })).toBe(hashArguments({ name: decomposed }));
    // Keys too, not just values.
    expect(hashArguments({ [composed]: 1 })).toBe(hashArguments({ [decomposed]: 1 }));
    // Genuinely different text still differs.
    expect(hashArguments({ name: "cafe" })).not.toBe(hashArguments({ name: composed }));
  });

  it("5b. rejects two keys that collide after normalization", () => {
    const composed = "café";
    const decomposed = "café";
    expect(() => canonicalize({ [composed]: 1, [decomposed]: 2 })).toThrow(NonCanonicalizableValueError);
  });

  it("6. number serialization is deterministic and unambiguous", () => {
    expect(hashArguments({ n: 1 })).toBe(hashArguments({ n: 1.0 }));
    // -0 and 0 are the same argument to any caller.
    expect(hashArguments({ n: -0 })).toBe(hashArguments({ n: 0 }));
    expect(hashArguments({ n: 1 })).not.toBe(hashArguments({ n: 2 }));
    expect(canonicalize({ n: 1e21 })).toBe(canonicalize({ n: 1e21 }));
    // NaN and Infinity are REJECTED rather than silently becoming null, which
    // is what JSON.stringify would do — conflating them with each other.
    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(() => canonicalize({ n: bad })).toThrow(NonCanonicalizableValueError);
    }
  });

  it("treats an absent optional and an explicit undefined as the same call", () => {
    expect(hashArguments({ path: "a.ts" })).toBe(hashArguments({ path: "a.ts", note: undefined }));
  });

  it("rejects undefined inside an array, where it would be indistinguishable from null", () => {
    expect(() => canonicalize({ xs: [1, undefined] })).toThrow(NonCanonicalizableValueError);
    // ...while a real null in an array is fine and distinct.
    expect(canonicalize({ xs: [1, null] })).toBe('{"xs":[1,null]}');
  });

  it("rejects values with no unambiguous JSON form", () => {
    // BigInt(1) rather than a `1n` literal: the project targets below ES2020.
    for (const bad of [new Date(), new Map(), new Set(), BigInt(1), Symbol("s"), () => 1]) {
      expect(() => canonicalize({ v: bad }), String(bad?.toString?.() ?? bad)).toThrow(NonCanonicalizableValueError);
    }
  });

  it("rejects a cycle instead of overflowing the stack", () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => canonicalize(cyclic)).toThrow(NonCanonicalizableValueError);
  });

  it("produces readable canonical JSON, not a bespoke encoding", () => {
    expect(canonicalize({ b: 2, a: "x" })).toBe('{"a":"x","b":2}');
    expect(canonicalHash("")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("P4-B — classification binding", () => {
  it("7. the same classification hashes the same, every time", () => {
    const first = hashRegisteredClassification("tool", "workspace.write")!.hash;
    for (let i = 0; i < 10; i++) {
      expect(hashRegisteredClassification("tool", "workspace.write")!.hash).toBe(first);
    }
  });

  it("8. changing externalSystemOfRecord changes the hash", () => {
    const base = classifyAction("tool", "economic.record_expense").classification;
    const external: ActionClassification = { ...base, externalSystemOfRecord: true };
    expect(hashClassification(classificationSnapshot("tool", "economic.record_expense", base))).not.toBe(
      hashClassification(classificationSnapshot("tool", "economic.record_expense", external))
    );
  });

  it("9. changing reversibility or effect changes the hash", () => {
    const base = classificationSnapshot("tool", "workspace.write", WORKSPACE_WRITE);
    const reversible = classificationSnapshot("tool", "workspace.write", {
      ...WORKSPACE_WRITE,
      reversibility: "REVERSIBLE",
    });
    const read = classificationSnapshot("tool", "workspace.write", { ...WORKSPACE_WRITE, effect: "READ" });
    expect(hashClassification(base)).not.toBe(hashClassification(reversible));
    expect(hashClassification(base)).not.toBe(hashClassification(read));
    // The remaining fields are semantic too.
    expect(hashClassification(base)).not.toBe(
      hashClassification(classificationSnapshot("tool", "workspace.write", { ...WORKSPACE_WRITE, financial: true }))
    );
    expect(hashClassification(base)).not.toBe(
      hashClassification(
        classificationSnapshot("tool", "workspace.write", { ...WORKSPACE_WRITE, untrustedOutput: true })
      )
    );
  });

  it("separates the two registries even where the classification is identical", () => {
    // `task.create` exists in BOTH registries with the same classification. If
    // the registry were not part of the snapshot, a proposal approval would
    // satisfy a tool call.
    const asTool = hashRegisteredClassification("tool", "task.create")!;
    const asProposal = hashRegisteredClassification("proposal", "task.create")!;
    expect(asTool.snapshot.effect).toBe(asProposal.snapshot.effect);
    expect(asTool.snapshot.reversibility).toBe(asProposal.snapshot.reversibility);
    expect(asTool.hash).not.toBe(asProposal.hash);
  });

  it("has no hash for an action VOX never classified", () => {
    expect(hashRegisteredClassification("tool", "tool.that.does.not.exist")).toBeNull();
  });

  it("10. an approval cannot match a different classification hash", async () => {
    const user = await createTestUser();
    const { grant, input } = await grantFor(user.id);
    const drifted = matchesApproval(grant, { ...input, classificationHash: "0".repeat(64) });
    expect(drifted.matches).toBe(false);
    expect(drifted.reasons).toContain("CLASSIFICATION_CHANGED");
  });

  it("refuses to issue a grant for an unclassified action", async () => {
    const user = await createTestUser();
    await expect(
      createApprovalGrant({
        userId: user.id,
        registry: "tool",
        actionId: "not.registered",
        parsedArguments: {},
        policyDecision: "HOLD",
        capability: "x",
        requiredLevel: "ACT",
      })
    ).rejects.toThrow(/not registered/);
  });
});

describe("P4-B — action binding", () => {
  it("11. same action, arguments and classification → match", async () => {
    const user = await createTestUser();
    const { grant, input } = await grantFor(user.id);
    expect(matchesApproval(grant, input)).toEqual({ matches: true, reasons: [] });
  });

  it("11b. matching is stable under argument key reordering", async () => {
    const user = await createTestUser();
    const { grant, input } = await grantFor(user.id, {
      parsedArguments: { path: "a.ts", content: "x" },
    });
    // The same call, serialized the other way round by whatever produced it.
    expect(
      matchesApproval(grant, { ...input, argumentsHash: hashArguments({ content: "x", path: "a.ts" }) }).matches
    ).toBe(true);
  });

  it("12. a different action does not match", async () => {
    const user = await createTestUser();
    const { grant, input } = await grantFor(user.id);
    expect(matchesApproval(grant, { ...input, actionId: "workspace.patch" }).reasons).toContain("WRONG_ACTION");
    expect(matchesApproval(grant, { ...input, registry: "proposal" }).reasons).toContain("WRONG_REGISTRY");
  });

  it("13. different arguments do not match", async () => {
    const user = await createTestUser();
    const { grant, input } = await grantFor(user.id, { parsedArguments: { path: "a.ts", content: "x" } });
    const tampered = matchesApproval(grant, {
      ...input,
      argumentsHash: hashArguments({ path: "/etc/passwd", content: "x" }),
    });
    expect(tampered.matches).toBe(false);
    expect(tampered.reasons).toContain("ARGUMENTS_CHANGED");
  });

  it("14. a different target does not match", async () => {
    const user = await createTestUser();
    const { grant, input } = await grantFor(user.id, { targetType: "AgentRun", targetId: "run-1" });
    expect(matchesApproval(grant, { ...input, targetId: "run-2" }).reasons).toContain("WRONG_TARGET");
    expect(matchesApproval(grant, { ...input, targetType: "Proposal" }).reasons).toContain("WRONG_TARGET");
    // Omitting the target a grant was bound to is also a mismatch.
    expect(
      matchesApproval(grant, { ...input, targetType: undefined, targetId: undefined }).reasons
    ).toContain("WRONG_TARGET");
  });

  it("places no target constraint when the grant named none", async () => {
    const user = await createTestUser();
    const { grant, input } = await grantFor(user.id);
    expect(matchesApproval(grant, { ...input, targetType: "AgentRun", targetId: "anything" }).matches).toBe(true);
  });

  it("binds the capability and the exact required level", async () => {
    const user = await createTestUser();
    const { grant, input } = await grantFor(user.id);
    expect(matchesApproval(grant, { ...input, capability: "memory.write" }).reasons).toContain("WRONG_CAPABILITY");
    // EXACT, not "at least": an approval shown for one level never silently
    // covers another, and no second copy of the ladder lives here.
    expect(matchesApproval(grant, { ...input, requiredLevel: "ASK" }).reasons).toContain("WRONG_REQUIRED_LEVEL");
    expect(matchesApproval(grant, { ...input, requiredLevel: "OBSERVE" }).reasons).toContain("WRONG_REQUIRED_LEVEL");
  });

  it("binds the approved call count", async () => {
    const user = await createTestUser();
    const { grant, input } = await grantFor(user.id, { amplification: 3 });
    expect(matchesApproval(grant, { ...input, amplification: 3 }).matches).toBe(true);
    expect(matchesApproval(grant, { ...input, amplification: 4 }).reasons).toContain("AMPLIFICATION_EXCEEDED");
    // Defaults to one when the caller does not say.
    expect(matchesApproval(grant, input).matches).toBe(true);
  });

  it("reports every reason a match failed, not just the first", async () => {
    const user = await createTestUser();
    const { grant, input } = await grantFor(user.id);
    const result = matchesApproval(grant, {
      ...input,
      actionId: "workspace.patch",
      argumentsHash: hashArguments({ different: true }),
      capability: "other",
    });
    expect(result.reasons).toEqual(
      expect.arrayContaining(["WRONG_ACTION", "ARGUMENTS_CHANGED", "WRONG_CAPABILITY"])
    );
  });
});

describe("P4-B — expiration", () => {
  it("15. an unexpired grant is valid", async () => {
    const user = await createTestUser();
    const { grant, input } = await grantFor(user.id);
    expect(grant.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(matchesApproval(grant, input).matches).toBe(true);
  });

  it("16. an expired grant is invalid", async () => {
    const user = await createTestUser();
    const { grant, input } = await grantFor(user.id);
    const afterwards = new Date(grant.expiresAt.getTime() + 1000);
    const result = matchesApproval(grant, { ...input, now: afterwards });
    expect(result.matches).toBe(false);
    expect(result.reasons).toContain("EXPIRED");
  });

  it("17. an expired grant cannot be consumed", async () => {
    const user = await createTestUser();
    const { grant } = await grantFor(user.id);
    const result = await consumeApprovalGrant(user.id, grant.id, new Date(grant.expiresAt.getTime() + 1000));
    expect(result).toEqual({ consumed: false, reason: "EXPIRED" });
    // And the row is untouched — a failed consumption spends nothing.
    const stored = await db.approvalGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(stored.consumedAt).toBeNull();
  });

  it("18. an expired grant is never implicitly renewed", async () => {
    const user = await createTestUser();
    const { grant, input } = await grantFor(user.id);
    const afterwards = new Date(grant.expiresAt.getTime() + 60_000);
    await consumeApprovalGrant(user.id, grant.id, afterwards);
    const stored = await db.approvalGrant.findUniqueOrThrow({ where: { id: grant.id } });
    // Neither the expiry nor the consumption state moved.
    expect(stored.expiresAt.getTime()).toBe(grant.expiresAt.getTime());
    expect(stored.consumedAt).toBeNull();
    expect(matchesApproval(stored, { ...input, now: afterwards }).reasons).toContain("EXPIRED");
    // It also drops out of the live list.
    expect(await listLiveApprovalGrants(user.id, afterwards)).toEqual([]);
  });

  it("uses a short default TTL and clamps anything longer", async () => {
    const user = await createTestUser();
    const now = new Date();
    const byDefault = await createApprovalGrant({
      userId: user.id,
      registry: "tool",
      actionId: "workspace.write",
      parsedArguments: { path: "a.ts", content: "x" },
      policyDecision: "HOLD",
      capability: "workspace.write",
      requiredLevel: "ACT",
      now,
    });
    expect(byDefault.expiresAt.getTime() - now.getTime()).toBe(DEFAULT_APPROVAL_TTL_MS);

    const greedy = await createApprovalGrant({
      userId: user.id,
      registry: "tool",
      actionId: "workspace.write",
      parsedArguments: { path: "b.ts", content: "x" },
      policyDecision: "HOLD",
      capability: "workspace.write",
      requiredLevel: "ACT",
      ttlMs: 30 * 24 * 60 * 60 * 1000, // a session-length TTL
      now,
    });
    expect(greedy.expiresAt.getTime() - now.getTime()).toBe(MAX_APPROVAL_TTL_MS);
  });
});

describe("P4-B — single use", () => {
  it("19. the first consumption succeeds", async () => {
    const user = await createTestUser();
    const { grant } = await grantFor(user.id);
    const result = await consumeApprovalGrant(user.id, grant.id);
    expect(result.consumed).toBe(true);
    const stored = await db.approvalGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(stored.consumedAt).not.toBeNull();
  });

  it("20. the second consumption fails", async () => {
    const user = await createTestUser();
    const { grant, input } = await grantFor(user.id);
    expect((await consumeApprovalGrant(user.id, grant.id)).consumed).toBe(true);
    expect(await consumeApprovalGrant(user.id, grant.id)).toEqual({
      consumed: false,
      reason: "ALREADY_CONSUMED",
    });
    // And it no longer matches, so a replay cannot even get as far as consuming.
    const spent = await db.approvalGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(matchesApproval(spent, input).reasons).toContain("ALREADY_CONSUMED");
  });

  it("21/22. concurrent consumption has exactly ONE winner", async () => {
    const user = await createTestUser();
    const { grant } = await grantFor(user.id);

    const attempts = await Promise.all(
      Array.from({ length: 8 }, () => consumeApprovalGrant(user.id, grant.id))
    );
    const winners = attempts.filter((a) => a.consumed);
    const losers = attempts.filter((a) => !a.consumed);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(7);
    // Every loser fails CLOSED — refused, with a reason, never a silent pass.
    for (const loser of losers) {
      expect(loser.consumed).toBe(false);
      expect(["ALREADY_CONSUMED", "EXPIRED", "NOT_FOUND"]).toContain(
        (loser as { reason: string }).reason
      );
    }
    // Exactly one consumption is recorded in the audit trail, too.
    const events = await db.event.count({
      where: { userId: user.id, type: "policy.approval_consumed", subjectId: grant.id },
    });
    expect(events).toBe(1);
  });

  it("reports NOT_FOUND for a grant that does not exist", async () => {
    const user = await createTestUser();
    expect(await consumeApprovalGrant(user.id, "no-such-grant")).toEqual({
      consumed: false,
      reason: "NOT_FOUND",
    });
  });
});

describe("P4-B — user isolation", () => {
  it("23. one user cannot consume or match another's approval", async () => {
    const owner = await createTestUser();
    const stranger = await createTestUser();
    const { grant, input } = await grantFor(owner.id);

    expect(await consumeApprovalGrant(stranger.id, grant.id)).toEqual({
      consumed: false,
      reason: "NOT_FOUND",
    });
    expect(matchesApproval(grant, { ...input, userId: stranger.id }).reasons).toContain("WRONG_USER");

    // The owner's grant is untouched and still spendable.
    const stored = await db.approvalGrant.findUniqueOrThrow({ where: { id: grant.id } });
    expect(stored.consumedAt).toBeNull();
    expect((await consumeApprovalGrant(owner.id, grant.id)).consumed).toBe(true);

    expect(await listLiveApprovalGrants(stranger.id)).toEqual([]);
  });
});

describe("P4-B — persistence", () => {
  it("24. every field survives the database round-trip", async () => {
    const user = await createTestUser();
    const now = new Date();
    const parsedArguments = { path: "src/a.ts", content: "hello", tags: ["x", "y"] };

    const created = await createApprovalGrant({
      userId: user.id,
      registry: "tool",
      actionId: "media.image.generate",
      parsedArguments,
      policyDecision: "HOLD",
      capability: "media.image.generate",
      requiredLevel: "ACT",
      amplification: 3,
      trustLabels: ["EXTERNAL_UNTRUSTED"],
      targetType: "AgentRun",
      targetId: "run-42",
      ttlMs: 5 * 60 * 1000,
      now,
    });

    const stored = await db.approvalGrant.findUniqueOrThrow({ where: { id: created.id } });
    expect(stored.userId).toBe(user.id);
    expect(stored.registry).toBe("tool");
    expect(stored.actionId).toBe("media.image.generate");
    expect(stored.argumentsHash).toBe(hashArguments(parsedArguments));
    expect(stored.argumentsHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.classificationHash).toBe(hashRegisteredClassification("tool", "media.image.generate")!.hash);
    expect(stored.policyDecision).toBe("HOLD");
    expect(stored.capability).toBe("media.image.generate");
    expect(stored.requiredLevel).toBe("ACT");
    expect(stored.amplification).toBe(3);
    // trustLabels is a JSON snapshot, per the schema's own convention.
    expect(JSON.parse(stored.trustLabels!)).toEqual(["EXTERNAL_UNTRUSTED"]);
    expect(stored.targetType).toBe("AgentRun");
    expect(stored.targetId).toBe("run-42");
    expect(stored.expiresAt.getTime()).toBe(now.getTime() + 5 * 60 * 1000);
    expect(stored.consumedAt).toBeNull();
  });

  it("records the grant in the audit trail without leaking the arguments", async () => {
    const user = await createTestUser();
    const secret = "SUPER-SECRET-FILE-CONTENT";
    const { grant } = await grantFor(user.id, { parsedArguments: { path: "a.ts", content: secret } });

    const event = await db.event.findFirstOrThrow({
      where: { userId: user.id, type: "policy.approval_granted", subjectId: grant.id },
    });
    const payload = JSON.parse(event.payload ?? "{}") as Record<string, unknown>;
    expect(payload.argumentsHash).toBe(grant.argumentsHash);
    // The hash is what the audit needs. The content is not in it.
    expect(event.payload).not.toContain(secret);
    expect(event.consequential).toBe(true);
  });

  it("lists only live grants, newest expiry last, deterministically", async () => {
    const user = await createTestUser();
    const { grant: first } = await grantFor(user.id, { parsedArguments: { path: "1.ts", content: "a" } });
    const { grant: second } = await grantFor(user.id, { parsedArguments: { path: "2.ts", content: "b" } });

    const live = await listLiveApprovalGrants(user.id);
    expect(live.map((g) => g.id).sort()).toEqual([first.id, second.id].sort());

    await consumeApprovalGrant(user.id, first.id);
    expect((await listLiveApprovalGrants(user.id)).map((g) => g.id)).toEqual([second.id]);
  });
});

describe("P4-B — enforcement is NOT enabled", () => {
  it("creating a grant executes nothing and changes no run state", async () => {
    const user = await createTestUser();
    const before = await Promise.all([
      db.agentRun.count({ where: { userId: user.id } }),
      db.agentStep.count({ where: { run: { userId: user.id } } }),
      db.permission.count({ where: { userId: user.id } }),
      db.proposal.count({ where: { userId: user.id } }),
    ]);

    await grantFor(user.id);

    expect(
      await Promise.all([
        db.agentRun.count({ where: { userId: user.id } }),
        db.agentStep.count({ where: { run: { userId: user.id } } }),
        db.permission.count({ where: { userId: user.id } }),
        db.proposal.count({ where: { userId: user.id } }),
      ])
    ).toEqual(before);
  });

  it("a grant grants no permission — the permission system is untouched", async () => {
    const user = await createTestUser();
    await grantFor(user.id);
    // A grant records what was SHOWN. It never asserts the capability is held,
    // and checkCapability() remains the only thing that answers that.
    expect(await db.permission.findMany({ where: { userId: user.id } })).toEqual([]);
  });
});
