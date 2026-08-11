import { listTools } from "@/lib/tools/registry";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

/** Discoverable tool catalog — lets the UI (and eventually the user) see what VOX can actually do, not just what it claims to. */
export async function GET() {
  try {
    await requireUser();
    const tools = listTools().map((t) => ({
      name: t.name,
      description: t.description,
      category: t.category,
      capability: t.capability,
      requiredLevel: t.requiredLevel,
      isExternal: Boolean(t.isExternal),
    }));
    return jsonOk({ tools });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
