import type { NextRequest } from "next/server";
import { grantPermissionSchema, revokePermissionSchema } from "@/lib/validation/schemas";
import { grantPermission, listPermissions, revokePermission } from "@/lib/permissions/service";
import { requireUser, apiErrorResponse, jsonOk } from "@/lib/api/helpers";

export async function GET() {
  try {
    const user = await requireUser();
    const permissions = await listPermissions(user.id);
    return jsonOk({ permissions });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/** Grants a capability. Granting/revoking is itself a consequential, explicit user action — see SECURITY.md. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = grantPermissionSchema.parse(await request.json());
    const permission = await grantPermission(user.id, body.capability, body.level);
    return jsonOk({ permission }, 201);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireUser();
    const body = revokePermissionSchema.parse(await request.json());
    const permission = await revokePermission(user.id, body.capability);
    return jsonOk({ permission });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
