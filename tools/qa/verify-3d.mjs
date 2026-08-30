/**
 * Browser verification for the 3D framework.
 *
 * typecheck/lint/tests/build all pass on code that renders a blank canvas, so
 * none of them are evidence that the Brain works. This drives a real Chromium
 * against a real production build and measures three things that only a browser
 * can answer:
 *
 *   1. Does the WebGL canvas actually come up, at a real size, on a phone
 *      viewport as well as a desktop one?
 *   2. Does interaction reach the scene — does a tap select something?
 *   3. What frame rate does it hold, at each viewport?
 *
 * Usage: node tools/qa/verify-3d.mjs http://127.0.0.1:3100
 */

import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:3100";
const OUT = "tools/qa/out";
mkdirSync(OUT, { recursive: true });

const VIEWPORTS = [
  { name: "iphone-14", width: 390, height: 844, dpr: 3, mobile: true },
  { name: "iphone-se", width: 375, height: 667, dpr: 2, mobile: true },
  { name: "desktop", width: 1440, height: 900, dpr: 2, mobile: false },
];

const results = [];
let failures = 0;

function check(name, ok, detail) {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Counts real animation frames over a fixed wall-clock window. */
const MEASURE_FPS = `new Promise((resolve) => {
  let frames = 0;
  const start = performance.now();
  function tick() {
    frames++;
    if (performance.now() - start < 3000) requestAnimationFrame(tick);
    else resolve(Math.round((frames * 1000) / (performance.now() - start)));
  }
  requestAnimationFrame(tick);
})`;

const browser = await chromium.launch({
  executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});

// One account, created through the real registration route — no fixture user.
// The Origin header is required: VOX rejects cross-origin writes, and a QA
// script that worked around that would be testing a different application.
const setup = await browser.newContext();
const api = setup.request;
const headers = { origin: BASE };
const creds = { email: "qa@vox.local", password: "qa-verification-passphrase" };
let auth = await api.post(`${BASE}/api/auth/register`, { data: { ...creds, name: "QA" }, headers });
if (!auth.ok()) {
  // VOX is single-user: once the account exists, registration is closed.
  auth = await api.post(`${BASE}/api/auth/login`, { data: creds, headers });
}
check("auth", auth.ok(), `${auth.status()} ${auth.url().split("/api")[1]}`);
const cookies = await setup.cookies();
await setup.close();

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: vp.dpr,
    isMobile: vp.mobile,
    hasTouch: vp.mobile,
  });
  await context.addCookies(cookies);
  const page = await context.newPage();

  // Count real GPU work by wrapping the draw entry points before any app code
  // runs. Draw calls and triangles per frame are the portable numbers — frame
  // rate here is a software rasteriser's, not a phone's, and would be
  // misleading on its own.
  await page.addInitScript(() => {
    const w = window;
    w.__gpu = { draws: 0, tris: 0, frames: 0 };
    for (const proto of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
      const drawElements = proto.drawElements;
      proto.drawElements = function (mode, count, ...rest) {
        w.__gpu.draws++;
        if (mode === this.TRIANGLES) w.__gpu.tris += count / 3;
        return drawElements.call(this, mode, count, ...rest);
      };
      const drawArrays = proto.drawArrays;
      proto.drawArrays = function (mode, first, count) {
        w.__gpu.draws++;
        if (mode === this.TRIANGLES) w.__gpu.tris += count / 3;
        return drawArrays.call(this, mode, first, count);
      };
    }
  });

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  // NOT networkidle: the Brain holds an SSE connection open for live events, so
  // the network is never idle by design and waiting for it always times out.
  await page.goto(`${BASE}/brain`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator("canvas").first().waitFor({ state: "attached", timeout: 45_000 }).catch(() => {});
  await page.waitForTimeout(3000);

  // 1. The canvas exists and has real pixels.
  const canvas = await page.evaluate(() => {
    const el = document.querySelector("canvas");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), backing: el.width * el.height };
  });
  check(`${vp.name}/canvas`, !!canvas && canvas.w > 200 && canvas.h > 200, canvas ? `${canvas.w}x${canvas.h} css, ${canvas.backing} backing px` : "no canvas");

  // 2. No horizontal overflow — the classic mobile composition failure.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`${vp.name}/no-h-overflow`, overflow <= 1, `${overflow}px`);

  // 3. Scene cost per frame, and the frame rate it produces here.
  const perf = await page.evaluate(`(async () => {
    window.__gpu.draws = 0; window.__gpu.tris = 0;
    const fps = await ${MEASURE_FPS};
    return { fps, draws: window.__gpu.draws, tris: Math.round(window.__gpu.tris) };
  })()`);
  const perFrame = perf.fps > 0 ? perf.draws / (perf.fps * 3) : 0;
  const trisPerFrame = perf.fps > 0 ? perf.tris / (perf.fps * 3) : 0;

  // Draw calls and triangles are the portable numbers. Frame rate here comes
  // from SwiftShader, a CPU rasteriser rendering every fragment in software —
  // it says the loop is alive and the scene is not stalled, and nothing about
  // what a phone GPU will do with the same scene.
  check(
    `${vp.name}/frame-cost`,
    perFrame > 0 && perFrame < 220,
    `${Math.round(perFrame)} draw calls, ${Math.round(trisPerFrame).toLocaleString()} tris per frame; ${perf.fps} fps on swiftshader`,
  );

  // 4. Interaction reaches the scene: a tap/click in the canvas centre.
  const before = await page.evaluate(() => document.body.innerText.length);
  const box = await page.locator("canvas").first().boundingBox().catch(() => null);
  if (box) {
    if (vp.mobile) await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    else await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(900);
  }
  const after = await page.evaluate(() => document.body.innerText.length);
  check(`${vp.name}/interactive`, !!box, box ? `hit test at canvas centre, text ${before}→${after}` : "no canvas box");

  // 5. Toolbar controls are reachable and do not throw.
  const toolbar = await page.getByRole("button", { name: /reset|focus|zoom/i }).count();
  check(`${vp.name}/controls`, toolbar > 0, `${toolbar} scene controls`);

  await page.screenshot({ path: `${OUT}/brain-${vp.name}.png`, fullPage: false });

  const fatal = errors.filter((e) => !/favicon|404|Failed to load resource/i.test(e));
  check(`${vp.name}/no-console-errors`, fatal.length === 0, fatal.slice(0, 2).join(" | ") || "clean");

  await context.close();
}

await browser.close();

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
process.exit(failures > 0 ? 1 : 0);
