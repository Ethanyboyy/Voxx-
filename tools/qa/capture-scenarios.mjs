/**
 * Visual capture for the VOX experience scenarios.
 *
 * Extends the same Chromium harness `verify-3d.mjs` uses rather than starting a
 * second render system. Its job is different though: verify-3d asks "does it
 * work", this asks "what does it look like" — and the answer is a set of PNGs a
 * person has to open. Automated checks cannot tell you a room looks cheap.
 *
 * The scenarios come from `src/lib/experience/scenarios.ts` and render against
 * deterministic synthetic data, so two runs of the same commit produce
 * comparable images.
 *
 * Usage: node tools/qa/capture-scenarios.mjs http://127.0.0.1:3100
 */

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:3100";
const OUT = "tools/qa/out";
mkdirSync(OUT, { recursive: true });

const SCENARIOS = [
  "brain-idle",
  "brain-listening",
  "brain-thinking",
  "brain-memory",
  "brain-reasoning",
  "brain-execution",
  "brain-complete",
  "brain-error",
  "suit-bay",
  "suit-selected",
  "suit-inspection",
  "wrist-inspection",
  "wrist-exploded",
  "wrist-reassembled",
];

/** Desktop plus the primary target. iPhone first in the list, deliberately. */
const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, dpr: 3, mobile: true },
  { name: "desktop", width: 1440, height: 900, dpr: 2, mobile: false },
];

/** Scenes that need longer to settle: a reveal and a camera move, in sequence. */
const SETTLE_MS = 4200;

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});

let failures = 0;
const report = [];

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
  });

  for (const scenario of SCENARIOS) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });

    let status = "ok";
    try {
      // Not networkidle: these surfaces hold animation loops and, on the Brain,
      // a live event connection, so the network is never idle by design.
      await page.goto(`${BASE}/preview/${scenario}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.locator("canvas").first().waitFor({ state: "attached", timeout: 40_000 });
      await page.waitForTimeout(SETTLE_MS);

      const canvas = await page.evaluate(() => {
        const el = document.querySelector("canvas");
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: Math.round(r.width), h: Math.round(r.height) };
      });
      if (!canvas || canvas.w < 200 || canvas.h < 200) {
        status = `canvas ${canvas ? `${canvas.w}x${canvas.h}` : "missing"}`;
        failures++;
      }

      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (overflow > 1) {
        status = `${status === "ok" ? "" : status + "; "}h-overflow ${overflow}px`;
        failures++;
      }
    } catch (error) {
      status = `failed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`;
      failures++;
    }

    await page.screenshot({ path: `${OUT}/${vp.name}-${scenario}.png` }).catch(() => {});

    const fatal = errors.filter((e) => !/favicon|404|Failed to load resource/i.test(e));
    if (fatal.length > 0) {
      status = `${status === "ok" ? "" : status + "; "}console: ${fatal[0].slice(0, 90)}`;
      failures++;
    }

    report.push({ viewport: vp.name, scenario, status });
    console.log(`${status === "ok" ? "ok  " : "FAIL"} ${vp.name}/${scenario}${status === "ok" ? "" : ` — ${status}`}`);
    await page.close();
  }

  await context.close();
}

await browser.close();

console.log(`\n${report.filter((r) => r.status === "ok").length}/${report.length} scenarios captured cleanly`);
console.log(`Images: ${OUT}/<viewport>-<scenario>.png`);
process.exit(failures > 0 ? 1 : 0);
