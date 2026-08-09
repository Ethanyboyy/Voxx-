import type { NextRequest } from "next/server";
import { linkEntitySchema } from "@/lib/validation/schemas";
import { ensureNodeForEntity } from "@/lib/knowledge/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

/** Get-or-create a graph node mirroring a first-class VOX record. Idempotent. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = linkEntitySchema.parse(await request.json());
    const node = await ensureNodeForEntity(user.id, body.entityType, body.entityId, body.label, body.description);
    return jsonOk({ node }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
