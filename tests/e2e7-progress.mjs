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

/* ---- the file saves itself once it is complete ----
   After an hour of streaming, needing one more click to keep the file is a way
   to lose it. The button stays as a fallback because a browser may refuse a
   download it did not see a click for. */
{
  const page = await browser.newPage({ acceptDownloads: true });
  await page.goto(URL);
  await page.evaluate(() => document.getElementById("tabRecv").click());
  const dl = page.waitForEvent("download", { timeout: 15000 }).catch(() => null);
  await page.evaluate(async () => {
    const file = new TextEncoder().encode("ledger,rows\n" + "x".repeat(40000));
    const container = LW.buildContainer("ledger.csv", "text/csv", file);
    const enc = LW.makeEncoder(container, 600, 0x5a7e1234, 0);
    for (let seed = 1; seed < 900; seed++) {
      window.__feed(LW.base45Encode(enc.frame(seed)), 600);
      const d = window.__dec();
      if (d && d.isDone()) break;
    }
    await new Promise((r) => setTimeout(r, 100));
  });
  const got = await dl;
  ok("a completed file downloads without being asked", !!got,
     got ? "suggested name: " + got.suggestedFilename() : "no download fired");
  if (got) ok("it keeps the sender's filename", got.suggestedFilename() === "ledger.csv", got.suggestedFilename());
  const btn = await page.evaluate(() => ({
    text: document.getElementById("save").textContent,
    visible: !document.getElementById("save").classList.contains("hidden")
  }));
  ok("the manual button stays as a fallback", btn.visible === true && btn.text === "Save again", JSON.stringify(btn));
  await page.close();
}

/* ---- 3. the decode rate cannot exceed what the sender can produce ----
   Field readout showed 141.5 codes/s against a hard ceiling of 135. Codes are
   fed here in bursts of nine sharing a timestamp, exactly as a grid frame
   arrives, at a known true rate -- the reported figure must not run away. */
{
  const page = await browser.newPage();
  await page.goto(URL);
  await page.evaluate(() => document.getElementById("tabRecv").click());
  const r = await page.evaluate(async () => {
    const payload = new Uint8Array(2 * 1024 * 1024);
    const enc = LW.makeEncoder(payload, 800, 0x7e57face, 0);
    let seed = 1;
    const CELLS = 9, SWAPS = 15;          // 135 codes/s, the real ceiling
    const t0 = Date.now();
    const seen = [];
    while (Date.now() - t0 < 5000) {
      for (let c = 0; c < CELLS; c++) window.__feed(LW.base45Encode(enc.frame(seed++)), 495);
      await new Promise((r) => setTimeout(r, 1000 / SWAPS));
      const shown = document.getElementById("rFps").textContent;
      if (shown !== "—") seen.push(parseFloat(shown));
    }
    const fed = seed - 1;
    return { fed, trueRate: fed / ((Date.now() - t0) / 1000), max: Math.max(...seen),
             last: seen[seen.length - 1], samples: seen.length };
  });
  /* the feed loop cannot hit a full 135/s because setTimeout has its own floor,
     so compare the reading against what was actually fed */
  ok("reported rate never exceeds what was actually fed",
     r.max <= r.trueRate * 1.12,
     `peak reported ${r.max.toFixed(1)}/s vs ${r.trueRate.toFixed(1)}/s truly fed`);
  ok("reported rate is not a wild underestimate either",
     r.last >= r.trueRate * 0.85,
     `last reported ${r.last.toFixed(1)}/s vs ${r.trueRate.toFixed(1)}/s truly fed`);
  await page.close();
}

/* ---- 3. the size ladder: allowed / warned / refused ----
   A 300 MB transfer has completed twice on real hardware, so a flat refusal at
   32 MB was wrong. What is asserted now is the shape: quiet below the warn
   line, an informed choice above it, a hard stop only where a browser really
   will not follow. */
async function drop(sizeBytes, answer) {
  const page = await browser.newPage();
  let msg = null, kind = null;
  page.on("dialog", async (d) => {
    msg = d.message(); kind = d.type();
    if (d.type() === "confirm" && answer === "accept") await d.accept(); else await d.dismiss();
  });
  await page.goto(URL);
  const res = await page.evaluate(async (n) => {
    const f = new File([new Uint8Array(n)], "big.bin", { type: "application/octet-stream" });
    const dt = new DataTransfer(); dt.items.add(f);
    document.getElementById("drop").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
    /* an 80 MB file is a real amount of work to slice up before the first code
       appears, so poll rather than guess at a fixed wait */
    for (let i = 0; i < 200; i++) {
      if (!document.getElementById("sendPanel").classList.contains("hidden")) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    return { streaming: !document.getElementById("sendPanel").classList.contains("hidden") };
  }, sizeBytes);
  await page.close();
  return { ...res, msg, kind };
}

{
  const small = await drop(8 * 1024 * 1024);
  ok("a small file is sent with no interruption", small.streaming === true && small.msg === null,
     small.msg || "no dialog");

  const warned = await drop(80 * 1024 * 1024, "dismiss");
  ok("a long transfer asks first", warned.kind === "confirm", warned.kind || "no dialog");
  ok("declining it does not start the transfer", warned.streaming === false);
  ok("the question states the wait", !!warned.msg && /(hours|minutes)/.test(warned.msg));
  ok("the question states the memory the receiver will hold",
     !!warned.msg && /memory/.test(warned.msg) && /320\.00 MB/.test(warned.msg));

  const accepted = await drop(80 * 1024 * 1024, "accept");
  ok("accepting it does start the transfer", accepted.streaming === true);

  const refused = await drop(600 * 1024 * 1024, "accept");
  ok("past the hard ceiling it is refused outright", refused.kind === "alert" && refused.streaming === false);
  ok("the refusal names the ceiling", !!refused.msg && /512\.00 MB/.test(refused.msg),
     refused.msg && refused.msg.split("\n")[0]);
}

await browser.close(); server.close();
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
