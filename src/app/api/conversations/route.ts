import type { NextRequest } from "next/server";
import { createConversationSchema } from "@/lib/validation/schemas";
import { createConversation, listConversations } from "@/lib/chat/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const conversations = await listConversations(user.id);
    return jsonOk({ conversations });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createConversationSchema.parse(await request.json().catch(() => ({})));
    const conversation = await createConversation(user.id, body.title, body.projectId);
    return jsonOk({ conversation }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
