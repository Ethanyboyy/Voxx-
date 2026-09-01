/**
 * Seeds a throwaway account for the Economic Command visual QA pass.
 *
 * The ledger it writes is deliberately mixed rather than tidy: one externally
 * confirmed row, one human-entered row, one simulated row, and a live contract
 * carrying a large projected return. If the panel ever lets a projection or a
 * dry run leak into the profit figures, this is the data that makes it obvious
 * on screen — a clean all-USER_RECORDED fixture would look correct either way.
 *
 * Usage: DATABASE_URL=file:./prisma/qa.db npx tsx tools/qa/seed-finance-qa.ts
 */
import { db } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";

const EMAIL = process.env.QA_EMAIL ?? "qa@vox.local";
const PASSWORD = process.env.QA_PASSWORD ?? "correcthorsebattery1";

async function main() {
  const passwordHash = await hashPassword(PASSWORD);
  const user = await db.user.upsert({
    where: { email: EMAIL },
    update: { passwordHash, maxAutonomousSpendUsd: 250, economicHaltedAt: null, economicHaltReason: null },
    create: { email: EMAIL, passwordHash, name: "QA", maxAutonomousSpendUsd: 250 },
  });

  // Start from a clean economic slate so repeated runs stay comparable.
  await db.economicAsset.deleteMany({ where: { userId: user.id } });
  await db.experiment.deleteMany({ where: { userId: user.id } });

  const asset = await db.economicAsset.create({
    data: { userId: user.id, name: "Paid acquisition test", category: "OTHER", status: "OPERATING" },
  });

  const now = new Date();
  await db.economicRevenue.createMany({
    data: [
      { assetId: asset.id, amountUsd: 180, occurredAt: now, provenance: "USER_RECORDED", source: "invoice" },
      { assetId: asset.id, amountUsd: 45, occurredAt: now, provenance: "REALIZED", source: "processor payout" },
      { assetId: asset.id, amountUsd: 12_000, occurredAt: now, provenance: "SIMULATED", source: "dry run" },
    ],
  });
  await db.economicExpense.create({
    data: { assetId: asset.id, amountUsd: 60, occurredAt: now, provenance: "USER_RECORDED", category: "ads" },
  });

  await db.experiment.create({
    data: {
      userId: user.id,
      hypothesis: "A $200 paid test on channel X returns above cost within 30 days",
      method: "Two creatives, $100 each, measure attributed revenue daily",
      economicAssetId: asset.id,
      requiredCapitalUsd: 200,
      maxLossUsd: 200,
      successMetric: "Attributed revenue above $700 within 30 days",
      failureMetric: "Attributed revenue below $200 at day 30",
      deadlineAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      scaleCriteria: "Net above $500 with CAC under $40",
      scaleAtNetUsd: 500,
      killCriteria: "Net at or below -$150",
      killAtNetUsd: -150,
      expectedReturnUsd: 900,
      expectedNetProfitUsd: 700,
      requiredCapabilities: JSON.stringify(["economic.spend"]),
      executionStatus: "RUNNING",
    },
  });

  console.log(`Seeded ${EMAIL} (user ${user.id}).`);
}

main().finally(() => db.$disconnect());
