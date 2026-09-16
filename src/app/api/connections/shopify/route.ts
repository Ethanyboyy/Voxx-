import { z } from "zod";
import { connectShopifyStore } from "@/lib/connections/shopify";
import { requireUser, apiErrorResponse, jsonOk, ApiError } from "@/lib/api/helpers";

export const runtime = "nodejs";

/**
 * [P5-E] Connects a real Shopify store.
 *
 * The access token arrives in the body and is never echoed back — not in the
 * success response, not in an error message, and not in the Event this writes.
 * The only thing that leaves here is the shop domain, which is public.
 */
const bodySchema = z.object({
  shopDomain: z.string().min(3).max(80),
  accessToken: z.string().min(8).max(500),
});

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = bodySchema.parse(await request.json());

    const result = await connectShopifyStore({
      userId: user.id,
      shopDomain: body.shopDomain,
      accessToken: body.accessToken,
    });

    if (!result.connected) {
      // 409 for "a store is already connected", 400 for everything else — the
      // first is a state conflict the caller resolves by disconnecting, the rest
      // are problems with what was submitted.
      throw new ApiError(result.reason === "ALREADY_CONNECTED" ? 409 : 400, result.detail);
    }

    return jsonOk({ connected: true, shopDomain: result.shopDomain });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
