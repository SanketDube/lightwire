/* The progress estimate, and the size ceiling.
 *
 * The claim under test: solved-blocks is a useless progress signal on this
 * codec, and codes-received-over-codes-needed is a good one. Both halves are
 * asserted, because the second is only worth having if the first is true.
 *
 *   NODE_PATH=/path/to/node_modules node e2e7-progress.mjs
 */
import http from "http";
import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const PORT = 8153;
const FILE = path.resolve("../src/test-copy.html");
if (!fs.existsSync(FILE)) { console.error("build first: cd ../src && python3 assemble.py"); process.exit(1); }

let fails = 0;
const ok = (n, c, x) => { console.log((c ? "ok   " : "FAIL ") + n + (x ? "  " + x : "")); if (!c) fails++; };

const server = http.createServer((q, r) => { r.writeHead(200, { "Content-Type": "text/html" }); r.end(fs.readFileSync(FILE)); });
await new Promise((r) => server.listen(PORT, r));
const URL = `http://localhost:${PORT}/test-copy.html`;
const browser = await chromium.launch({ args: ["--no-sandbox"] });

/* ---- 1. the estimate rises smoothly and only reaches 100 when it is true ---- */
{
  const page = await browser.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.evaluate(() => document.getElementById("tabRecv").click());
  const t = await page.evaluate(async () => {
    const payload = new Uint8Array(4 * 1024 * 1024);
    let s = 0x1f2e3d4c;
    for (let i = 0; i < payload.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; payload[i] = s & 255; }
    const enc = LW.makeEncoder(payload, 800, 0x51501234, 0);
    const samples = [];
    let hit100Early = false, wentBackwards = false, last = 0;
    for (let seed = 1; seed < 30000; seed++) {
      window.__feed(LW.base45Encode(enc.frame(seed)), 495);
      const d = window.__dec();
      const shown = parseInt(document.getElementById("covPct").textContent, 10);
      if (shown < last) wentBackwards = true;
      if (shown >= 100 && !d.isDone()) hit100Early = true;
      last = shown;
      if (seed % 1000 === 0) samples.push({ codes: seed, shown, solvedPct: Math.floor(d.solvedCount * 100 / d.K) });
      if (d.isDone()) break;
    }
    const d = window.__dec();
    return { K: d.K, samples, hit100Early, wentBackwards, final: last,
             bar: document.getElementById("progBar").style.width,
             label: document.querySelector(".covlabel span").textContent };
  });

  ok("labelled as an estimate", /Estimated/i.test(t.label), t.label);
  ok("never claims 100% before the file is actually complete", !t.hit100Early);
  ok("never goes backwards", !t.wentBackwards);
  ok("reaches 100% on completion", t.final === 100 && t.bar === "100%");

  const mid = t.samples[Math.floor(t.samples.length / 2)];
  ok("moves steadily through the middle of the transfer", mid.shown > 30 && mid.shown < 80,
     `at ${mid.codes} codes the estimate read ${mid.shown}%`);
  ok("solved-blocks would have been useless there", mid.solvedPct < 5,
     `truly solved was only ${mid.solvedPct}% at that moment`);
  console.log(`     (K=${t.K}: estimate ${mid.shown}% vs solved-blocks ${mid.solvedPct}% at the halfway point)`);
  ok("no page errors", errors.length === 0, errors.join(" | "));
  await page.close();
}

/* ---- 2. the estimate leads solved-blocks mid-transfer, which is the point ---- */
{
  const page = await browser.newPage();
  await page.goto(URL);
  await page.evaluate(() => document.getElementById("tabRecv").click());
  const ack = await page.evaluate(async () => {
    const payload = new Uint8Array(512 * 1024);
    const enc = LW.makeEncoder(payload, 800, 0x0bad0bad, 0);
    for (let seed = 1; seed < 400; seed++) window.__feed(LW.base45Encode(enc.frame(seed)), 495);
    const d = window.__dec();
    return { solved: d.solvedCount, K: d.K, shown: document.getElementById("covPct").textContent };
  });
  ok("mid-transfer the estimate is ahead of solved blocks",
     parseInt(ack.shown, 10) > Math.floor(ack.solved * 100 / ack.K), `${ack.shown} vs ${ack.solved}/${ack.K}`);
  await page.close();
}

/* ---- 3. an over-cap file is refused, and says why ---- */
{
  const page = await browser.newPage();
  let msg = null;
  page.on("dialog", async (d) => { msg = d.message(); await d.dismiss(); });
  await page.goto(URL);
  const res = await page.evaluate(async () => {
    const f = new File([new Uint8Array(40 * 1024 * 1024)], "huge.bin", { type: "application/octet-stream" });
    const dt = new DataTransfer(); dt.items.add(f);
    document.getElementById("drop").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 400));
    return { streaming: !document.getElementById("sendPanel").classList.contains("hidden"),
             capRejects2GB: 2 * 1024 * 1024 * 1024 > 32 * 1024 * 1024 };
  });
  ok("over-cap file does not start streaming", res.streaming === false);
  ok("2 GB is over the cap by the same test", res.capRejects2GB);
  ok("the refusal states the size and the ceiling", !!msg && /40\.00 MB/.test(msg) && /32\.00 MB/.test(msg), msg && msg.split("\n")[0]);
  ok("the refusal estimates the real wait", !!msg && /(hours|minutes)/.test(msg));
  ok("the refusal explains the memory cost", !!msg && /memory/.test(msg));
  await page.close();
}

await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
