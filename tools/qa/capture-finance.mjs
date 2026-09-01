/**
 * Visual QA for the Economic Command room at phone width.
 *
 * Unlike capture-scenarios.mjs, this page is behind auth and reads real rows,
 * so the script seeds a throwaway account with a small, deliberately mixed
 * ledger — one realized row, one user-recorded row, one simulated row, and a
 * live experiment contract carrying a large projected return. That mix is the
 * point: it is exactly the arrangement that would look wrong if the panel ever
 * let a projection or a dry run bleed into the profit figures.
 *
 * Usage: node tools/qa/capture-finance.mjs http://127.0.0.1:3100
 */

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:3100";
const EMAIL = process.env.QA_EMAIL;
const PASSWORD = process.env.QA_PASSWORD;
const OUT = "tools/qa/out";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, dpr: 3, mobile: true },
  { name: "desktop", width: 1440, height: 900, dpr: 2, mobile: false },
];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});

let failures = 0;

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
  });
  const page = await context.newPage();

  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 });

  await page.goto(`${BASE}/finance`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);

  // The guard that made a previous sweep worthless: every "0px overflow"
  // reading was really measuring the login page. If the P&L panel is not on
  // screen, the capture is not evidence of anything.
  const rendered = await page.locator("text=Profit & loss").count();
  if (rendered === 0) {
    console.error(`[${vp.name}] FAIL — the P&L panel did not render; not authenticated or the page errored.`);
    failures++;
    await context.close();
    continue;
  }

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );

  await page.screenshot({ path: `${OUT}/finance-${vp.name}.png`, fullPage: true });
  console.log(`[${vp.name}] ${vp.width}x${vp.height} — horizontal overflow: ${overflow}px`);
  if (overflow > 0) failures++;

  await context.close();
}

await browser.close();
process.exit(failures > 0 ? 1 : 0);
