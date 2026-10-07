import { z } from "zod";
import { db } from "@/lib/db";
import { recordOutreach, pipelineSummary } from "@/lib/revenue/outreach";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [SPRINT] THE OUTREACH PIPELINE.
 *
 * GET  every attempt plus the pipeline summary.
 * POST record that a human sent one message to one person.
 *
 * THE POST SENDS NOTHING. It is a log entry written after the fact. There is no
 * endpoint here that contacts anybody, and there is deliberately no bulk
 * import: a sprint pipeline is a few dozen named people a person chose, and an
 * endpoint that accepted a thousand rows would be the first half of a spammer.
 */
const createSchema = z.object({
  prospect: z.string().min(1).max(200),
  organization: z.string().max(200).nullish(),
  channel: z.enum([
    "WARM_PERSONAL",
    "EMAIL",
    "SMS",
    "PHONE",
    "DM_SOCIAL",
    "IN_PERSON",
    "MARKETPLACE",
    "OTHER",
  ]),
  offer: z.string().max(2000).nullish(),
  askedPriceCents: z.number().int().min(0).nullish(),
  sentAt: z.coerce.date().optional(),
  opportunityId: z.string().max(80).nullish(),
  notes: z.string().max(2000).nullish(),
});

export async function GET() {
  try {
    const user = await requireUser();
    const [attempts, summary] = await Promise.all([
      db.outreachAttempt.findMany({
        where: { userId: user.id },
        orderBy: { sentAt: "desc" },
        take: 200,
      }),
      pipelineSummary(user.id),
    ]);
    return jsonOk({ attempts, summary });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = createSchema.parse(await request.json());
    const attempt = await recordOutreach({ userId: user.id, ...body });
    return jsonOk({ attempt }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
