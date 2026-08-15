import type { NextRequest } from "next/server";
import { createProjectSchema } from "@/lib/validation/labSchemas";
import { createLabProject, listLabProjects } from "@/lib/lab/projects";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const projects = await listLabProjects(user.id);
    return jsonOk({ projects });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createProjectSchema.parse(await request.json());
    const project = await createLabProject({ userId: user.id, ...body });
    return jsonOk({ project }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
