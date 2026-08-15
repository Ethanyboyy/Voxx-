import type { NextRequest } from "next/server";
import { executeSimulationSchema } from "@/lib/validation/labSchemas";
import { executeSimulation } from "@/lib/lab/simulations";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const raw = await request.text();
    const body = raw ? executeSimulationSchema.parse(JSON.parse(raw)) : {};
    const run = await executeSimulation(user.id, id, body.seed);
    if (!run) throw new ApiError(404, "Simulation not found.");
    return jsonOk({ run }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
