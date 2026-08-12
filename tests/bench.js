/* Before/after evidence for core changes. Not pass/fail. See DECISIONS.md #21.
   node bench.js            -- benches the current core
   node bench.js path.js    -- benches any other build of it
*/
/* Baseline: what do the encoder and decoder cost today? */
const LW = require(process.argv[2] || "../src/core.js");
const mb = () => Math.round(process.memoryUsage().rss / 1048576);

// --- encoder: frames/s and memory ---
{
  const N = 32 * 1024 * 1024, BS = 900;
  const payload = new Uint8Array(N);
  const before = mb();
  const enc = LW.makeEncoder(payload, BS, 0x1234, 0);
  const after = mb();
  let t0 = Date.now(), n = 0;
  while (Date.now() - t0 < 2000) { enc.frame(++n); }
  console.log("ENCODER  32MB payload: makeEncoder added " + (after - before) + " MB   frame(): " + Math.round(n / 2) + "/s");
}

// --- decoder: full run at a big K, total time (the cascade dominates) ---
{
  const K = 120000, BS = 8, len = K * BS - 3;
  const p = new Uint8Array(len);
  const enc = LW.makeEncoder(p, BS, 7, 0);
  const dec = LW.makeDecoder(7, len, BS);
  const t0 = Date.now();
  let fed = 0;
  for (let s = 1; !dec.isDone() && s < K * 3; s++) { dec.push(enc.frame(s)); fed++; }
  console.log("DECODER  K=120000 bs=8: " + ((Date.now() - t0) / 1000).toFixed(2) + "s  fed=" + fed + "  done=" + dec.isDone());
}
// --- decoder at realistic block size, moderate K ---
{
  const K = 40000, BS = 900, len = K * BS - 3;
  const p = new Uint8Array(len);
  const enc = LW.makeEncoder(p, BS, 9, 0);
  const dec = LW.makeDecoder(9, len, BS);
  const t0 = Date.now();
  for (let s = 1; !dec.isDone() && s < K * 3; s++) dec.push(enc.frame(s));
  console.log("DECODER  K=40000 bs=900: " + ((Date.now() - t0) / 1000).toFixed(2) + "s  done=" + dec.isDone() + "  rss=" + mb() + " MB");
}
