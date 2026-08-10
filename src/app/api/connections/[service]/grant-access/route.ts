import type { NextRequest } from "next/server";
import { grantConnectionAccessSchema, connectionServiceSchema } from "@/lib/validation/schemas";
import { grantAccess } from "@/lib/connections/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

/**
 * Grants read and/or write access via the real permission system (read
 * requires RECOMMEND, write requires ACT — see SECURITY.md), then attempts
 * the provider connect. Every service today resolves to a
 * StubConnectionProvider, so this always ends in status ERROR with a
 * "not configured" reason rather than CONNECTED.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ service: string }> }) {
  try {
    const user = await requireUser();
    const { service } = await context.params;
    const parsedService = connectionServiceSchema.parse(service);
    const body = grantConnectionAccessSchema.parse(await request.json().catch(() => ({})));
    const connection = await grantAccess(user.id, parsedService, body);
    return jsonOk({ connection });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
