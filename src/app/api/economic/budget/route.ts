import { getBudgetSummary } from "@/lib/economic/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const budget = await getBudgetSummary(user.id);
    return jsonOk({ budget });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
