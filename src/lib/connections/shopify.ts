/**
 * [P5-E] CONNECTING A REAL SHOPIFY STORE.
 *
 * Separate from `grantAccess()` in `service.ts` because that function is built
 * around the OAuth code-exchange shape every other catalog entry would use, and
 * Shopify here is connected with a merchant's own custom-app admin token. Sharing
 * one function would have meant a branch inside it for "the kind that has no
 * authorization URL", which is the beginning of a provider-specific special case
 * living in the generic path.
 *
 * WHAT MAKES THIS NOT A FAKE CONNECT (CLAUDE.md rule 10). The order below is the
 * whole guarantee:
 *
 *   1. validate the domain          — before anything is stored
 *   2. grantPermission()            — the REAL one, never a bypass
 *   3. status CONNECTING            — an honest intermediate state
 *   4. A REAL AUTHENTICATED READ    — against the real store
 *   5. only then store the token and set CONNECTED
 *
 * A token that does not work never reaches step 5. The Connections Hub therefore
 * cannot show a connected store that VOX is unable to talk to, which is exactly
 * the failure mode the "never fake a connection" rule exists to prevent.
 */

import { db } from "@/lib/db";
import { recordEvent } from "@/lib/observability/events";
import { grantPermission } from "@/lib/permissions/service";
import { getCatalogEntry } from "@/lib/integrations/catalog";
import { storeCredential } from "@/lib/connections/service";
import { isValidShopDomain, SHOPIFY_REQUIRED_SCOPE, verifyShopifyCredential } from "@/lib/integrations/shopify";

export type ShopifyConnectRefusal =
  /** The domain is not `<name>.myshopify.com`. Nothing was stored, nothing was called. */
  | "INVALID_SHOP_DOMAIN"
  /** The token is empty or obviously not a token. */
  | "INVALID_TOKEN"
  /** A store is already connected. Replacing one is an explicit disconnect first. */
  | "ALREADY_CONNECTED"
  /** The store did not accept the credential. Nothing was stored. */
  | "VERIFICATION_FAILED";

export type ShopifyConnectResult =
  | { connected: true; shopDomain: string }
  | { connected: false; reason: ShopifyConnectRefusal; detail: string };

export interface ConnectShopifyInput {
  userId: string;
  /** `<name>.myshopify.com`. */
  shopDomain: string;
  /** A custom-app Admin API access token carrying `read_orders`. */
  accessToken: string;
}

export async function connectShopifyStore(input: ConnectShopifyInput): Promise<ShopifyConnectResult> {
  const { userId } = input;
  const shopDomain = input.shopDomain.trim().toLowerCase();

  // Checked FIRST, before a row is touched or a request is made. A domain that
  // fails here never becomes a stored value that something later dereferences.
  if (!isValidShopDomain(shopDomain)) {
    return {
      connected: false,
      reason: "INVALID_SHOP_DOMAIN",
      detail: "A Shopify store address must be <name>.myshopify.com — no scheme, no path, no port.",
    };
  }
  if (input.accessToken.trim().length < 8) {
    return { connected: false, reason: "INVALID_TOKEN", detail: "That is not a Shopify access token." };
  }

  const entry = getCatalogEntry("SHOPIFY");
  if (!entry) {
    return { connected: false, reason: "VERIFICATION_FAILED", detail: "Shopify is not in the connection catalog." };
  }

  const existing = await db.connection.findFirst({ where: { userId, service: "SHOPIFY" } });
  if (existing?.status === "CONNECTED") {
    // Not an upsert. Silently repointing a connected store at a different shop
    // would change what every past measurement's `scope` refers to, which would
    // rewrite the meaning of evidence already recorded.
    return {
      connected: false,
      reason: "ALREADY_CONNECTED",
      detail: "A Shopify store is already connected. Disconnect it before connecting a different one.",
    };
  }

  // The real permission grant. Read access to an external system of record is a
  // RECOMMEND-level capability per CLAUDE.md rule 10, and this is the same
  // `grantPermission()` every other capability uses — never a bypass, never a
  // direct write to the Permission table.
  await grantPermission(userId, entry.readCapability, "RECOMMEND");

  const connection = await db.connection.upsert({
    where: { userId_service: { userId, service: "SHOPIFY" } },
    create: {
      userId,
      service: "SHOPIFY",
      category: entry.category,
      displayName: entry.displayName,
      readCapability: entry.readCapability,
      writeCapability: null,
      readEnabled: true,
      writeEnabled: false,
      status: "CONNECTING",
      // NON-SECRET config only. The shop domain lives here so a surface can show
      // which store is connected without ever decrypting the credential.
      config: JSON.stringify({ scope: shopDomain, apiScope: SHOPIFY_REQUIRED_SCOPE }),
    },
    update: {
      status: "CONNECTING",
      readEnabled: true,
      writeEnabled: false,
      writeCapability: null,
      statusReason: null,
      config: JSON.stringify({ scope: shopDomain, apiScope: SHOPIFY_REQUIRED_SCOPE }),
    },
  });

  // ---- THE REAL CALL ------------------------------------------------------
  //
  // An authenticated read against the actual store. Everything above this line
  // is preparation; this is what makes CONNECTED mean something.
  const verification = await verifyShopifyCredential(shopDomain, input.accessToken);

  if (!verification.verified) {
    await db.connection.update({
      where: { id: connection.id },
      data: { status: "ERROR", statusReason: verification.detail },
    });
    await recordEvent({
      userId,
      type: "connection.connect_failed",
      subjectType: "Connection",
      subjectId: connection.id,
      payload: { service: "SHOPIFY", failure: verification.failure, shopDomain },
    });
    // The token is NOT stored. A credential that does not work is not a
    // credential, and keeping it would leave a secret in the database whose only
    // purpose would be to fail again later.
    return { connected: false, reason: "VERIFICATION_FAILED", detail: verification.detail };
  }

  await storeCredential(connection.id, {
    accessToken: input.accessToken,
    grantedScope: SHOPIFY_REQUIRED_SCOPE,
  });

  await db.connection.update({
    where: { id: connection.id },
    data: { status: "CONNECTED", statusReason: null, lastSyncedAt: new Date() },
  });

  await recordEvent({
    userId,
    type: "connection.connected",
    subjectType: "Connection",
    subjectId: connection.id,
    consequential: true,
    // The shop domain is recorded; the token is not, and never appears in any
    // event payload, log line, or digest.
    payload: { service: "SHOPIFY", shopDomain, apiScope: SHOPIFY_REQUIRED_SCOPE, verified: true },
  });

  return { connected: true, shopDomain };
}
