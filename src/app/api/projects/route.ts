import type { NextRequest } from "next/server";
import { createProjectSchema } from "@/lib/validation/schemas";
import { createProject, listProjects } from "@/lib/projects/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";
import type { ProjectStatus } from "@/generated/prisma/enums";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const status = new URL(request.url).searchParams.get("status") as ProjectStatus | null;
    const projects = await listProjects(user.id, status ?? undefined);
    return jsonOk({ projects });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createProjectSchema.parse(await request.json());
    const project = await createProject({ userId: user.id, ...body });
    return jsonOk({ project }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
