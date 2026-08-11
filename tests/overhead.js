/* Measures how many distinct codes the receiver actually needs per block.
   This is not a pass/fail test -- it is where the numbers in the progress
   estimate come from (template.html, the NEED table). Re-run it if the codec
   or the soliton parameters ever change, and update that table from what it
   prints. See docs/DECISIONS.md #17.

   node overhead.js
*/
/* How many distinct codes does the receiver actually need, per block?
   This is the number the progress estimate has to be built on. */
const LW = require("../src/core.js");
function run(K, blockSize, lossPct) {
  const payload = new Uint8Array(K * blockSize - 17);
  let s = 0x1f2e3d4c;
  for (let i = 0; i < payload.length; i++) { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; payload[i] = s & 255; }
  const enc = LW.makeEncoder(payload, blockSize, 0x1234, 0);
  const dec = LW.makeDecoder(0x1234, payload.length, blockSize);
  let sent = 0, accepted = 0;
  for (let seed = 1; !dec.isDone() && seed < enc.K * 6; seed++) {
    sent++;
    if (lossPct && (seed * 7919) % 100 < lossPct) continue;   // deterministic loss
    if (dec.push(enc.frame(seed))) accepted++;
  }
  return { K: enc.K, sent, accepted, ratio: +(accepted / enc.K).toFixed(4), done: dec.isDone() };
}
console.log("blockSize=800, no loss");
for (const K of [100, 500, 1000, 2500, 5000, 10000, 16476]) {
  const r = run(K, 800, 0);
  console.log(`  K=${String(r.K).padEnd(6)} accepted=${String(r.accepted).padEnd(6)} ratio=${r.ratio}  done=${r.done}`);
}
console.log("blockSize=800, 30% of codes lost in flight");
for (const K of [500, 5000, 16476]) {
  const r = run(K, 800, 30);
  console.log(`  K=${String(r.K).padEnd(6)} accepted=${String(r.accepted).padEnd(6)} ratio=${r.ratio}  done=${r.done}`);
}
