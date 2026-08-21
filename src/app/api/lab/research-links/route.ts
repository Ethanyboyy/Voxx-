import type { NextRequest } from "next/server";
import { createResearchLinkSchema } from "@/lib/validation/labSchemas";
import { createResearchLink, listResearchLinks, type ResearchLinkSubjectType } from "@/lib/lab/researchLinks";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const { searchParams } = new URL(request.url);
    const subjectType = searchParams.get("subjectType") as ResearchLinkSubjectType | null;
    const subjectId = searchParams.get("subjectId");
    if (!subjectType || !subjectId) throw new ApiError(400, "subjectType and subjectId are required.");
    const links = await listResearchLinks(user.id, subjectType, subjectId);
    return jsonOk({ links });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createResearchLinkSchema.parse(await request.json());
    const link = await createResearchLink({ userId: user.id, ...body });
    if (!link) throw new ApiError(404, "The research item or the subject it should link to wasn't found.");
    return jsonOk({ link }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
