import type { NextRequest } from "next/server";
import { suggestConnectionSchema } from "@/lib/validation/schemas";
import { listConnections, proposeConnection } from "@/lib/connections/service";
import { createProposal } from "@/lib/cognition/proposals";
import { getCatalogEntry } from "@/lib/integrations/catalog";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const connections = await listConnections(user.id);
    return jsonOk({ connections });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * "Suggested Connections": creates a Proposal (the same engine used
 * everywhere else — see src/lib/cognition/proposals.ts) recommending a
 * connection, and marks the underlying Connection row PROPOSED. This never
 * grants access by itself — approving the returned proposal only moves the
 * connection to AWAITING_APPROVAL (see the connection.propose handler);
 * actual read/write access is a separate grant-access call.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = suggestConnectionSchema.parse(await request.json());
    const entry = getCatalogEntry(body.service);
    if (!entry) throw new ApiError(404, "Unknown connection service.");

    await proposeConnection(user.id, body.service, body.reason);
    const proposal = await createProposal({
      userId: user.id,
      observation: body.reason ?? `${entry.displayName} could give VOX useful context.`,
      suggestedAction: `Connect ${entry.displayName}`,
      actionType: "connection.propose",
      actionPayload: { service: body.service },
      capability: entry.readCapability,
      requiredLevel: "RECOMMEND",
      confidence: "LOW",
    });
    return jsonOk({ proposal }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
