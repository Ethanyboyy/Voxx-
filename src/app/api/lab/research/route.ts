import type { NextRequest } from "next/server";
import { createResearchItemSchema } from "@/lib/validation/labSchemas";
import { createResearchItem, listResearchItems } from "@/lib/lab/research";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";
import type { LabResearchCategory } from "@/generated/prisma/enums";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const category = new URL(request.url).searchParams.get("category") as LabResearchCategory | null;
    const items = await listResearchItems(user.id, category ?? undefined);
    return jsonOk({ items });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createResearchItemSchema.parse(await request.json());
    const item = await createResearchItem({ userId: user.id, ...body });
    return jsonOk({ item }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
