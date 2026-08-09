import type { NextRequest } from "next/server";
import { createObservationSchema, cognitiveDimensionSchema } from "@/lib/validation/schemas";
import { createObservation, listObservations } from "@/lib/cognition/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const dimensionParam = new URL(request.url).searchParams.get("dimension");
    const dimension = dimensionParam ? cognitiveDimensionSchema.parse(dimensionParam) : undefined;
    const observations = await listObservations(user.id, dimension);
    return jsonOk({ observations });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createObservationSchema.parse(await request.json());
    const observation = await createObservation({ userId: user.id, ...body });
    return jsonOk({ observation }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
