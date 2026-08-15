import type { NextRequest } from "next/server";
import { deleteComponent } from "@/lib/lab/components";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

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
