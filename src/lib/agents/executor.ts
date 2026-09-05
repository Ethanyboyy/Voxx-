import { db } from "@/lib/db";
import { checkCapability } from "@/lib/permissions/service";
import { recordEvent } from "@/lib/observability/events";
import { getTool } from "@/lib/tools/registry";
import { recordShadowPolicyEvaluation, withPolicyBoundary } from "@/lib/policy/gate";
import { hashArguments, STEP_APPROVAL_TARGET_TYPE } from "@/lib/policy/approvals";
import { enforceStepExecution, recordExecutionRefusal } from "@/lib/policy/enforcement";
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
          // [P4-C3] Which gate stopped it. There are now two that park a step in
          // this state, and a reader should not have to guess which.
          blockedOn: "CAPABILITY",
        },
      });
      return waiting;
    }

    // ---- [P4-C3] THE ENFORCEMENT BOUNDARY ----
    //
    // Everything above this line re-derived the execution from authoritative
    // state: the run and its steps were reloaded at the top of this function,
    // `step.input` was re-parsed, re-resolved and re-validated through the
    // tool's own schema, and `argumentsHash` was recomputed from the result.
    // Nothing here trusts a snapshot, a client payload, or an earlier pass —
    // which is what makes an approval granted five minutes ago authorization
    // for *this* execution rather than for whatever it was at the time.
    //
    // `enforceStepExecution` returns a value that must be branched on. That is
    // the whole difference from P2 through P4-C2, where the gate returned void
    // precisely so nobody could enforce it by accident. A HOLD with no matching,
    // unconsumed, human-issued grant now ends the attempt here — the tool is not
    // reached, `withPolicyBoundary` is never entered, and no side effect occurs.
    //
    // Placed BEFORE the step goes RUNNING, deliberately. A refused step must be
    // left in a state a human can act on, and RUNNING is a claim that work is
    // underway. It is also before the retry loop, so one attempt spends at most
    // one approval.
    const enforcement = await enforceStepExecution({
      userId,
      registry: "tool",
      // From the registry, not from anything the planner or a client said.
      actionId: tool.name,
      argumentsHash,
      capability: tool.capability,
      requiredLevel: tool.requiredLevel,
      targetType: STEP_APPROVAL_TARGET_TYPE,
      targetId: step.id,
      runId: run.id,
      stepId: step.id,
      subjectType: "AgentRun",
      subjectId: run.id,
    });

    if (!enforcement.permitted) {
      await recordExecutionRefusal({
        userId,
        actionId: tool.name,
        registry: "tool",
        decision: enforcement.decision,
        disposition: enforcement.disposition,
        reasons: enforcement.reasons,
        grantId: enforcement.grantId,
        classificationHash: enforcement.classificationHash,
        argumentsHash,
        runId: run.id,
        stepId: step.id,
        subjectType: "AgentRun",
        subjectId: run.id,
      });

      // REFUSE means no approval could make this runnable — a DENY, an action
      // with no classification, or the gate failing to reach a verdict. Parking
      // would invite a person to authorize something that can never happen, so
      // the run fails with the reason on the step.
      if (enforcement.disposition === "REFUSE") {
        return await failRun(
          userId,
          run.id,
          step.id,
          `Policy refused "${tool.name}": ${enforcement.reasons.join(", ")}.`
        );
      }

      // AWAIT_APPROVAL. A human approving these exact arguments makes this
      // runnable, so the step waits in the same state P4-C1/C2 established and
      // the existing approval endpoint serves it unchanged.
      return await parkForApproval(userId, run.id, step, tool, argumentsHash, enforcement.reasons);
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

    // THE POLICY GATE'S RECORD. `tool.execute()` below is the ONLY site in VOX
    // that runs a registered tool, so chat requests, orchestrated capability
    // plans, supervisor-driven runs and direct agent runs all converge here and
    // are all described by this one call.
    //
    // [P4-C3] It is now recorded AFTER enforcement has permitted the step, not
    // before. The payload's `executionContinued: true` was a shadow-mode
    // assertion that nothing was ever stopped; now that things are stopped, the
    // only way that field stays true is for this record to be written on the
    // path where execution genuinely continues. A refused step gets
    // `policy.execution_refused` instead, which says the opposite and means it.
    //
    // The recorder itself is unchanged and still returns void — it observes for
    // the boundaries that do not enforce, `runResearch()` above all. Enforcement
    // is a separate function returning a value, so the two cannot be confused.
    await recordShadowPolicyEvaluation({
      userId,
      registry: "tool",
      actionId: tool.name,
      boundary: "agents.executor",
      subjectType: "AgentRun",
      subjectId: run.id,
    });

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

/**
 * [P4-C3] Parks a step that policy will not let run without a human's approval.
 *
 * Deliberately the SAME state the capability pause uses — `WAITING_FOR_PERMISSION`
 * on both the step and the run. Two different things are being waited on ("may
 * VOX do this kind of thing" and "do I approve this exact invocation"), but they
 * are waited on identically, so `getPendingStepApproval()`, the P3 pending-approval
 * projection and the approval endpoint all serve this step with no change at all.
 * Inventing a second waiting state would have meant teaching every one of those
 * about it, for no gain.
 *
 * `reasons` names why the current approval situation is insufficient — NO_GRANT
 * for "nobody has approved this", ARGUMENTS_CHANGED for "an approval exists but
 * the action moved underneath it", ALREADY_CONSUMED for "that approval was
 * already spent". That distinction is what the pending-approval read surface
 * needs in order to tell a person which of those they are looking at.
 */
async function parkForApproval(
  userId: string,
  runId: string,
  step: AgentStep,
  tool: { name: string; capability: string; requiredLevel: AgentStep["requiredLevel"] },
  argumentsHash: string,
  reasons: string[]
) {
  await db.agentStep.update({
    where: { id: step.id },
    data: { status: "WAITING_FOR_PERMISSION", capability: tool.capability, requiredLevel: tool.requiredLevel },
  });
  const waiting = await db.agentRun.update({
    where: { id: runId },
    data: { status: "WAITING_FOR_PERMISSION", currentStep: step.order },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  // The same pending-approval REQUEST event the capability pause records, so a
  // reader does not have to know which gate stopped the step to find out what is
  // waiting and against which arguments. `blockedOn` says which one it was.
  await recordEvent({
    userId,
    type: "agent.step.waiting_for_permission",
    subjectType: "AgentRun",
    subjectId: runId,
    payload: {
      step: step.order,
      stepId: step.id,
      tool: tool.name,
      capability: tool.capability,
      requiredLevel: tool.requiredLevel,
      argumentsHash,
      argumentsFinalized: true,
      blockedOn: "APPROVAL",
      approvalReasons: reasons,
    },
  });
  return waiting;
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
