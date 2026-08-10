/* Calibration sweep, end to end in a real browser.
 *
 * There is no camera here, so optics are simulated: frames are handed straight
 * to the receiver's decode entry point with a code width in "camera pixels".
 * That is enough to test everything the feature actually decides -- rung
 * bookkeeping, duplicate rejection, scoring, ranking, the recommendation, and
 * the ACK round trip -- without pretending to measure real throughput.
 *
 * Playwright rather than Puppeteer, because that is what was on the machine
 * this was written on. Point NODE_PATH at a tree containing playwright:
 *
 *   NODE_PATH=/path/to/node_modules node e2e6-calibration.mjs
 */
import http from "http";
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const PORT = 8137;
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

/* ============ 1. the sender walks the ladder and stops ============ */
{
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.evaluate(() => window.__calTiming(400, 100, 300));

  await page.click("#testSig");
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 6000) {
    const r = await page.evaluate(() => window.__calRung());
    if (r) seen.add(r);
    if (await page.evaluate(() => !document.getElementById("calResults").classList.contains("hidden"))) break;
    await new Promise((r) => setTimeout(r, 60));
  }

  const ladder = await page.evaluate(() => window.__calLadder.length);
  ok("sweep visited every rung", seen.size === ladder, `saw ${seen.size} of ${ladder}`);

  const state = await page.evaluate(() => ({
    rung: window.__calRung(),
    stats: window.__calStats().length,
    resultsShown: !document.getElementById("calResults").classList.contains("hidden"),
    rowsInTable: document.querySelectorAll("#calTable tr").length - 1,
    stillSending: !document.getElementById("sendPanel").classList.contains("hidden"),
    knobsBack: !document.getElementById("knobPanel").classList.contains("hidden"),
    head: document.getElementById("calHead").textContent
  }));
  ok("sweep ended", state.rung === 0 && state.head === "Calibration done");
  ok("one stat row per rung", state.stats === ladder, `stats=${state.stats}`);
  ok("results table rendered", state.resultsShown && state.rowsInTable === ladder);
  ok("sender goes quiet so the receiver can finalise", !state.stillSending);
  ok("knobs handed back to the user", state.knobsBack);

  /* every rung must have produced a real session with the rung marked */
  const flagCheck = await page.evaluate(() => {
    const out = [];
    for (let rung = 1; rung <= 6; rung++) out.push(LW.rungOf(LW.withRung(2 | (1 << 2), rung)) === rung);
    return out.every(Boolean);
  });
  ok("rung nibble helpers available in page", flagCheck);

  /* applying a row must set the three knobs and clear the sweep */
  await page.evaluate(() => window.__takeRec("C" + "04" + "2" + "04B0" + "0E")); // rung 4, 2x2, 1200 B, 14/s
  await page.click("#calTable tr.win button");
  const applied = await page.evaluate(() => ({
    grid: document.getElementById("grid").value,
    bs: document.getElementById("bs").value,
    fps: document.getElementById("fps").value,
    note: document.getElementById("calApplied").textContent,
    pickBack: !document.getElementById("pickPanel").classList.contains("hidden")
  }));
  ok("recommendation applied to the knobs",
     applied.grid === "2" && applied.bs === "1200" && applied.fps === "14",
     JSON.stringify(applied));
  ok("back at the file picker with a note", applied.pickBack && /1200 B/.test(applied.note));

  ok("no page errors during the sweep", errors.length === 0, errors.join(" | "));
  await page.close();
}

/* ============ 2. the receiver scores what it sees ============ */
{
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.evaluate(() => {
    window.__calTiming(2000, 300, 700);
    document.getElementById("tabRecv").click();
  });

  /* Three rungs at different simulated qualities. Rung 4 is built to win:
     fewer codes per second than rung 3, but each one carries 1200 B. */
  const plan = [
    { rung: 2, bs: 1400, rate: 12, width: 1000 },
    { rung: 3, bs: 800,  rate: 40, width: 500 },
    { rung: 4, bs: 1200, rate: 36, width: 500 }
  ];

  for (const p of plan) {
    await page.evaluate(async (p) => {
      const payload = new Uint8Array(64 * 1024);
      for (let i = 0; i < payload.length; i++) payload[i] = (i * 31) & 255;
      const session = (0x1000 + p.rung) >>> 0;
      const enc = LW.makeEncoder(payload, p.bs, session, LW.withRung(0, p.rung));
      const gap = 1000 / p.rate;
      let seed = 1;
      const started = Date.now();
      /* 1.6 s of steady feed: past the settle window, past the partial threshold */
      while (Date.now() - started < 1600) {
        window.__feed(LW.base45Encode(enc.frame(seed++)), p.width);
        await new Promise((r) => setTimeout(r, gap));
      }
      /* duplicate check: replay a seed already sent, twice */
      const dup = LW.base45Encode(enc.frame(1));
      window.__feed(dup, p.width);
      window.__feed(dup, p.width);
    }, p);
  }

  const beforeFinish = await page.evaluate(() => {
    const runs = window.__rcal().runs;
    const out = {};
    for (const k in runs) out[k] = { n: runs[k].n, seeds: runs[k].seeds.size, bs: runs[k].bs, ppm: runs[k].ppm };
    return out;
  });
  ok("a bucket per rung", Object.keys(beforeFinish).length === 3, JSON.stringify(Object.keys(beforeFinish)));
  ok("duplicate codes are not counted as throughput",
     Object.values(beforeFinish).every((r) => r.seeds >= r.n),
     JSON.stringify(beforeFinish));
  ok("px/module tracked from code width",
     Math.abs(beforeFinish[4].ppm - 500 / 117) < 0.6,
     "rung4 ppm=" + beforeFinish[4].ppm.toFixed(2));

  await page.evaluate(() => window.__calFinish());
  const res = await page.evaluate(() => ({
    rec: window.__rcal().rec,
    verdict: document.getElementById("rcalVerdict").textContent,
    verdictShown: !document.getElementById("rcalVerdict").classList.contains("hidden"),
    ackShown: !document.getElementById("rcalAckStage").classList.contains("hidden"),
    winRow: (document.querySelector("#rcalTable tr.win") || {}).textContent || "",
    head: document.getElementById("rcalHead").textContent,
    panelShown: !document.getElementById("rcalPanel").classList.contains("hidden"),
    progHidden: document.getElementById("progPanel").classList.contains("hidden")
  }));

  ok("calibration panel took over from the transfer panel", res.panelShown && res.progHidden);
  ok("finished", res.head === "Calibration done");
  ok("highest goodput wins, not the highest code rate",
     res.rec && res.rec.rung === 4 && res.rec.b === 1200 && res.rec.g === 2,
     JSON.stringify(res.rec));
  ok("winning row highlighted", /1200 B/.test(res.winRow), res.winRow.trim());
  ok("recommends a swaps-per-second figure", res.rec.fps >= 2 && res.rec.fps <= 30, "fps=" + res.rec.fps);
  ok("verdict is shown and names the setting",
     res.verdictShown && /2×2 · 1200 B/.test(res.verdict), res.verdict.slice(0, 160));
  ok("verdict reports a measured KB/s", /KB\/s/.test(res.verdict));
  ok("prediction is labelled as a prediction",
     /Predicted, not measured/.test(res.verdict), res.verdict.slice(-180));
  ok("says how many settings it actually saw", /3 of 6 settings measured/.test(
     await page.evaluate(() => document.getElementById("rcalNow").textContent)));
  ok("ACK for the sender is drawn", res.ackShown);

  /* the ACK the receiver draws must be the one the sender can read back */
  const roundTrip = await page.evaluate(() => {
    const r = window.__rcal().rec;
    const hex2 = (n) => ("00" + n.toString(16).toUpperCase()).slice(-2);
    const hex4 = (n) => ("0000" + n.toString(16).toUpperCase()).slice(-4);
    const field = "C" + hex2(r.rung) + (r.g & 15).toString(16).toUpperCase() + hex4(r.b) + hex2(r.fps);
    document.getElementById("tabSend").click();
    window.__takeRec(field);
    return { field, back: window.__calRec() };
  });
  ok("receiver's ACK field parses on the sender",
     roundTrip.back && roundTrip.back.rung === 4 && roundTrip.back.b === 1200,
     roundTrip.field + " -> " + JSON.stringify(roundTrip.back));

  /* a field whose ladder does not match must be refused, not guessed at */
  const mismatch = await page.evaluate(() => {
    window.__takeRec("C" + "01" + "3" + "07D0" + "0A");   // rung 1 claiming 3x3 / 2000 B
    return window.__calRec();
  });
  ok("a disagreeing ladder is ignored rather than guessed",
     mismatch && mismatch.rung === 4, JSON.stringify(mismatch));

  ok("no page errors while scoring", errors.length === 0, errors.join(" | "));
  await page.close();
}

/* ============ 3. an ordinary transfer is untouched by any of this ============ */
{
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL);
  await page.evaluate(() => document.getElementById("tabRecv").click());
  const done = await page.evaluate(async () => {
    const file = new TextEncoder().encode("x".repeat(9000));
    const container = LW.buildContainer("plain.txt", "text/plain", file);
    const enc = LW.makeEncoder(container, 600, 0x77771234, 0);   // rung 0
    for (let seed = 1; seed < 400; seed++) {
      window.__feed(LW.base45Encode(enc.frame(seed)), 600);
      const d = window.__dec();
      if (d && d.isDone()) break;
    }
    await new Promise((r) => setTimeout(r, 50));
    return {
      title: document.getElementById("doneTitle").textContent,
      calSeen: window.__rcal().seen,
      calPanel: document.getElementById("rcalPanel").classList.contains("hidden")
    };
  });
  ok("rung-0 stream still completes normally", /checksum verified/i.test(done.title), done.title);
  ok("no calibration state touched", done.calSeen === false && done.calPanel === true);
  ok("no page errors on the plain path", errors.length === 0, errors.join(" | "));
  await page.close();
}

await browser.close();
server.close();
console.log(fails ? `\n${fails} FAILED` : "\nall passed");
process.exit(fails ? 1 : 0);
