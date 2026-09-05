import { db } from "@/lib/db";
import { checkCapability } from "@/lib/permissions/service";
import { recordEvent } from "@/lib/observability/events";
import { getTool } from "@/lib/tools/registry";
import { recordShadowPolicyEvaluation, withPolicyBoundary } from "@/lib/policy/gate";
import { evaluateApprovalForExecution, hashArguments, hashRegisteredClassification } from "@/lib/policy/approvals";
import { logger } from "@/lib/observability/logger";
import type { ToolExecutionContext } from "@/lib/tools/types";
import { hasStepReference, resolveStepReferences } from "@/lib/agents/references";
import type { AgentRun, AgentStep } from "@/generated/prisma/client";

const MAX_RETRIES = 1;

/**
 * The execution engine (§14): runs an AgentRun's steps in order, one at a
 * time. Every tool-bound step goes through the exact same checkCapability()
 * used everywhere else in VOX — a denied/ungranted capability pauses the
 * run at WAITING_FOR_PERMISSION rather than skipping or bypassing the
 * check. Never marks a step COMPLETED unless its tool actually returned
 * successfully (§30 — never claim success falsely).
 */
export async function executeRun(userId: string, runId: string): Promise<AgentRun & { steps: AgentStep[] }> {
  let run = await db.agentRun.findFirst({ where: { id: runId, userId }, include: { steps: { orderBy: { order: "asc" } } } });
  if (!run) throw new Error("Agent run not found.");
  if (run.status === "COMPLETED" || run.status === "CANCELLED" || run.status === "FAILED") return run;

  // Agent-level capability allowlist (§ Agent model doc comment in schema.prisma):
  // a second, stricter restriction on top of the user's own Permission grants.
  // Only applies to runs started from a persistent Agent definition; ad hoc
  // runs (agentId null) are governed solely by the normal checkCapability() gate.
  let allowedCapabilities: string[] | null = null;
  if (run.agentId) {
    const agent = await db.agent.findUnique({ where: { id: run.agentId } });
    allowedCapabilities = agent ? (JSON.parse(agent.allowedCapabilities) as string[]) : [];
  }

  if (run.status === "PLANNING") {
    run = await db.agentRun.update({ where: { id: run.id }, data: { status: "RUNNING" }, include: { steps: { orderBy: { order: "asc" } } } });
    await recordEvent({ userId, type: "agent.run.started", subjectType: "AgentRun", subjectId: run.id, payload: { objective: run.objective } });
  }

  // What earlier steps actually produced, keyed by step order — the source
  // for {{stepN.output}} references below. Seeded from the persisted rows so
  // it is correct on a fresh run and on one resumed after a permission pause,
  // then extended in-place as this pass completes further steps.
  // What this run is FOR. A run started by the supervisor carries its
  // objective into every tool call, so work performed in pursuit of a goal
  // (research especially) retains that goal on its results — the same
  // association a human gets by scoping the work manually. Resolved once per
  // pass; an ad hoc run without a supervisor simply has no context.
  let executionContext: ToolExecutionContext | undefined;
  if (run.supervisorRunId) {
    const supRun = await db.supervisorRun.findUnique({
      where: { id: run.supervisorRunId },
      select: { objectiveId: true },
    });
    if (supRun) executionContext = { objectiveId: supRun.objectiveId };
  }

  const stepOutputs = new Map<number, unknown>();
  for (const step of run.steps) {
    if (step.status !== "COMPLETED" || !step.output) continue;
    try {
      stepOutputs.set(step.order, JSON.parse(step.output));
    } catch {
      // A step whose stored output isn't parseable simply isn't referenceable;
      // any reference to it fails loudly at resolution time rather than here.
    }
  }

  for (const step of run.steps) {
    if (step.order < run.currentStep) continue;
    if (step.status === "COMPLETED" || step.status === "SKIPPED") continue;

    if (!step.toolName) {
      await db.agentStep.update({
        where: { id: step.id },
        data: { status: "COMPLETED", startedAt: new Date(), completedAt: new Date(), output: JSON.stringify({ note: step.description }) },
      });
      run = await advance(run.id, step.order);
      continue;
    }

    const tool = getTool(step.toolName);
    if (!tool) {
      return await failRun(userId, run.id, step.id, `Unknown tool "${step.toolName}" — the planner referenced a tool that doesn't exist in the registry.`);
    }

    if (allowedCapabilities !== null && !allowedCapabilities.includes(tool.capability)) {
      // Not a WAITING_FOR_PERMISSION pause: no Permission grant can fix this —
      // only editing the Agent's own allowedCapabilities can. Fail outright
      // rather than parking the run in a state that looks resumable.
      return await failRun(
        userId,
        run.id,
        step.id,
        `This agent is not permitted to use capability "${tool.capability}" (tool "${tool.name}"). Add it to the agent's allowed capabilities to enable this.`
      );
    }

    // ---- [P4-C1] FINALIZE THE ARGUMENTS BEFORE THE PERMISSION BOUNDARY ----
    //
    // This block used to sit BELOW `checkCapability()`, and that ordering was a
    // real defect. A step parked at WAITING_FOR_PERMISSION still held its
    // authored template — `{{step0.output}}` — in `step.input`, so what a human
    // was shown while deciding was not what would eventually run. References
    // resolved later, at execution time, against state that may have moved.
    //
    // Resolving first makes the arguments FINAL before anyone is asked about
    // them, and persisting them makes that finalization authoritative: on
    // resume, `hasStepReference()` is false, resolution is a no-op, and the
    // executor cannot re-resolve the same logical step into different values.
    //
    // One consequence is deliberate. A step whose input is malformed or whose
    // references cannot resolve now FAILS instead of parking for a permission.
    // That is the honest outcome — no grant of any capability could make such a
    // step runnable, so parking it invited a person to authorize something that
    // was never going to happen.
    let input: unknown;
    try {
      input = step.input ? JSON.parse(step.input) : {};
    } catch {
      return await failRun(userId, run.id, step.id, "Step input was not valid JSON.");
    }

    // Substitute {{stepN.output...}} references with what earlier steps
    // actually produced. Sourced from stepOutputs, which is rebuilt from the
    // persisted rows on every call, so a run that paused for permission and
    // resumed later still resolves its references correctly.
    let resolvedInputJson: string | null = null;
    if (hasStepReference(input)) {
      const resolution = resolveStepReferences(input, stepOutputs);
      if (resolution.unresolved.length > 0) {
        return await failRun(
          userId,
          run.id,
          step.id,
          `Could not resolve step reference(s) ${resolution.unresolved.join(", ")} — the referenced step did not complete, or that path is absent from its output.`
        );
      }
      input = resolution.value;
      // Persist what the tool is actually being called with, so an inspected
      // run shows the real value rather than an unresolved "{{step0.output}}"
      // that reveals nothing about what happened. The authored template is
      // not lost — it stays in SupervisorRun.plan, the plan's own snapshot.
      resolvedInputJson = JSON.stringify(input);
    }

    const parsedInput = tool.inputSchema.safeParse(input);
    if (!parsedInput.success) {
      return await failRun(userId, run.id, step.id, `Invalid input for tool "${tool.name}": ${parsedInput.error.message}`);
    }

    // The finalized arguments, written down before anything is asked of a human.
    // `parsedInput.data` rather than `input` is what gets hashed below, because
    // it is what `tool.execute()` actually receives — zod may strip unknown keys
    // and apply defaults, and a hash of the pre-parse shape would bind something
    // subtly different from what runs.
    if (resolvedInputJson) {
      await db.agentStep.update({ where: { id: step.id }, data: { input: resolvedInputJson } });
    }
    const argumentsHash = hashArguments(parsedInput.data);

    const check = await checkCapability(userId, tool.capability, tool.requiredLevel);
    if (!check.allowed) {
      await db.agentStep.update({ where: { id: step.id }, data: { status: "WAITING_FOR_PERMISSION", capability: tool.capability, requiredLevel: tool.requiredLevel } });
      const waiting = await db.agentRun.update({
        where: { id: run.id },
        data: { status: "WAITING_FOR_PERMISSION", currentStep: step.order },
        include: { steps: { orderBy: { order: "asc" } } },
      });
      // [P4-C1] The pending approval REQUEST — deliberately NOT an ApprovalGrant.
      //
      // A grant means a human said yes. The executor reaching a boundary is not
      // a human saying anything, so the executor must never mint one; if it
      // could, the grant would be VOX approving itself and the whole
      // argument-binding apparatus would be authorizing its own output. So this
      // records the request instead, carrying the three things P4-C2's approval
      // endpoint needs to verify consent against something real: the step's
      // stable identity and the hash of the now-final arguments.
      await recordEvent({
        userId,
        type: "agent.step.waiting_for_permission",
        subjectType: "AgentRun",
        subjectId: run.id,
        payload: {
          step: step.order,
          stepId: step.id,
          tool: tool.name,
          capability: tool.capability,
          requiredLevel: tool.requiredLevel,
          argumentsHash,
          argumentsFinalized: true,
        },
      });
      return waiting;
    }

    await db.agentStep.update({
      where: { id: step.id },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        capability: tool.capability,
        requiredLevel: tool.requiredLevel,
      },
    });

    // THE POLICY GATE (P2), in shadow mode. This is the narrowest boundary that
    // covers everything: `tool.execute()` below is the ONLY site in VOX that
    // runs a registered tool, so chat requests, orchestrated capability plans,
    // supervisor-driven runs and direct agent runs all converge here and are all
    // observed by this one call.
    //
    // It observes and records. It cannot stop this step — the function returns
    // void, so there is nothing to branch on — and it cannot throw. A HOLD is
    // written to the event log and the tool runs anyway; enforcement is P4.
    //
    // Placed outside the retry loop below: one attempt to run a step is one
    // decision, and recording it per retry would inflate the shadow HOLD rate
    // this phase exists to measure.
    await recordShadowPolicyEvaluation({
      userId,
      registry: "tool",
      actionId: tool.name,
      boundary: "agents.executor",
      subjectType: "AgentRun",
      subjectId: run.id,
    });

    // ---- [P4-C1] THE APPROVAL GATE, IN SHADOW MODE ----
    //
    // Runs the REAL matching semantics against the user's REAL live grants and
    // records what enforcement would have done. It does not block, and it does
    // not consume: spending a human's approval on an execution that is not
    // actually being gated by it would destroy the one thing P4-C2 needs intact.
    //
    // Today every HOLD action reports NO_GRANT, and that is the honest reading
    // rather than a bug — there is no human approval act in VOX yet, so there is
    // nothing for a grant to have come from. This measures the refusal surface
    // that P4-C2's endpoint will have to serve before anything starts blocking.
    //
    // Never throws. A gate that can break the thing it observes is not a safety
    // feature; the classification lookup, the match and the event write are all
    // inside the catch.
    try {
      const classified = hashRegisteredClassification("tool", tool.name);
      // Only actions the policy would hold or refuse need an approval at all.
      // An ALLOW needs none, so evaluating one would manufacture a refusal for
      // ordinary work and drown the signal this phase exists to collect.
      if (classified && classified.snapshot.decision !== "ALLOW") {
        const shadow = await evaluateApprovalForExecution({
          userId,
          registry: "tool",
          actionId: tool.name,
          argumentsHash,
          classificationHash: classified.hash,
          capability: tool.capability,
          requiredLevel: tool.requiredLevel,
          runId: run.id,
          stepId: step.id,
        });
        await recordEvent({
          userId,
          type: "policy.approval_shadow_evaluated",
          subjectType: "AgentRun",
          subjectId: run.id,
          consequential: false,
          payload: {
            stepId: step.id,
            actionId: tool.name,
            registry: "tool",
            policyDecision: classified.snapshot.decision,
            argumentsHash,
            classificationHash: classified.hash,
            wouldAuthorize: shadow.wouldAuthorize,
            grantId: shadow.grantId,
            candidatesConsidered: shadow.candidatesConsidered,
            reasons: shadow.reasons,
            // The two facts that keep this record honest about what it is.
            enforced: false,
            executionContinued: true,
          },
        });
      }
    } catch (error) {
      logger.error("policy.approval_shadow_failed", {
        runId: run.id,
        stepId: step.id,
        tool: tool.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    let lastError: string | null = null;
    let succeeded = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        // Executed inside the policy boundary opened by the evaluation above.
        // A service that evaluates itself — `runResearch()`, so the direct
        // `POST /api/research` route is not invisible to the gate — sees the
        // boundary already open and defers, so one operation still produces one
        // record. Observability only: withPolicyBoundary neither gates nor
        // alters the call, and the result and any error pass straight through.
        const result = await withPolicyBoundary("agents.executor", () =>
          tool.execute(userId, parsedInput.data as never, executionContext)
        );
        await db.agentStep.update({
          where: { id: step.id },
          data: { status: "COMPLETED", output: JSON.stringify(result.output), completedAt: new Date(), retryCount: attempt },
        });
        stepOutputs.set(step.order, result.output);
        await recordEvent({
          userId,
          type: "agent.step.completed",
          subjectType: "AgentRun",
          subjectId: run.id,
          payload: { step: step.order, tool: tool.name, summary: result.summary },
        });
        succeeded = true;
        break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
        await db.agentStep.update({ where: { id: step.id }, data: { retryCount: attempt } });
      }
    }

    if (!succeeded) {
      return await failRun(userId, run.id, step.id, lastError ?? "Tool execution failed.");
    }

    run = await advance(run.id, step.order);
  }

  const completed = await db.agentRun.update({
    where: { id: run.id },
    data: { status: "COMPLETED", completedAt: new Date(), result: await summarizeRun(run.id) },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  await recordEvent({ userId, type: "agent.run.completed", subjectType: "AgentRun", subjectId: run.id, consequential: true });
  return completed;
}

async function advance(runId: string, completedOrder: number) {
  return db.agentRun.update({
    where: { id: runId },
    data: { currentStep: completedOrder + 1 },
    include: { steps: { orderBy: { order: "asc" } } },
  });
}

async function failRun(userId: string, runId: string, stepId: string, error: string) {
  await db.agentStep.update({ where: { id: stepId }, data: { status: "FAILED", error, completedAt: new Date() } });
  const failed = await db.agentRun.update({
    where: { id: runId },
    data: { status: "FAILED", error, completedAt: new Date() },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  await recordEvent({ userId, type: "agent.run.failed", subjectType: "AgentRun", subjectId: runId, payload: { error }, consequential: true });
  return failed;
}

async function summarizeRun(runId: string): Promise<string> {
  const steps = await db.agentStep.findMany({ where: { runId }, orderBy: { order: "asc" } });
  const summaries = steps
    .filter((s) => s.status === "COMPLETED")
    .map((s) => {
      try {
        const parsed = s.output ? JSON.parse(s.output) : null;
        return parsed?.note ?? s.description;
      } catch {
        return s.description;
      }
    });
  return summaries.join(" ") || "Completed with no steps.";
}
