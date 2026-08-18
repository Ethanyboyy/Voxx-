import type { NextRequest } from "next/server";
import { updateComponentSchema } from "@/lib/validation/labSchemas";
import { deleteComponent, updateComponent } from "@/lib/lab/components";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    const body = updateComponentSchema.parse(await request.json());
    const component = await updateComponent(id, body);
    return jsonOk({ component });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    await requireUser();
    const { id } = await context.params;
    await deleteComponent(id);
    return jsonOk({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
