import type { NextRequest } from "next/server";
import { saveBrainViewSchema } from "@/lib/validation/schemas";
import { listBrainViews, saveBrainView } from "@/lib/brain/views";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const views = await listBrainViews(user.id);
    return jsonOk({ views });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = saveBrainViewSchema.parse(await request.json());
    const view = await saveBrainView(user.id, body.name, body.state);
    return jsonOk({ view }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
