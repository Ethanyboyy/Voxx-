import type { NextRequest } from "next/server";
import { createSimulationSchema } from "@/lib/validation/labSchemas";
import { createSimulation, listSimulations } from "@/lib/lab/simulations";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
    const simulations = await listSimulations(user.id, projectId);
    return jsonOk({ simulations });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createSimulationSchema.parse(await request.json());
    const simulation = await createSimulation({ userId: user.id, ...body });
    return jsonOk({ simulation }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
