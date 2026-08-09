import type { NextRequest } from "next/server";
import { denyProposalSchema } from "@/lib/validation/schemas";
import { denyProposal } from "@/lib/cognition/proposals";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id } = await context.params;
    const body = denyProposalSchema.parse(await request.json().catch(() => ({})));
    const proposal = await denyProposal(user.id, id, body.reason);
    if (!proposal) throw new ApiError(404, "Proposal not found.");
    return jsonOk({ proposal });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
