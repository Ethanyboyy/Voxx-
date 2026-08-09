import type { NextRequest } from "next/server";
import { updateProjectSchema } from "@/lib/validation/schemas";
import { deleteProject, getProject, updateProject } from "@/lib/projects/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const project = await getProject(user.id, id);
    if (!project) throw new ApiError(404, "Project not found.");
    return jsonOk({ project });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = updateProjectSchema.parse(await request.json());
    const project = await updateProject(user.id, id, body);
    if (!project) throw new ApiError(404, "Project not found.");
    return jsonOk({ project });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const deleted = await deleteProject(user.id, id);
    if (!deleted) throw new ApiError(404, "Project not found.");
    return jsonOk({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
