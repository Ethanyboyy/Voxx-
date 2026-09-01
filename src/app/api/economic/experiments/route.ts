import { z } from "zod";
import { createEconomicExperiment, listEconomicExperiments } from "@/lib/economic/experiments";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    return jsonOk({ experiments: await listEconomicExperiments(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

// Every economic term is optional at creation: a contract is written
// incrementally, and readyExperiment() is the gate that refuses an incomplete
// one. Nullable rather than merely absent so a term can be explicitly cleared.
const createSchema = z.object({
  hypothesis: z.string().min(1),
  method: z.string().optional(),
  opportunityId: z.string().nullish(),
  economicAssetId: z.string().nullish(),
  requiredCapitalUsd: z.number().nonnegative().nullish(),
  maxLossUsd: z.number().positive().nullish(),
  successMetric: z.string().nullish(),
  failureMetric: z.string().nullish(),
  deadlineAt: z.coerce.date().nullish(),
  scaleCriteria: z.string().nullish(),
  scaleAtNetUsd: z.number().nullish(),
  killCriteria: z.string().nullish(),
  killAtNetUsd: z.number().nullish(),
  expectedReturnUsd: z.number().nullish(),
  expectedNetProfitUsd: z.number().nullish(),
  requiredCapabilities: z.array(z.string()).optional(),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const input = createSchema.parse(await request.json());
    const experiment = await createEconomicExperiment({ userId: user.id, ...input });
    return jsonOk({ experiment }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
