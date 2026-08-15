import type { NextRequest } from "next/server";
import { addDesignNoteSchema } from "@/lib/validation/labSchemas";
import { addDesignNote, listDesignNotes } from "@/lib/lab/notes";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export async function GET(request: NextRequest) {
  try {
    const user = await requireUser();
    const url = new URL(request.url);
    const subjectType = url.searchParams.get("subjectType");
    const subjectId = url.searchParams.get("subjectId");
    if (!subjectType || !subjectId) throw new ApiError(400, "Provide subjectType and subjectId.");
    const notes = await listDesignNotes(user.id, subjectType, subjectId);
    return jsonOk({ notes });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = addDesignNoteSchema.parse(await request.json());
    const note = await addDesignNote(user.id, body.subjectType, body.subjectId, body.content);
    return jsonOk({ note }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
