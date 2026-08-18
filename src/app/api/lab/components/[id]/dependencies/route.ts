import type { NextRequest } from "next/server";
import { createComponentDependencySchema } from "@/lib/validation/labSchemas";
import { addComponentDependency } from "@/lib/lab/components";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = createComponentDependencySchema.parse(await request.json());
    const dependency = await addComponentDependency(user.id, id, body.dependsOnId, body.note);
    return jsonOk({ dependency }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
