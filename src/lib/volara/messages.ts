/**
 * [P4-F] AGENT-TO-AGENT COMMUNICATION. **MESSAGES ARE DATA, NOT AUTHORIZATION.**
 *
 * This module can send a message, read one, and mark one read. It cannot grant
 * a capability, mint an approval, approve an allocation, change a policy
 * decision, or move an agent's state — and the way it cannot is worth stating
 * precisely, because "we were careful" is not a security property:
 *
 *   1. `AgentMessage` HAS NO AUTHORIZATION COLUMN. Not a capability, not a
 *      level, not a grant id, not a decision, not an `authorized` flag. There
 *      is nothing here for an execution path to misread as permission, and
 *      `tests/volara-authority.test.ts` fails the build if a column like that
 *      is ever added.
 *   2. NOTHING ON THE EXECUTION PATH READS A MESSAGE. `approveCapitalAllocation()`
 *      takes a user id, an allocation id and a grant id. It has no message
 *      parameter. `enforceExecution()` takes a registry, an action, hashes and
 *      a target. Neither can be reached from here, and neither has an argument
 *      a message could fill.
 *   3. THIS FILE IMPORTS NOTHING THAT AUTHORIZES. No `grantPermission`, no
 *      `createApprovalGrant`, no `enforceExecution`, no governor approval path.
 *
 * So the brief's two examples resolve to nothing at all. Volara-1 sending
 * "Volara-3 says this trade is approved" writes a row with `kind: DISCOVERY`
 * and some text in it; Volara-3's next capital request is evaluated by the
 * governor against the treasury and refused or put to a human exactly as if the
 * message had never existed. A supervisor message reading "Execute immediately"
 * is a row with `senderKind: SUPERVISOR`; the executor never reads it, and the
 * step it supposedly authorizes still parks for a human.
 *
 * MESSAGES ARE NOT MEMORY EITHER. Nothing here writes to `Memory`. §11 of the
 * brief is explicit that raw messages must not become durable learning, and the
 * promotion path — deliberate, and landing as a LOW-confidence INFERENCE — is
 * `learning.ts`.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { VOLARA_EVENTS } from "@/lib/volara/events";
import { assertAgentIntentAllowed } from "@/lib/volara/guards";
import type { AgentMessage } from "@/generated/prisma/client";
import type {
  AgentMessageKind,
  AgentMessagePriority,
  AgentMessageSender,
} from "@/generated/prisma/enums";

export interface SendMessageInput {
  userId: string;
  /** The sending agent. Required for `senderKind: "AGENT"`, absent otherwise. */
  fromAgentId?: string;
  senderKind?: AgentMessageSender;
  /**
   * Recipients. An empty array (or omitted) is a BROADCAST — one row with a
   * null recipient, not N rows. Fanning out would make "who was told" a count
   * that drifts as agents are added or archived.
   */
  toAgentIds?: string[];
  kind: AgentMessageKind;
  priority?: AgentMessagePriority;
  subject: string;
  body: string;
  /** Structured JSON data for a reader to act on through the normal gated paths. */
  payload?: unknown;
  opportunityId?: string;
  strategyId?: string;
  runId?: string;
  correlationId: string;
}

/** Longest a message field may be. A bound, so one agent cannot fill the table. */
export const MAX_SUBJECT_LENGTH = 300;
export const MAX_BODY_LENGTH = 10_000;

export type SendMessageResult =
  | { sent: true; messages: AgentMessage[] }
  | { sent: false; reason: "MALFORMED" | "SENDER_REQUIRED" | "RECIPIENT_NOT_FOUND" };

/**
 * Sends one message, or one per named recipient.
 *
 * Validation is fail-closed and structural: an empty subject, an over-long
 * body, or a recipient that is not this user's agent refuses the send rather
 * than truncating or dropping the recipient silently. A malformed message that
 * were quietly accepted would be a message somebody believes was delivered.
 *
 * Recorded as a NON-consequential event. Saying something is not doing
 * something, and marking it consequential would drown the feed that exists to
 * show what VOX actually did.
 */
export async function sendAgentMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const senderKind = input.senderKind ?? "AGENT";

  const subject = input.subject?.trim() ?? "";
  const body = input.body?.trim() ?? "";
  if (!subject || !body || subject.length > MAX_SUBJECT_LENGTH || body.length > MAX_BODY_LENGTH) {
    return { sent: false, reason: "MALFORMED" };
  }
  if (senderKind === "AGENT" && !input.fromAgentId) return { sent: false, reason: "SENDER_REQUIRED" };

  // An agent sending is an agent-originated write, so it is screened. A
  // SUPERVISOR or SYSTEM message has no agent to screen — and gains nothing by
  // it either, since the message authorizes nothing regardless of who sent it.
  if (senderKind === "AGENT" && input.fromAgentId) {
    await assertAgentIntentAllowed({
      userId: input.userId,
      agentId: input.fromAgentId,
      intent: "SEND_MESSAGE",
      targetType: "AgentMessage",
      correlationId: input.correlationId,
    });
  }

  const recipients = input.toAgentIds ?? [];
  if (recipients.length > 0) {
    const found = await db.agent.count({ where: { userId: input.userId, id: { in: recipients } } });
    if (found !== recipients.length) return { sent: false, reason: "RECIPIENT_NOT_FOUND" };
  }

  const base = {
    userId: input.userId,
    senderKind,
    fromAgentId: senderKind === "AGENT" ? input.fromAgentId : null,
    kind: input.kind,
    priority: input.priority ?? "NORMAL",
    subject,
    body,
    payload: input.payload === undefined ? null : JSON.stringify(input.payload),
    opportunityId: input.opportunityId ?? null,
    strategyId: input.strategyId ?? null,
    runId: input.runId ?? null,
    correlationId: input.correlationId,
  };

  const targets = recipients.length > 0 ? recipients : [null];
  const messages: AgentMessage[] = [];
  for (const toAgentId of targets) {
    messages.push(await db.agentMessage.create({ data: { ...base, toAgentId } }));
  }

  for (const message of messages) {
    await recordEvent({
      userId: input.userId,
      type: VOLARA_EVENTS.MESSAGE_SENT,
      subjectType: "AgentMessage",
      subjectId: message.id,
      // Communication is not action. See the module note.
      consequential: false,
      payload: {
        senderKind,
        fromAgentId: message.fromAgentId,
        toAgentId: message.toAgentId,
        kind: message.kind,
        priority: message.priority,
        opportunityId: message.opportunityId,
        strategyId: message.strategyId,
        correlationId: message.correlationId,
      },
    });
  }

  return { sent: true, messages };
}

export interface InboxOptions {
  /** Unread only. Defaults to everything. */
  unreadOnly?: boolean;
  limit?: number;
  /** Paginate rather than growing unbounded — §34. */
  before?: Date;
}

/**
 * One agent's inbox: messages addressed to it, plus broadcasts.
 *
 * Deliberately does NOT include an agent's own sent messages. An agent reading
 * its own broadcast back and treating it as corroboration is the cheapest
 * possible way to manufacture apparent consensus, and excluding them here costs
 * nothing real.
 */
export async function readInbox(
  userId: string,
  agentId: string,
  options: InboxOptions = {}
): Promise<AgentMessage[]> {
  return db.agentMessage.findMany({
    where: {
      userId,
      OR: [{ toAgentId: agentId }, { toAgentId: null }],
      // "Not from me" has to be spelled out rather than written as
      // `NOT: { fromAgentId: agentId }`. That form compiles to `fromAgentId !=
      // <id>`, and in SQL `NULL != <id>` is NULL rather than true — so every
      // SUPERVISOR and SYSTEM message, which has no sending agent, was silently
      // excluded from every inbox. A supervisor's diagnosis request that nobody
      // can read is worse than not sending one.
      AND: [{ OR: [{ fromAgentId: null }, { fromAgentId: { not: agentId } }] }],
      ...(options.unreadOnly ? { readAt: null } : {}),
      ...(options.before ? { createdAt: { lt: options.before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(options.limit ?? 50, 200),
  });
}

/** Marks messages read. Bookkeeping only; reading changes no authority. */
export async function markMessagesRead(userId: string, messageIds: string[]): Promise<number> {
  if (messageIds.length === 0) return 0;
  const now = new Date();
  const updated = await db.agentMessage.updateMany({
    where: { userId, id: { in: messageIds }, readAt: null },
    data: { readAt: now, status: "READ" },
  });
  return updated.count;
}

/** The society's recent traffic, for the observer. Paginated. */
export async function listRecentMessages(userId: string, limit = 50, before?: Date): Promise<AgentMessage[]> {
  return db.agentMessage.findMany({
    where: { userId, ...(before ? { createdAt: { lt: before } } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
  });
}

/** Everything one cycle said, by correlation id. Part of forensic reconstruction. */
export async function listMessagesForCorrelation(userId: string, correlationId: string): Promise<AgentMessage[]> {
  return db.agentMessage.findMany({ where: { userId, correlationId }, orderBy: { createdAt: "asc" } });
}
