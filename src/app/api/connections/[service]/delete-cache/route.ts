import { connectionServiceSchema } from "@/lib/validation/schemas";
import { deleteCachedData } from "@/lib/connections/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function POST(_request: Request, context: { params: Promise<{ service: string }> }) {
  try {
    const user = await requireUser();
    const { service } = await context.params;
    const parsedService = connectionServiceSchema.parse(service);
    const result = await deleteCachedData(user.id, parsedService);
    if (!result) throw new ApiError(404, "Connection not found.");
    return jsonOk(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
