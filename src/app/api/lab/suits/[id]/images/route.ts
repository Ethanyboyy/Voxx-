import type { NextRequest } from "next/server";
import { addSuitImageSchema } from "@/lib/validation/labSchemas";
import { listSuitImages, addSuitImage } from "@/lib/lab/suitImages";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const images = await listSuitImages(user.id, id);
    if (images === null) throw new ApiError(404, "Suit not found.");
    return jsonOk({ images });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Stores a reference to a real, externally-produced concept image — VOX
 * never generates the image itself. See the LabSuitImage doc comment in
 * schema.prisma. */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = addSuitImageSchema.parse(await request.json());
    const image = await addSuitImage({ userId: user.id, suitId: id, ...body });
    if (!image) throw new ApiError(404, "Suit not found.");
    return jsonOk({ image }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
