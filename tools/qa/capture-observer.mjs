/**
 * Visual QA for the Global Observer (P4-G).
 *
 * Two accounts, because the two failure modes are opposite: an EMPTY account
 * must show truthful empty states rather than blank boxes or zeros, and a
 * POPULATED one is the only thing that can make a wide table overflow a phone.
 *
 * The guard is the same one capture-finance.mjs learned the hard way: if the
 * Observer's own header is not on screen, the capture is measuring the login
 * page and is not evidence of anything.
 *
 * Usage: node tools/qa/capture-observer.mjs http://127.0.0.1:3111
 */
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:3111";
const OUT = "tools/qa/out";
mkdirSync(OUT, { recursive: true });

const ACCOUNTS = [
  { tag: "empty", email: process.env.QA_EMAIL, password: process.env.QA_PASSWORD },
  { tag: "full", email: process.env.OBS_EMAIL, password: process.env.OBS_PASSWORD },
];

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, dpr: 3, mobile: true },
  { name: "desktop", width: 1440, height: 900, dpr: 2, mobile: false },
];

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});

let failures = 0;

for (const account of ACCOUNTS) {
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: vp.dpr,
      isMobile: vp.mobile,
      hasTouch: vp.mobile,
    });
    const page = await context.newPage();

    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") consoleErrors.push(`${msg.type()}: ${msg.text()}`);
    });
    page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill('input[type="email"]', account.email);
    await page.fill('input[type="password"]', account.password);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15000 });

    // NOT `networkidle`: the Observer opens an SSE stream and holds it open for
    // the life of the page, so the network is never idle and the wait would
    // always time out. Wait for the header the page renders instead, which is
    // the actual thing being asserted, then settle for the client fetches.
    await page.goto(`${BASE}/observer`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("load").catch(() => {});
    await page.waitForTimeout(2500);

    const label = `${account.tag}-${vp.name}`;

    const rendered = await page.locator("text=Global Observer").count();
    if (rendered === 0) {
      console.error(`[${label}] FAIL — the Observer header did not render; not authenticated or the page errored.`);
      console.error(consoleErrors.join("\n"));
      failures++;
      await context.close();
      continue;
    }

    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflow = doc.scrollWidth - doc.clientWidth;
      const vw = doc.clientWidth;
      // Every element whose painted box crosses the right edge of the viewport.
      const offenders = [];
      for (const el of Array.from(document.querySelectorAll("body *"))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > vw + 1) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.getAttribute("class") ?? "").slice(0, 110),
            right: Math.round(r.right),
            width: Math.round(r.width),
            text: (el.textContent ?? "").trim().slice(0, 50),
          });
        }
      }
      // Touch targets below 44px on the primary axis.
      const small = [];
      for (const el of Array.from(document.querySelectorAll("button, a[href], input, select, [role=button]"))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (r.height < 44)
          small.push({
            tag: el.tagName.toLowerCase(),
            h: Math.round(r.height),
            w: Math.round(r.width),
            text: (el.textContent ?? "").trim().slice(0, 40),
          });
      }
      return {
        overflow,
        offenders: offenders.slice(0, 25),
        offenderCount: offenders.length,
        small: small.slice(0, 25),
        smallCount: small.length,
        bodyText: document.body.innerText.length,
      };
    });

    await page.screenshot({ path: `${OUT}/observer-${label}.png`, fullPage: true });

    console.log(`\n=== [${label}] ${vp.width}x${vp.height} ===`);
    console.log(`  horizontal overflow: ${metrics.overflow}px   body text: ${metrics.bodyText} chars`);
    if (metrics.offenderCount) {
      console.log(`  elements past right edge (${metrics.offenderCount}):`);
      for (const o of metrics.offenders) console.log(`    <${o.tag} right=${o.right} w=${o.width}> ${o.cls} :: ${o.text}`);
    }
    if (metrics.smallCount) {
      console.log(`  touch targets under 44px high (${metrics.smallCount}):`);
      for (const s of metrics.small) console.log(`    <${s.tag} ${s.w}x${s.h}> ${s.text}`);
    }
    if (consoleErrors.length) {
      console.log(`  console (${consoleErrors.length}):`);
      for (const e of consoleErrors.slice(0, 15)) console.log(`    ${e}`);
    } else {
      console.log("  console: clean");
    }
    if (metrics.overflow > 0) failures++;

    await context.close();
  }
}

await browser.close();
process.exit(failures > 0 ? 1 : 0);
