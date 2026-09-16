import type { CatalogEntry } from "@/lib/integrations/types";

/**
 * Static, closed catalog of every external integration VOX knows about.
 * This is the single place capability keys and default read/write posture
 * are defined — src/lib/connections/service.ts and the API routes read from
 * here rather than constructing capability strings ad hoc, so the
 * RECOMMEND-for-read / ACT-for-write convention (see SECURITY.md) can't be
 * bypassed by a call site that forgets it.
 *
 * Sensitive categories (financial, health, location) default
 * writeEnabledByDefault: false even where a write capability exists — see
 * PHASE_2_ARCHITECTURE.md and the Connections Hub plan.
 */
export const CONNECTION_CATALOG: CatalogEntry[] = [
  {
    service: "GOOGLE_CALENDAR",
    category: "EMAIL_CALENDAR",
    displayName: "Google Calendar",
    description: "See your upcoming events so VOX can reason about your schedule.",
    readCapability: "integration.google_calendar.read",
    writeCapability: "integration.google_calendar.write",
    requiredEnvVars: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
    writeEnabledByDefault: false,
  },
  {
    service: "GOOGLE_GMAIL",
    category: "EMAIL_CALENDAR",
    displayName: "Gmail",
    description: "Read your inbox for context. Sending on your behalf stays off unless you turn it on.",
    readCapability: "integration.google_gmail.read",
    writeCapability: "integration.google_gmail.write",
    requiredEnvVars: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
    writeEnabledByDefault: false,
    notes: "Sending mail requires Google's sensitive-scope app verification in addition to an OAuth client.",
  },
  {
    service: "NOTION",
    category: "TASKS_NOTES",
    displayName: "Notion",
    description: "Read and optionally write pages/databases in your Notion workspace.",
    readCapability: "integration.notion.read",
    writeCapability: "integration.notion.write",
    requiredEnvVars: ["NOTION_OAUTH_CLIENT_ID", "NOTION_OAUTH_CLIENT_SECRET"],
    writeEnabledByDefault: false,
  },
  {
    service: "TODOIST",
    category: "TASKS_NOTES",
    displayName: "Todoist",
    description: "Read and optionally create/update tasks in Todoist.",
    readCapability: "integration.todoist.read",
    writeCapability: "integration.todoist.write",
    requiredEnvVars: ["TODOIST_OAUTH_CLIENT_ID", "TODOIST_OAUTH_CLIENT_SECRET"],
    writeEnabledByDefault: false,
  },
  {
    service: "CRAFT",
    category: "TASKS_NOTES",
    displayName: "Craft",
    description: "Read and optionally write Craft documents.",
    readCapability: "integration.craft.read",
    writeCapability: "integration.craft.write",
    requiredEnvVars: ["CRAFT_API_KEY"],
    writeEnabledByDefault: false,
    notes: "Unverified — a public third-party integration API for Craft could not be confirmed to exist. Scaffolded, not assumed buildable.",
  },
  {
    service: "QUICKBOOKS",
    category: "FINANCIAL",
    displayName: "QuickBooks",
    description: "Read business accounting data. Read-only — VOX never writes to QuickBooks.",
    readCapability: "integration.quickbooks.read",
    writeCapability: null,
    requiredEnvVars: ["QUICKBOOKS_CLIENT_ID", "QUICKBOOKS_CLIENT_SECRET"],
    writeEnabledByDefault: false,
  },
  {
    service: "PLAID",
    category: "FINANCIAL",
    displayName: "Bank accounts (Plaid)",
    description: "Read personal bank account balances/transactions via Plaid. Read-only.",
    readCapability: "integration.plaid.read",
    writeCapability: null,
    requiredEnvVars: ["PLAID_CLIENT_ID", "PLAID_SECRET"],
    writeEnabledByDefault: false,
  },
  {
    service: "APPLE_HEALTH",
    category: "HEALTH_FITNESS",
    displayName: "Apple Health",
    description: "Health/fitness data from your iPhone.",
    readCapability: "integration.apple_health.read",
    writeCapability: null,
    requiredEnvVars: [],
    writeEnabledByDefault: false,
    notes: "Apple Health has no cloud API — data is on-device only. A real integration would need a companion iOS Shortcut/app, not OAuth. Architecturally different from the other providers; not a real stub connect path.",
  },
  {
    service: "GOOGLE_FIT",
    category: "HEALTH_FITNESS",
    displayName: "Google Fit",
    description: "Read fitness/activity data. Read-only by default.",
    readCapability: "integration.google_fit.read",
    writeCapability: "integration.google_fit.write",
    requiredEnvVars: ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"],
    writeEnabledByDefault: false,
  },
  {
    service: "GOOGLE_MAPS",
    category: "LOCATION_MAPS",
    displayName: "Google Maps",
    description: "Look up places and directions relevant to what you're working on.",
    readCapability: "integration.google_maps.read",
    writeCapability: null,
    requiredEnvVars: ["GOOGLE_MAPS_API_KEY"],
    writeEnabledByDefault: false,
  },
  {
    service: "AMAZON_ORDERS",
    category: "SHOPPING",
    displayName: "Amazon order history",
    description: "Read past Amazon orders.",
    readCapability: "integration.amazon_orders.read",
    writeCapability: null,
    requiredEnvVars: [],
    writeEnabledByDefault: false,
    notes: "No public API exists for personal Amazon order history. Likely unimplementable via a clean API; scaffolded as a placeholder only.",
  },
  {
    service: "ETSY",
    category: "ETSY",
    displayName: "Etsy",
    description: "Read shop/order data, and optionally manage listings.",
    readCapability: "integration.etsy.read",
    writeCapability: "integration.etsy.write",
    requiredEnvVars: ["ETSY_OAUTH_CLIENT_ID", "ETSY_OAUTH_CLIENT_SECRET"],
    writeEnabledByDefault: false,
  },
  {
    service: "PRINTFUL",
    category: "PRINT_ON_DEMAND",
    displayName: "Printful",
    description: "Read products/orders, and optionally manage them.",
    readCapability: "integration.printful.read",
    writeCapability: "integration.printful.write",
    requiredEnvVars: ["PRINTFUL_API_KEY"],
    writeEnabledByDefault: false,
  },
  {
    service: "PRINTIFY",
    category: "PRINT_ON_DEMAND",
    displayName: "Printify",
    description: "Read products/orders, and optionally manage them.",
    readCapability: "integration.printify.read",
    writeCapability: "integration.printify.write",
    requiredEnvVars: ["PRINTIFY_API_KEY"],
    writeEnabledByDefault: false,
  },
  {
    // [P5-E] The first entry with a REAL provider behind it. Every other
    // service here resolves to a StubConnectionProvider that throws on connect;
    // this one performs an authenticated read against the merchant's own store.
    service: "SHOPIFY",
    category: "SHOPPING",
    displayName: "Shopify",
    description:
      "Read how many orders your store recorded inside an experiment's declared window, and how much they came to. With write access separately granted, VOX can also create one bounded discount code per authorized action — and nothing else.",
    readCapability: "integration.shopify.read",
    // [P5-G] NO LONGER NULL — and this is the single most consequential line in
    // the catalog, so it is worth being explicit about what changed.
    //
    // Through P5-F this was null, documented as "no write mode at all, not a
    // write mode that defaults to off". P5-G introduces exactly one write, so
    // the capability now exists. What has NOT changed is that it is off:
    // `writeEnabledByDefault` is false, `grantAccess()` grants it only when a
    // person explicitly asks for write, and it is granted at ACT — above the
    // default band, so an account that has granted nothing cannot reach it.
    //
    // And the capability alone is still not enough to change anything. Every
    // individual write additionally needs a single-use ApprovalGrant bound to
    // its exact arguments. This line opens the door; it does not walk through it.
    writeCapability: "integration.shopify.write",
    // A per-store admin access token rather than an app-level OAuth client:
    // this connects one merchant's own store, so the credential belongs to the
    // connection, not to the deployment. There is nothing for the operator to
    // configure, which is why this list is empty.
    requiredEnvVars: [],
    writeEnabledByDefault: false,
    notes:
      "Requires a custom-app Admin API access token with the read_orders scope. VOX verifies the token against the real store before the connection is marked connected. Creating a discount additionally requires the write_discounts and read_discounts scopes, an explicit ACT-level write grant, and a per-action human approval.",
  },
];

export function getCatalogEntry(service: string): CatalogEntry | undefined {
  return CONNECTION_CATALOG.find((entry) => entry.service === service);
}
