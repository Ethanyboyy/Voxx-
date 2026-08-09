import type { NextRequest } from "next/server";
import { proposalStatusSchema } from "@/lib/validation/schemas";
import { listProposals } from "@/lib/cognition/proposals";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const statusParam = new URL(request.url).searchParams.get("status");
    const status = statusParam ? proposalStatusSchema.parse(statusParam) : undefined;
    const proposals = await listProposals(user.id, status);
    return jsonOk({ proposals });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
