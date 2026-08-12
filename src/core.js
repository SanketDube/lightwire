/* ---- Decimen-free single-file core: base45 + crc32 + LT fountain codes ---- */

var B45 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
var B45R = (function () { var m = {}; for (var i = 0; i < 45; i++) m[B45[i]] = i; return m; })();

function base45Encode(bytes) {
  var out = "";
  var i = 0, n = bytes.length;
  for (; i + 1 < n; i += 2) {
    var v = bytes[i] * 256 + bytes[i + 1];
    var c = v % 45; v = (v - c) / 45;
    var d = v % 45; v = (v - d) / 45;
    out += B45[c] + B45[d] + B45[v];
  }
  if (i < n) {
    var v2 = bytes[i];
    var c2 = v2 % 45; var d2 = (v2 - c2) / 45;
    out += B45[c2] + B45[d2];
  }
  return out;
}

function base45Decode(str) {
  var n = str.length;
  var full = Math.floor(n / 3), rem = n % 3;
  if (rem === 1) throw new Error("bad base45 length");
  var out = new Uint8Array(full * 2 + (rem === 2 ? 1 : 0));
  var o = 0;
  for (var i = 0; i < full; i++) {
    var a = B45R[str[i * 3]], b = B45R[str[i * 3 + 1]], c = B45R[str[i * 3 + 2]];
    if (a === undefined || b === undefined || c === undefined) throw new Error("bad base45 char");
    var v = a + b * 45 + c * 2025;
    if (v > 65535) throw new Error("base45 overflow");
    out[o++] = (v >> 8) & 255; out[o++] = v & 255;
  }
  if (rem === 2) {
    var a2 = B45R[str[full * 3]], b2 = B45R[str[full * 3 + 1]];
    if (a2 === undefined || b2 === undefined) throw new Error("bad base45 char");
    var v2 = a2 + b2 * 45;
    if (v2 > 255) throw new Error("base45 overflow");
    out[o++] = v2;
  }
  return out;
}

var CRC_TABLE = (function () {
  var t = new Uint32Array(256);
  for (var n = 0; n < 256; n++) {
    var c = n;
    for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  var c = 0xFFFFFFFF;
  for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* deterministic PRNG (mulberry32) — identical on both sides */
function rng(seed) {
  var a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    var t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* robust soliton distribution -> cumulative table, computed once per K */
function solitonTable(K) {
  if (K <= 1) return [1];
  var c = 0.03, delta = 0.5;
  var R = c * Math.log(K / delta) * Math.sqrt(K);
  var pivot = Math.max(1, Math.round(K / R));
  var p = new Array(K + 1).fill(0);
  p[1] = 1 / K;
  for (var d = 2; d <= K; d++) p[d] = 1 / (d * (d - 1));
  for (var d2 = 1; d2 < pivot; d2++) p[d2] += R / (d2 * K);
  if (pivot <= K) p[pivot] += R * Math.log(R / delta) / K;
  var sum = 0;
  for (var i = 1; i <= K; i++) sum += p[i];
  var cum = new Array(K + 1);
  var acc = 0;
  for (var j = 1; j <= K; j++) { acc += p[j] / sum; cum[j] = acc; }
  cum[K] = 1;
  return cum;
}

/* pick the source-block indices for a given seed */
function pickIndices(seed, K, cum) {
  var r = rng(seed);
  var d;
  if (K <= 1) d = 1;
  else {
    var x = r(), lo = 1, hi = K;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (cum[mid] < x) lo = mid + 1; else hi = mid; }
    d = lo;
  }
  if (d > K) d = K;
  var idx = [];
  var seen = new Set();
  while (idx.length < d) {
    var v = Math.floor(r() * K);
    if (v >= K) v = K - 1;
    if (!seen.has(v)) { seen.add(v); idx.push(v); }
  }
  return idx;
}

var HEADER = 16; /* ver(1) session(4) len(4) blockSize(2) seed(4) flags(1) */

var FLAG_ENC = 1, FLAG_GZ = 2;

/* Flags byte: bit0 FLAG_ENC, bit1 FLAG_GZ, bits2-3 ECC level index,
   bits 4-7 the calibration rung number (0 = an ordinary transfer).
   The rung nibble is diagnostic only -- no decoder reads it -- which is why
   adding it did not need a version bump. See docs/DECISIONS.md #16. */
function rungOf(flags) { return (flags >> 4) & 15; }
function withRung(flags, rung) { return ((flags & 0x0F) | ((rung & 15) << 4)) & 255; }

/* XOR src into dst, four bytes at a time where alignment allows. Used by the
   ENCODER only, and deliberately not by the decoder: this helper builds two
   typed-array views per call, which pays for itself over an encoder frame's
   dozen large XORs (below 64 bytes the byte loop wins even there) but was
   measured a NET LOSS in the decoder, whose cascade
   makes millions of tiny calls (6.9s -> 9.2s at K=120,000). The decoder keeps
   its plain byte loops. Measure before moving this boundary. */
function xorInto(dst, src, len) {
  var n = len;
  if (n >= 64 && (n & 3) === 0 && (dst.byteOffset & 3) === 0 && (src.byteOffset & 3) === 0) {
    var d = new Uint32Array(dst.buffer, dst.byteOffset, n >> 2);
    var s = new Uint32Array(src.buffer, src.byteOffset, n >> 2);
    for (var i = 0; i < d.length; i++) d[i] ^= s[i];
    return;
  }
  for (var k = 0; k < n; k++) dst[k] ^= src[k];
}

function makeEncoder(container, blockSize, sessionId, flags) {
  flags = flags || 0;
  var K = Math.max(1, Math.ceil(container.length / blockSize));
  /* Blocks are VIEWS into the container, not copies -- an encoder used to cost
     a second full copy of the file, in the main thread and again in every
     render worker. Only the final partial block needs real storage, for its
     zero padding. Measured on a 32 MB payload: 58 MB extra then, ~0 now. */
  var blocks = [];
  for (var i = 0; i < K - 1; i++) blocks.push(container.subarray(i * blockSize, (i + 1) * blockSize));
  var last = new Uint8Array(blockSize);
  last.set(container.subarray((K - 1) * blockSize));
  blocks.push(last);
  var cum = solitonTable(K);
  return {
    K: K,
    frame: function (seed) {
      var idx = pickIndices(seed, K, cum);
      var out = new Uint8Array(HEADER + blockSize);
      out[0] = 2;
      out[1] = (sessionId >>> 24) & 255; out[2] = (sessionId >>> 16) & 255;
      out[3] = (sessionId >>> 8) & 255; out[4] = sessionId & 255;
      var L = container.length;
      out[5] = (L >>> 24) & 255; out[6] = (L >>> 16) & 255;
      out[7] = (L >>> 8) & 255; out[8] = L & 255;
      out[9] = (blockSize >>> 8) & 255; out[10] = blockSize & 255;
      out[11] = (seed >>> 24) & 255; out[12] = (seed >>> 16) & 255;
      out[13] = (seed >>> 8) & 255; out[14] = seed & 255;
      out[15] = flags & 255;
      var p = out.subarray(HEADER);
      p.set(blocks[idx[0]]);
      for (var j = 1; j < idx.length; j++) xorInto(p, blocks[idx[j]], blockSize);
      return out;
    }
  };
}

function parseHeader(bytes) {
  if (bytes.length < HEADER + 1 || bytes[0] !== 2) return null;
  return {
    session: ((bytes[1] << 24) | (bytes[2] << 16) | (bytes[3] << 8) | bytes[4]) >>> 0,
    length: ((bytes[5] << 24) | (bytes[6] << 16) | (bytes[7] << 8) | bytes[8]) >>> 0,
    blockSize: (bytes[9] << 8) | bytes[10],
    seed: ((bytes[11] << 24) | (bytes[12] << 16) | (bytes[13] << 8) | bytes[14]) >>> 0,
    flags: bytes[15]
  };
}

function makeDecoder(session, length, blockSize) {
  var K = Math.max(1, Math.ceil(length / blockSize));
  var cum = solitonTable(K);
  var solved = new Array(K);
  var solvedCount = 0;
  var pending = [];
  var byIndex = new Map();
  var seenSeeds = new Set();

  function attachPending(blk) {
    pending.push(blk);
    blk.idx.forEach(function (i) {
      var l = byIndex.get(i); if (!l) { l = []; byIndex.set(i, l); } l.push(blk);
    });
  }
  function solve(i, data) {
    if (solved[i]) return;
    solved[i] = data; solvedCount++;
    var list = byIndex.get(i);
    if (!list) return;
    byIndex.delete(i);
    for (var n = 0; n < list.length; n++) {
      var blk = list[n];
      if (blk.dead || !blk.idx.has(i)) continue;
      for (var k = 0; k < blockSize; k++) blk.data[k] ^= data[k];
      blk.idx.delete(i);
      if (blk.idx.size === 1) {
        var only = blk.idx.values().next().value;
        blk.dead = true;
        solve(only, blk.data);
      } else if (blk.idx.size === 0) blk.dead = true;
    }
  }

  return {
    K: K,
    get solvedCount() { return solvedCount; },
    solvedMap: solved,
    isDone: function () { return solvedCount === K; },
    push: function (bytes) {
      var h = parseHeader(bytes);
      if (!h || h.session !== session || h.length !== length || h.blockSize !== blockSize) return false;
      if (seenSeeds.has(h.seed)) return false;
      seenSeeds.add(h.seed);
      var idxArr = pickIndices(h.seed, K, cum);
      var data = new Uint8Array(bytes.subarray(HEADER, HEADER + blockSize));
      var set = new Set();
      for (var j = 0; j < idxArr.length; j++) {
        var i = idxArr[j];
        if (solved[i]) { var sv = solved[i]; for (var k2 = 0; k2 < blockSize; k2++) data[k2] ^= sv[k2]; }
        else set.add(i);
      }
      if (set.size === 0) return true;
      if (set.size === 1) { solve(set.values().next().value, data); return true; }
      attachPending({ idx: set, data: data, dead: false });
      return true;
    },
    assemble: function () {
      var out = new Uint8Array(K * blockSize);
      for (var i = 0; i < K; i++) out.set(solved[i], i * blockSize);
      return out.subarray(0, length);
    }
  };
}

function buildContainer(nameStr, typeStr, fileBytes) {
  var meta = JSON.stringify({ n: nameStr, t: typeStr, s: fileBytes.length, c: crc32(fileBytes) });
  var metaBytes = new TextEncoder().encode(meta);
  var out = new Uint8Array(4 + metaBytes.length + fileBytes.length);
  out[0] = (metaBytes.length >>> 24) & 255; out[1] = (metaBytes.length >>> 16) & 255;
  out[2] = (metaBytes.length >>> 8) & 255; out[3] = metaBytes.length & 255;
  out.set(metaBytes, 4); out.set(fileBytes, 4 + metaBytes.length);
  return out;
}

function openContainer(container) {
  var ml = ((container[0] << 24) | (container[1] << 16) | (container[2] << 8) | container[3]) >>> 0;
  var meta = JSON.parse(new TextDecoder().decode(container.subarray(4, 4 + ml)));
  var data = container.subarray(4 + ml);
  return { meta: meta, data: data, ok: crc32(data) === meta.c && data.length === meta.s };
}


/* ---------- optional transforms: gzip + AES-256-GCM (feature-detected) ---------- */
function concatBytes(list) {
  var n = 0; for (var i = 0; i < list.length; i++) n += list[i].length;
  var o = new Uint8Array(n), p = 0;
  for (var j = 0; j < list.length; j++) { o.set(list[j], p); p += list[j].length; }
  return o;
}
function subtleOK() {
  return typeof crypto !== "undefined" && crypto.subtle && typeof crypto.subtle.importKey === "function";
}
async function gzipBytes(b) {
  if (typeof CompressionStream === "undefined") return null;
  var ab = await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  return new Uint8Array(ab);
}
async function gunzipBytes(b) {
  if (typeof DecompressionStream === "undefined") return null;
  var ab = await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer();
  return new Uint8Array(ab);
}
async function deriveKey(pass, salt) {
  var km = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt: salt, iterations: 250000, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
async function encryptBytes(pass, plain) {
  var salt = crypto.getRandomValues(new Uint8Array(16));
  var iv = crypto.getRandomValues(new Uint8Array(12));
  var key = await deriveKey(pass, salt);
  var ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, plain));
  return concatBytes([salt, iv, ct]);
}
async function decryptBytes(pass, payload) {
  if (payload.length < 44) throw new Error("payload too short");
  var salt = payload.subarray(0, 16), iv = payload.subarray(16, 28), ct = payload.subarray(28);
  var key = await deriveKey(pass, salt);
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ct));
}
async function sha256Hex(b) {
  if (!subtleOK()) return null;
  var d = new Uint8Array(await crypto.subtle.digest("SHA-256", b));
  var s = "";
  for (var i = 0; i < d.length; i++) s += ("0" + d[i].toString(16)).slice(-2);
  return s;
}

if (typeof module !== "undefined") module.exports = {
  base45Encode, base45Decode, crc32, makeEncoder, makeDecoder, parseHeader, xorInto,
  buildContainer, openContainer, HEADER, FLAG_ENC, FLAG_GZ, rungOf, withRung,
  gzipBytes, gunzipBytes, encryptBytes, decryptBytes, sha256Hex, subtleOK, concatBytes
};
