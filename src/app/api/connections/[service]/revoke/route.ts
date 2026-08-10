import { connectionServiceSchema } from "@/lib/validation/schemas";
import { revokeConnection } from "@/lib/connections/service";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

/** Revokes both permission grants and destroys the stored credential row outright. Cached data is untouched — see the delete-cache route. */
export async function POST(_request: Request, context: { params: Promise<{ service: string }> }) {
  try {
    const user = await requireUser();
    const { service } = await context.params;
    const parsedService = connectionServiceSchema.parse(service);
    const connection = await revokeConnection(user.id, parsedService);
    if (!connection) throw new ApiError(404, "Connection not found.");
    return jsonOk({ connection });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
