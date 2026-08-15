import type { NextRequest } from "next/server";
import { getSimulation } from "@/lib/lab/simulations";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const simulation = await getSimulation(user.id, id);
    if (!simulation) throw new ApiError(404, "Simulation not found.");
    return jsonOk({ simulation });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
