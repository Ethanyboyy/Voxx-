import type { NextRequest } from "next/server";
import { labAiCommandSchema } from "@/lib/validation/labSchemas";
import { handleLabCommand } from "@/lib/lab/aiEngineer";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const { message } = labAiCommandSchema.parse(await request.json());
    const result = await handleLabCommand(user.id, message);
    return jsonOk(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
