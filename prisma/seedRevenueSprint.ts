/**
 * [SPRINT] Loads the 72-hour revenue sprint candidates into YOUR account.
 *
 * SEPARATE FROM `prisma/seed.ts` ON PURPOSE. That file says VOX "intentionally
 * ships no demo/fixture data about the *user*", and it is right: a personal
 * operating system that invented opportunities you never considered would be
 * telling you about a business you do not have. So this is opt-in — you run it,
 * deliberately, with your own account's email.
 *
 *     npm run seed:sprint -- you@example.com
 *
 * EVERY NUMBER IN HERE IS MODEL_SUGGESTED. Not researched, not measured, not
 * validated against a single real customer. They are one model's estimates of
 * what a solo operator with AI leverage, no audience and no capital could
 * plausibly charge and how fast. `source` says so on every row, `confidence` is
 * set honestly (mostly MEDIUM and LOW), and the evidence items are tagged
 * ASSUMPTION/ESTIMATE rather than FACT. Treat the ranking as a starting order
 * for where to spend the next three days, and overwrite any figure you know
 * better than the model does — which, about your own network, you do.
 *
 * Re-running is safe: rows are matched by title and updated rather than
 * duplicated.
 */

import { db } from "../src/lib/db";

const SOURCE = "vox.sprint.model_suggested";

type Ev = { type: "FACT" | "SOURCED" | "ESTIMATE" | "ASSUMPTION" | "UNKNOWN"; text: string };

interface Candidate {
  title: string;
  description: string;
  category: string;
  estimatedValue: number | null;
  estimatedMargin: number | null;
  estimatedStartupCost: number;
  estimatedTimeToRevenueDays: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  effort: "LOW" | "MEDIUM" | "HIGH";
  risk: "LOW" | "MEDIUM" | "HIGH";
  complexity: "LOW" | "MEDIUM" | "HIGH";
  competition: "LOW" | "MEDIUM" | "HIGH";
  scalability: "LOW" | "MEDIUM" | "HIGH";
  requiredHumanInvolvement: "LOW" | "MEDIUM" | "HIGH";
  nextAction: string;
  rationale: string;
  evidence: Ev[];
}

const CANDIDATES: Candidate[] = [
  {
    title: "Warm-network ops fix — one bounded automation, 48 hours, flat fee",
    description:
      "Message every person you already know who runs or works at a small business. Offer one specific, bounded automation (invoice chasing, booking intake, the ten questions they answer by phone every day), built and working in 48 hours, flat fee, refund if it does not work. Free written audit up front so they see real work before deciding.",
    category: "automation-services",
    estimatedValue: 450,
    estimatedMargin: 0.92,
    estimatedStartupCost: 0,
    estimatedTimeToRevenueDays: 2,
    // The only HIGH confidence row, and still only 50% implied probability.
    confidence: "HIGH",
    effort: "MEDIUM",
    risk: "LOW",
    complexity: "LOW",
    competition: "LOW",
    scalability: "MEDIUM",
    requiredHumanInvolvement: "HIGH",
    nextAction:
      "Write the list of 20-40 people you could message without it being weird. That list is the whole opportunity.",
    rationale:
      "Existing trust removes the two things that make a 72-hour sale hard: proving you are real, and getting a reply at all. Nothing else on this list starts with the buyer already believing you.",
    evidence: [
      { type: "ASSUMPTION", text: "The owner knows 20+ people connected to a small business. UNVERIFIED — this is the single assumption the whole ranking rests on." },
      { type: "ESTIMATE", text: "$450 is below the threshold where one person stops being able to decide alone, and above where the work is not worth doing." },
      { type: "ASSUMPTION", text: "Margin ~92%: AI does the build, so the cost is the owner's hours plus the model." },
      { type: "UNKNOWN", text: "Whether anyone in that network has this problem THIS WEEK. Timing is the risk, not willingness." },
    ],
  },
  {
    title: "Local same-day tech help — fix one thing for cash today",
    description:
      "Post in local community channels (neighbourhood groups, local business groups, services boards): spreadsheets fixed, invoicing automated, booking set up, same day, $100-250. Local buyers decide fast and pay instantly.",
    category: "automation-services",
    estimatedValue: 175,
    estimatedMargin: 0.95,
    estimatedStartupCost: 0,
    estimatedTimeToRevenueDays: 1,
    confidence: "MEDIUM",
    effort: "LOW",
    risk: "LOW",
    complexity: "LOW",
    competition: "MEDIUM",
    scalability: "LOW",
    requiredHumanInvolvement: "MEDIUM",
    nextAction: "Post one specific offer — not 'I do tech help' — in two local groups.",
    rationale:
      "The shortest possible path to a first dollar: local urgency, instant payment, no procurement. Small tickets and it does not compound, but it is the fastest clock on the list.",
    evidence: [
      { type: "ESTIMATE", text: "$100-250 is the local cash-job band where nobody asks for an invoice or a contract." },
      { type: "ASSUMPTION", text: "The owner can post in local groups without being removed as spam — most have rules about this." },
      { type: "ASSUMPTION", text: "Low scalability: every dollar is one job, and the local pool is finite." },
    ],
  },
  {
    title: "Free audit, then paid fix — cold outreach to local service businesses",
    description:
      "Pick 40-80 local service businesses with a visible, fixable gap (no online booking, unanswered reviews, a mobile site that does not work). AI writes a genuinely useful 2-3 page audit for each. Send it free with no ask. Charge $300-600 to implement the fix.",
    category: "lead-generation",
    estimatedValue: 450,
    estimatedMargin: 0.9,
    estimatedStartupCost: 0,
    estimatedTimeToRevenueDays: 3,
    confidence: "MEDIUM",
    effort: "HIGH",
    risk: "MEDIUM",
    complexity: "LOW",
    competition: "MEDIUM",
    scalability: "HIGH",
    requiredHumanInvolvement: "MEDIUM",
    nextAction: "Build the list of 40 businesses with a named, specific gap each. Generic lists get generic ignoring.",
    rationale:
      "The only row that is both fast enough to matter this week and durable enough to become a business, because the audit is the marketing and AI makes it nearly free to produce at volume.",
    evidence: [
      { type: "ASSUMPTION", text: "Leading with completed free work lifts cold reply rates materially. Widely believed, NOT measured here." },
      { type: "UNKNOWN", text: "Actual cold reply rate for this owner, in this market, with this message. No basis at all until the first 40 sends." },
      { type: "ASSUMPTION", text: "40-80 sends is enough volume for one reply to convert inside 72 hours. Could easily need 3x that." },
    ],
  },
  {
    title: "Resume and LinkedIn rewrites for individuals",
    description:
      "A $75-150 consumer service with a one-person decision, no procurement and same-day delivery. AI does the draft; the owner does the judgement pass and the delivery.",
    category: "content-services",
    estimatedValue: 110,
    estimatedMargin: 0.95,
    estimatedStartupCost: 0,
    estimatedTimeToRevenueDays: 1,
    confidence: "MEDIUM",
    effort: "LOW",
    risk: "LOW",
    complexity: "LOW",
    competition: "HIGH",
    scalability: "MEDIUM",
    requiredHumanInvolvement: "MEDIUM",
    nextAction: "Offer it to three people you know who are job-hunting right now.",
    rationale:
      "Consumers decide in minutes where businesses decide in weeks. Crowded and low-ticket, but the decision cycle is the shortest of anything on this list.",
    evidence: [
      { type: "ESTIMATE", text: "$75-150 is the established consumer band for this service." },
      { type: "ASSUMPTION", text: "High competition: this is one of the most saturated AI-era services there is. Differentiation has to be speed or a specific niche." },
    ],
  },
  {
    title: "Freelance marketplace micro-gigs with AI leverage",
    description:
      "Bid on small, urgent, well-specified jobs on an existing freelance marketplace and deliver same-day. The accelerant is that buyers there are already trying to spend money right now.",
    category: "ai-software-services",
    estimatedValue: 300,
    estimatedMargin: 0.85,
    estimatedStartupCost: 20,
    estimatedTimeToRevenueDays: 2,
    confidence: "MEDIUM",
    effort: "MEDIUM",
    risk: "MEDIUM",
    complexity: "LOW",
    competition: "HIGH",
    scalability: "HIGH",
    requiredHumanInvolvement: "HIGH",
    nextAction: "Check whether an account can be approved today — that gate, not the bidding, is the risk.",
    rationale:
      "Demand already exists and is actively looking, which no other cold channel offers. Discounted for the two real frictions: new-account approval can take days, and zero reviews loses most bids.",
    evidence: [
      { type: "FACT", text: "Marketplace buyers post jobs with budgets attached, so intent to pay is established before contact." },
      { type: "ASSUMPTION", text: "Account approval lands inside 72 hours. A genuine blocker if it does not — new accounts are sometimes rejected outright." },
      { type: "ESTIMATE", text: "~$20 of bidding credits. The only row on this list with any capital at risk." },
      { type: "ASSUMPTION", text: "A no-review seller wins roughly 1 in 15-25 proposals on small urgent jobs." },
    ],
  },
  {
    title: "Done-for-you content or SEO sprint",
    description: "A fixed package — 10 pages or posts, researched and written, delivered in a week — for $300-500.",
    category: "content-services",
    estimatedValue: 400,
    estimatedMargin: 0.88,
    estimatedStartupCost: 0,
    estimatedTimeToRevenueDays: 4,
    confidence: "LOW",
    effort: "HIGH",
    risk: "MEDIUM",
    complexity: "LOW",
    competition: "HIGH",
    scalability: "HIGH",
    requiredHumanInvolvement: "MEDIUM",
    nextAction: "Park this until something above it has produced a customer.",
    rationale:
      "Fulfillable and repeatable, but content buyers compare vendors and sleep on it, which does not fit a 72-hour window.",
    evidence: [
      { type: "ASSUMPTION", text: "Content buying involves comparison shopping, which puts the decision past day three." },
      { type: "UNKNOWN", text: "Whether the output would rank or convert for the buyer. Unprovable inside 72 hours either way." },
    ],
  },
  {
    title: "Per-lead generation for local trades",
    description: "Generate real, verifiable inbound leads for a local trade business and charge per qualified lead.",
    category: "lead-generation",
    estimatedValue: 250,
    estimatedMargin: 0.8,
    estimatedStartupCost: 0,
    estimatedTimeToRevenueDays: 5,
    confidence: "LOW",
    effort: "HIGH",
    risk: "MEDIUM",
    complexity: "MEDIUM",
    competition: "MEDIUM",
    scalability: "HIGH",
    requiredHumanInvolvement: "MEDIUM",
    nextAction: "Park. Revisit once there is one happy customer to reference.",
    rationale:
      "Pay-per-lead is an attractive offer with a slow start: it needs a trust conversation first, and the leads have to exist before anyone pays.",
    evidence: [
      { type: "ASSUMPTION", text: "Needs a phone call and a trial period, which pushes first money past 72 hours." },
      { type: "UNKNOWN", text: "Lead quality, which is the entire product and cannot be demonstrated in advance." },
    ],
  },
  {
    title: "Digital product on a marketplace with its own search traffic",
    description: "A template, tool or pack listed where buyers already search, at $19-49.",
    category: "digital-products",
    estimatedValue: 29,
    estimatedMargin: 0.95,
    estimatedStartupCost: 0,
    estimatedTimeToRevenueDays: 10,
    confidence: "LOW",
    effort: "MEDIUM",
    risk: "LOW",
    complexity: "LOW",
    competition: "HIGH",
    scalability: "HIGH",
    requiredHumanInvolvement: "LOW",
    nextAction: "Park. Excellent second-month project, wrong instrument for 72 hours.",
    rationale:
      "Near-perfect margin and it earns while you sleep, which is exactly why it is wrong here: with no audience, the first sale waits on marketplace indexing, not on effort.",
    evidence: [
      { type: "ASSUMPTION", text: "No existing audience. If the owner HAS one, this moves up several places — the biggest single swing in the ranking." },
      { type: "ESTIMATE", text: "New listings take 1-3 weeks to surface in marketplace search." },
    ],
  },
  {
    title: "Affiliate and referral content",
    description: "Content that earns a commission on someone else's product.",
    category: "affiliate",
    estimatedValue: 50,
    estimatedMargin: 0.95,
    estimatedStartupCost: 0,
    estimatedTimeToRevenueDays: 21,
    confidence: "LOW",
    effort: "MEDIUM",
    risk: "LOW",
    complexity: "LOW",
    competition: "HIGH",
    scalability: "HIGH",
    requiredHumanInvolvement: "LOW",
    nextAction: "Do not start this for a 72-hour goal.",
    rationale:
      "Needs traffic, and traffic is the thing that takes months. Essentially a zero inside three days.",
    evidence: [
      { type: "ASSUMPTION", text: "No existing traffic, and affiliate income is a function of traffic volume." },
    ],
  },
  {
    title: "E-commerce discount experiment (the existing Shopify path)",
    description:
      "The P5-G/P6-F commercial intervention path: one bounded discount code in a connected store, measured over a frozen window.",
    category: "e-commerce",
    // Deliberately null. There is no product, no store and no traffic, so there
    // is no honest revenue estimate to put here — and a guess would be the
    // fabrication the whole engine exists to prevent.
    estimatedValue: null,
    estimatedMargin: null,
    estimatedStartupCost: 0,
    estimatedTimeToRevenueDays: 30,
    confidence: "LOW",
    effort: "HIGH",
    risk: "HIGH",
    complexity: "HIGH",
    competition: "HIGH",
    scalability: "HIGH",
    requiredHumanInvolvement: "HIGH",
    nextAction:
      "Not a revenue path this week. It is the most BUILT path in the repository, which is not the same as the fastest.",
    rationale:
      "Ranked last on purpose, and it is the most important entry to be honest about: VOX has the most machinery here and the least business. A discount needs a store, products and traffic — none exist — and this session's Shopify access returns operation_not_allowed. Being well-engineered is not a reason to rank it.",
    evidence: [
      { type: "FACT", text: "Zero Shopify credentials and zero Connection rows exist. liveReadiness() reports CREDENTIAL_MISSING." },
      { type: "FACT", text: "The session's Shopify tooling returns operation_not_allowed — the shop is unavailable for API access." },
      { type: "UNKNOWN", text: "Revenue is left NULL rather than guessed. With no product and no traffic there is no basis for a number." },
    ],
  },
];

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: npm run seed:sprint -- you@example.com");
    process.exitCode = 1;
    return;
  }

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No account for ${email}. Create it at /setup first — this script does not create accounts.`);
    process.exitCode = 1;
    return;
  }

  const objective =
    (await db.objective.findFirst({ where: { userId: user.id, title: "First $1 of real revenue" } })) ??
    (await db.objective.create({
      data: {
        userId: user.id,
        title: "First $1 of real revenue",
        description:
          "One legitimate dollar from one real customer, verified against a payment processor. Not a projection, not a pipeline number.",
        targetValue: 1,
        targetUnit: "USD",
        // Stays 0 until confirmOutreachPayment() books something. Nothing else
        // may move it — see CLAUDE.md on Objective.currentValue.
        currentValue: 0,
      },
    }));

  let created = 0;
  let updated = 0;
  for (const c of CANDIDATES) {
    const { evidence, ...fields } = c;
    const existing = await db.opportunity.findFirst({
      where: { userId: user.id, title: c.title },
      select: { id: true },
    });
    const data = {
      ...fields,
      userId: user.id,
      objectiveId: objective.id,
      source: SOURCE,
      status: "IDEA" as const,
      evidence: JSON.stringify(evidence),
    };
    if (existing) {
      await db.opportunity.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await db.opportunity.create({ data });
      created += 1;
    }
  }

  console.log(`VOX sprint: ${created} created, ${updated} updated, under objective "${objective.title}".`);
  console.log("Every figure is MODEL_SUGGESTED — not researched, not measured, not validated against a customer.");
  console.log("Ranked for a 72-hour horizon at /revenue, or GET /api/revenue/rank.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
