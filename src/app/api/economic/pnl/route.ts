import { getPnlReport } from "@/lib/economic/pnl";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await requireUser();
    return jsonOk({ pnl: await getPnlReport(user.id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
