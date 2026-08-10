# Testing

## Prerequisites

Node tests need only Node (18+, for `CompressionStream` and WebCrypto).
End-to-end tests need Puppeteer and a Chrome/Chromium binary.

```bash
cd tests
npm install @zxing/library pngjs      # only for zxcheck.js
```

Each e2e test starts its own HTTP server on its own port and closes it at the
end — see `DECISIONS.md` §15. Update the `executablePath` in each e2e file to
point at your local Chrome. Tests run against `src/test-copy.html` (produced by
`assemble.py`), not against the shipped `dist/lightwire.html`.

## Test inventory

| File | Type | Covers |
|---|---|---|
| `test.js` | Node | Codec under frame loss: 0/20/50%, sizes tiny→2 MB, overhead ratios, single-block edge case. |
| `test2.js` | Node | Flags roundtrip, version gate, gzip roundtrip, AES-GCM roundtrip + wrong-passphrase rejection, full pipeline at 30% loss, SHA-256 vs Node's crypto. |
| `e2e2.js` | Puppeteer | Secure-context detection, encrypted+gzipped send UI, locked receive state, wrong then right passphrase, fingerprint match, incompressible file skipping gzip. |
| `e2e4.js` | Puppeteer | Worker frame factory, 2×2 and 3×3 grid rendering, sustained code rate, cell PNG export, full loop with hash verification. |
| `e2e5.js` | Puppeteer | Engine cascade selection, **offline proof** (all non-localhost requests aborted), test-signal button, one-frame multi-code decode, px/module + verdict plumbing. |
| `zxcheck.js` | Node | Decodes exported cell PNGs with `@zxing/library`. **Known to fail on dense codes — see below.** |
| `zxwasm.js` | Puppeteer | Decodes live on-screen cells with real ZXing-C++ WASM. This is the trustworthy oracle. |
| `dbg2.js` | Puppeteer | Isolation: worker cell vs control render at multiple scales. |
| `dbg3.js` | Puppeteer | Pixel-identity control proving worker RGBA == `drawQR` output. |

## Recorded results

All of the following were observed passing on the final build.

**Codec under loss (`test.js`)** — byte-exact recovery every time:

```
tiny/noloss    K=3     sent=7     overhead=2.33x  crc=true bytes=true
50KB/noloss    K=86    sent=131   overhead=1.52x  crc=true bytes=true
50KB/20%loss   K=86    sent=192   overhead=1.80x  crc=true bytes=true
50KB/50%loss   K=86    sent=205   overhead=1.19x  crc=true bytes=true
500KB/15%      K=569   sent=760   overhead=1.13x  crc=true bytes=true
2MB/10%        K=1907  sent=2393  overhead=1.14x  crc=true bytes=true
single-block   K=1     sent=1     overhead=1.00x  crc=true bytes=true
```

**Pipeline (`test2.js`)**:

```
flags roundtrip: true    version-1 frames rejected: true
gzip: 141 < 18000        roundtrip: true
aes-gcm: true            wrong-pass throws: true    ct-overhead: 44 bytes
pipeline: orig=87859  wire=15679  K=27  crc=true  bytes=true
compression win: 18% of original on the wire
sha256: true
```

**Encrypted receive flow (`e2e2.js`)**:

```
ctx           { secure: true, subtle: true, gz: true }
sender        wire="3.6 KB ↓gz 🔒"  hash="8517·2810·02C3"  passState="AES-256-GCM"
locked-state  title="Received — locked"  unlockShown=true  saveHidden=true
wrong-pass    message shown, still locked
unlocked      "Complete — checksum verified"  hashMatch=true
plain-random  gzUsed=false (correctly skipped)  ok=true  same=true
errors: none
```

**Grid + workers (`e2e4.js`)**, in a 1-worker container — scales with real cores:

```
grid-sender  workers=1 cells=4 sizes=[117,117,117,117] nominal=58.6 KB/s  ~30 codes/s
ludicrous    cells=9  nominal=184.6 KB/s
full-loop    K=24 fed=43 at 25% loss → "Complete"  name=ledger.csv  hashMatch=true
errors: none
```

**Engine + offline + diagnostics (`e2e5.js`)**:

```
engine        { hasNative: false, kind: "zxing" }   externalRequests: 0
test-signal   wire="256.1 KB" (no gzip, correctly)  K=263  cells=4
one-frame     4 of 4 codes decoded from a single composited frame,
              distinct seeds, one shared session
ppm-verdict   ppm=3.76 → cell "3.8" → verdict "adequate"
              title "Complete — checksum verified"
errors: none  externalRequests: 0
```

The `externalRequests: 0` line is the offline guarantee: request interception
aborts everything not on localhost, and the embedded WASM engine still
initialises and decodes.

## Known test-only failure

`zxcheck.js` reports `allValid: false` on dense grid cells. **This is expected
and is not a product bug.** `@zxing/library` (the TypeScript port) shares jsQR's
inability to decode v24+ codes even from perfect renders. `zxwasm.js` decodes
the same cells cleanly. Full story in `DECISIONS.md` §9.

Do not "fix" a decode failure by weakening the codes until jsQR is happy.

## What is not covered by automation

Everything involving real optics, because there is no camera in the test
environment:

- Actual camera capture and the real px/module figures.
- Focus lock behaviour (`focusMode`/`focusDistance` constraints).
- Camera zoom slider.
- Wake Lock.
- Native `BarcodeDetector` path (headless shell does not expose it, so tests
  exercise the ZXing path — the reverse of what macOS/Android users get).
- Real-world throughput. All KB/s figures from tests are synthetic feed rates,
  **not** achievable optical rates.

These need a manual pass — see the checklist in `HANDOFF.md`.
