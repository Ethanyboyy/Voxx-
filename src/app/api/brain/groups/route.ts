import type { NextRequest } from "next/server";
import { createBrainGroupSchema } from "@/lib/validation/schemas";
import { createBrainGroup, listBrainGroups } from "@/lib/brain/groups";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const groups = await listBrainGroups(user.id);
    return jsonOk({ groups });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createBrainGroupSchema.parse(await request.json());
    const group = await createBrainGroup({ userId: user.id, ...body });
    return jsonOk({ group }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
