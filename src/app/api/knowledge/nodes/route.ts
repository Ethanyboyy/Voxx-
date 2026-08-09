import type { NextRequest } from "next/server";
import { createKnowledgeNodeSchema } from "@/lib/validation/schemas";
import { createNode, listNodes } from "@/lib/knowledge/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const nodes = await listNodes(user.id);
    return jsonOk({ nodes });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createKnowledgeNodeSchema.parse(await request.json());
    const node = await createNode({ userId: user.id, ...body });
    return jsonOk({ node }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
