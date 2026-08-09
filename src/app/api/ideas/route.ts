import type { NextRequest } from "next/server";
import { createIdeaSchema } from "@/lib/validation/schemas";
import { createIdea, listIdeas } from "@/lib/projects/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
    const ideas = await listIdeas(user.id, projectId);
    return jsonOk({ ideas });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createIdeaSchema.parse(await request.json());
    const idea = await createIdea({ userId: user.id, ...body });
    return jsonOk({ idea }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
