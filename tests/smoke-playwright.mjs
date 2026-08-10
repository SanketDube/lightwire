/* The invariants that must never break, in a real browser.
 *
 * The Puppeteer suite (e2e2/e2e4/e2e5) covers more ground, but it needs
 * Puppeteer. This file is the same guarantees under Playwright, so there is
 * always one runnable regression check on a machine that has either.
 *
 *   NODE_PATH=/path/to/node_modules node smoke-playwright.mjs
 */
import http from "http";
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const PORT = 8139;
const FILE = path.resolve("../src/test-copy.html");
if (!fs.existsSync(FILE)) {
  console.error("build first:  cd ../src && python3 assemble.py");
  process.exit(1);
}

let fails = 0;
const ok = (name, cond, extra) => {
  console.log((cond ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : ""));
  if (!cond) fails++;
};

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(fs.readFileSync(FILE));
});
await new Promise((r) => server.listen(PORT, r));
const URL = `http://localhost:${PORT}/test-copy.html`;

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage();

/* ---- the offline guarantee: nothing may leave the machine ---- */
const external = [];
await page.route("**/*", (route) => {
  const u = route.request().url();
  if (!u.includes("localhost") && !u.startsWith("data:") && !u.startsWith("blob:")) {
    external.push(u);
    return route.abort();
  }
  return route.continue();
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(URL);
const engine = await page.evaluate(() => window.__engine().then((e) => e.kind));
ok("a real barcode engine came up with no network", engine === "zxing" || engine === "native", "engine=" + engine);
ok("zero external requests", external.length === 0, external.join(" | "));

/* ---- attribution survives the build ---- */
const attribution = await page.evaluate(() => document.querySelector("footer").textContent);
ok("footer credits all four bundled components",
   /ZXing/.test(attribution) && /jsQR/.test(attribution) &&
   /qrcode-generator/.test(attribution) && /zxing-wasm/.test(attribution), attribution);

/* ---- the worker frame factory still fills a grid ----
   Driven through the calibration sweep, which is now what the test-signal
   button starts. Rung 3 is the first 2x2 rung, so that is where the multi-cell
   render gets checked. */
await page.evaluate(() => window.__calTiming(1200, 200, 400));
await page.click("#testSig");
let grid = null;
for (let i = 0; i < 120 && !grid; i++) {
  const s = await page.evaluate(() => {
    if (window.__calRung() < 3) return null;
    return {
      rung: window.__calRung(),
      workers: window.__workers(),
      sizes: window.__cells().map((c) => c.width),
      sent: +document.getElementById("sSent").textContent
    };
  });
  if (s && s.sizes.length === 4 && s.sizes.every((w) => w > 40) && s.sent > 0) grid = s;
  else await page.waitForTimeout(80);
}
ok("2x2 grid renders every cell during the sweep", !!grid, grid ? JSON.stringify(grid) : "never reached a full 2x2 paint");
ok("workers booted", grid && grid.workers >= 1, grid ? "workers=" + grid.workers : "");
await page.evaluate(() => document.getElementById("calAbort").click());

/* ---- full loop: a file goes in one side and comes out the other ---- */
const loop = await page.evaluate(async () => {
  document.getElementById("tabRecv").click();
  const file = new TextEncoder().encode(JSON.stringify({
    rows: Array.from({ length: 4000 }, (_, i) => ({ i, v: "row-" + i, t: i * 7919 }))
  }));
  const container = LW.buildContainer("rows.json", "application/json", file);
  const enc = LW.makeEncoder(container, 600, 0x5150abcd, 0);
  let fed = 0;
  for (let seed = 1; seed < 4000; seed++) {
    /* 25% loss, because the whole point is that loss is free */
    if (seed % 4 === 0) continue;
    window.__feed(LW.base45Encode(enc.frame(seed)), 600);
    fed++;
    const d = window.__dec();
    if (d && d.isDone()) break;
  }
  await new Promise((r) => setTimeout(r, 80));
  const res = window.__result();
  return { fed, title: document.getElementById("doneTitle").textContent, name: res && res.meta.n, ok: res && res.ok };
});
ok("file recovered through 25% loss", loop.ok === true && /checksum verified/i.test(loop.title),
   `fed=${loop.fed} name=${loop.name}`);

ok("no page errors anywhere", errors.length === 0, errors.join(" | "));
ok("still zero external requests at the end", external.length === 0, external.join(" | "));

await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
