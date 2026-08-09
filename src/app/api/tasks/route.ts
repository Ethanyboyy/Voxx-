import type { NextRequest } from "next/server";
import { createTaskSchema } from "@/lib/validation/schemas";
import { createTask, listTasks } from "@/lib/projects/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";
import type { TaskStatus } from "@/generated/prisma/enums";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const tasks = await listTasks(
      user.id,
      searchParams.get("projectId") ?? undefined,
      (searchParams.get("status") as TaskStatus | null) ?? undefined
    );
    return jsonOk({ tasks });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createTaskSchema.parse(await request.json());
    const task = await createTask({ userId: user.id, ...body });
    return jsonOk({ task }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
