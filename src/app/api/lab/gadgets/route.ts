import type { NextRequest } from "next/server";
import { createGadgetSchema } from "@/lib/validation/labSchemas";
import { createGadget, listGadgets } from "@/lib/lab/gadgets";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";
import type { LabDesignStatus } from "@/generated/prisma/enums";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const status = url.searchParams.get("status") as LabDesignStatus | null;
    const gadgets = await listGadgets(user.id, { status: status ?? undefined });
    return jsonOk({ gadgets });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = createGadgetSchema.parse(await request.json());
    const gadget = await createGadget({ userId: user.id, ...body });
    return jsonOk({ gadget }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
