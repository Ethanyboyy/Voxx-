import type { NextRequest } from "next/server";
import { createMemorySchema } from "@/lib/validation/schemas";
import { createMemory, listMemories } from "@/lib/memory/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";
import type { Confidence, MemoryCategory } from "@/generated/prisma/enums";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const memories = await listMemories(user.id, {
      category: (searchParams.get("category") as MemoryCategory | null) ?? undefined,
      confidence: (searchParams.get("confidence") as Confidence | null) ?? undefined,
      search: searchParams.get("search") ?? undefined,
    });
    return jsonOk({ memories });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createMemorySchema.parse(await request.json());
    const memory = await createMemory({
      userId: user.id,
      content: body.content,
      category: body.category,
      confidence: body.confidence,
      provenance: body.provenance,
      source: { type: "USER_STATED" },
    });
    return jsonOk({ memory }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
