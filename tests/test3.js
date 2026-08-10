/* Calibration rung nibble: does it survive the wire, and does it stay
   invisible to everything that does not ask for it?

   The rung number rides in flags bits 4-7. The claim being tested is that this
   is a semantics addition, not a layout change -- so the version byte stayed
   at 2, and a frame carrying a rung decodes exactly like one that does not.
   If that claim ever breaks, this file fails and the version MUST be bumped.

   node test3.js
*/
const LW = require("../src/core.js");

let fails = 0;
function ok(name, cond, extra) {
  console.log((cond ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : ""));
  if (!cond) fails++;
}

/* ---- 1. the nibble is exactly the top four bits, and nothing else moves ---- */
let clean = true, collided = false;
for (let base = 0; base < 16; base++) {
  for (let rung = 0; rung <= 15; rung++) {
    const f = LW.withRung(base, rung);
    if (LW.rungOf(f) !== rung) clean = false;      // rung survives
    if ((f & 0x0F) !== base) collided = false || (collided = true); // low nibble untouched
  }
}
ok("rung roundtrips for every base x rung", clean);
ok("enc / gz / ecc bits are never disturbed", !collided);
ok("rung 0 leaves the flags byte identical", LW.withRung(0x0B, 0) === 0x0B);
ok("rung is masked, not overflowed", LW.withRung(0, 31) === LW.withRung(0, 15));

/* ---- 2. a rung-marked frame is still a v2 frame on the wire ---- */
const payload = new Uint8Array(4096);
for (let i = 0; i < payload.length; i++) payload[i] = (i * 37) & 255;
const flags = LW.withRung(LW.FLAG_GZ | (1 << 2), 5);   // gz + ECC index 1 + rung 5
const encd = LW.makeEncoder(payload, 600, 0xABCDEF01, flags);
const frame = encd.frame(7);
const h = LW.parseHeader(frame);

ok("version byte still 2", frame[0] === 2, "got " + frame[0]);
ok("header parses", !!h);
ok("rung reads back as 5", LW.rungOf(h.flags) === 5);
ok("FLAG_GZ still set", !!(h.flags & LW.FLAG_GZ));
ok("FLAG_ENC still clear", !(h.flags & LW.FLAG_ENC));
ok("ECC index still 1", ((h.flags >> 2) & 3) === 1);

/* ---- 3. base45 is transparent to the flags byte ---- */
const rt = LW.base45Decode(LW.base45Encode(frame));
ok("survives base45 roundtrip", LW.parseHeader(rt).flags === h.flags);

/* ---- 4. an OLD receiver -- one that never heard of rungs -- still decodes.
       Simulated by decoding rung-marked frames with the plain decoder, which
       is exactly what pre-calibration builds do: it reads session, length and
       blockSize and ignores the flags entirely. ---- */
const dec = LW.makeDecoder(h.session, h.length, h.blockSize);
let sentFrames = 0;
for (let seed = 1; !dec.isDone() && seed < 5000; seed++) {
  dec.push(encd.frame(seed));
  sentFrames++;
}
ok("rung-marked stream decodes on a rung-blind decoder", dec.isDone(),
   "K=" + dec.K + " frames=" + sentFrames);
if (dec.isDone()) {
  const out = dec.assemble().subarray(0, payload.length);
  let same = out.length === payload.length;
  for (let i = 0; same && i < payload.length; i++) if (out[i] !== payload[i]) same = false;
  ok("bytes recovered exactly", same);
}

/* ---- 5. calibration and a real transfer cannot be confused ---- */
const plain = LW.makeEncoder(payload, 600, 0xABCDEF01, LW.FLAG_GZ | (1 << 2));
ok("rung 0 on an ordinary transfer", LW.rungOf(LW.parseHeader(plain.frame(1)).flags) === 0);

console.log(fails ? "\n" + fails + " FAILED" : "\nall passed");
process.exit(fails ? 1 : 0);
