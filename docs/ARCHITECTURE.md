# Architecture

## The core idea

Naive QR file transfer chops a file into N chunks and displays them in a loop.
The receiver must catch every single chunk. Miss chunk 47 and you wait for the
whole cycle to come around again — and if the camera is unreliable, you may
never converge. Existing tools mostly fail here: they either have no
retransmission at all, or they need a bidirectional channel to ask for specific
missing chunks.

Lightwire uses a **Luby Transform (LT) fountain code** instead. Each displayed
code is not "chunk 47" — it is the XOR of a randomly chosen subset of the file's
blocks, with the subset determined by a seed carried in the frame header. Any
sufficiently large collection of these mixes lets the receiver solve for the
original blocks by belief propagation.

Consequences, and they are the whole design:

- **Missing a frame costs nothing.** There is no "which chunk was that" bookkeeping.
- **The receiver can start at any time.** No synchronisation, no start-of-stream marker.
- **The sender never needs feedback.** It emits fresh mixes forever; the receiver
  stops when it has enough. The back-channel in the UI is a convenience, not a
  requirement.
- **Cost:** the receiver needs slightly more than `K` frames, where K is the
  block count. **Corrected 2026-08-10 — the old figure here was wrong in the
  wrong direction.** It claimed overhead approached 1.13× as K grows; it does
  the opposite. Measured with the real codec (`tests/overhead.js`):

  | K | codes needed | overhead |
  |---|---|---|
  | 100 | 135 | 1.35× |
  | 500 | 598 | 1.20× |
  | 1,000 | 1,087 | 1.09× |
  | 5,000 | 5,284 | 1.06× |
  | 16,476 | 16,974 | **1.03×** |
  | 40,000 | 41,026 | 1.026× |
  | 160,000 | 167,648 | 1.048× |
  | 393,217 | 412,776 | 1.050× |

  The curve is **U-shaped**, which is worth knowing before extrapolating from
  either end: overhead falls to a minimum near 40,000 blocks and then rises
  again. That is the robust soliton distribution's tuning — its spike sits at
  `K/R` with `R` proportional to `√K`, so a balance that is near-ideal in the
  tens of thousands drifts off in the hundreds of thousands. A 300 MB field run
  at K=393,217 needs 1.05×, not the 1.03× a naive reading of the small-K trend
  would predict.
  The 1.13–1.5× range in `tests/test.js` is real but was measured at small K.
  A field run of a 12.57 MB file came back at 1.029×, which matches the table
  rather than contradicting it.

  **The overhead does not depend on how lossy the link is** — losing 30% of
  frames changes how long the transfer takes, not how many distinct codes are
  needed. That is what makes progress estimable at all; see below.

## Data flow

```
        SENDER                                    RECEIVER

  file bytes
     │
     ├─ buildContainer()  metaLen + JSON{name,type,size,crc} + data
     │
     ├─ gzip (optional, only if it shrinks)  ──── FLAG_GZ
     │
     ├─ AES-256-GCM (optional, passphrase)   ──── FLAG_ENC
     │        (compress THEN encrypt — see DECISIONS)
     │
     └─ payload ──► LT encoder
                      │  frame(seed) = 16B header + XOR of chosen blocks
                      │
                      ├─ base45 encode  ──► QR (alphanumeric mode)
                      │                       │
                      │                    screen ═══► camera
                      │                                  │
                      │                          barcode engine → text
                      │                                  │
                      │                          base45 decode
                      │                                  │
                      │                          LT decoder (belief propagation)
                      │                                  │
                      │                          assemble payload
                      │                                  │
                      │                          decrypt / gunzip (per flags)
                      │                                  │
                      │                          openContainer → CRC32 verify
                      │                                  │
                      └──── ACK QR ◄──────────────── progress code
                            (optional)                   │
                                                    save file
```

## Wire format

Every frame is a 16-byte header followed by the XOR payload.

| Offset | Size | Field |
|---|---|---|
| 0 | 1 | Version. Currently `2`. Frames with any other value are ignored. |
| 1–4 | 4 | Session ID (random per stream). Changing file/settings changes this. |
| 5–8 | 4 | Total payload length in bytes. |
| 9–10 | 2 | Block size in bytes. |
| 11–14 | 4 | Seed. Drives the PRNG that selects which blocks are XORed. |
| 15 | 1 | Flags. bit0 `FLAG_ENC`, bit1 `FLAG_GZ`, bits2–3 ECC level index, bits4–7 calibration rung. |

The version byte is a hard compatibility gate: an old build and a new build will
simply ignore each other's frames rather than half-decoding garbage. **If you
change the frame layout, bump it.**

The receiver learns everything it needs from the first frame it happens to
catch — length, block size, flags — so there is no header frame to miss.

The ECC bits in the flags exist only so the receiver can reconstruct how many
modules the sender's codes have, which is needed for the px/module diagnostic
(see `CAMERA.md`). They do not affect decoding.

The top four bits carry the **calibration rung** — `0` on an ordinary transfer,
`1..6` while the sender is walking the calibration ladder. Nothing in the codec
reads them, which is why adding them did not need a version bump; a build that
predates calibration decodes a rung-marked frame exactly as it decodes any
other. See `DECISIONS.md` §16.

### Container format

Inside the payload (after decryption/decompression):

```
[4 bytes: metaLen][metaLen bytes: JSON {n:name, t:mimetype, s:size, c:crc32}][file bytes]
```

Metadata lives *inside* the encrypted region, so an observer watching the screen
of an encrypted transfer cannot even see the filename.

### ACK format

The receiver renders a small QR containing:

```
A1:<session 8 hex>:<solved 4 hex>:<K 4 hex>:<rate 2 hex>[:P<pct 2 hex>][:C<...>]
```

The sender's optional "Watch receiver" camera reads it to display progress and
to auto-stop at 100%. The two trailing fields are additions that older builds
never see, because anything past the fourth colon was already ignored:

- `P` — the receiver's **estimated** percentage. The sender prefers it for
  display, because `solved/K` does not move until the end. `solved` and `K`
  themselves are untouched, so the auto-stop still fires on real completion
  and nothing else.
- `C` — the calibration verdict (`DECISIONS.md` §16).

The code is redrawn on a 700 ms clock rather than when the solved count
changes. Building a QR costs real work on the decode path, and the old trigger
meant the code sat frozen for most of a transfer. Frames beginning with `A1:` are ignored by the receiver's
own decode path so a mirror or reflection cannot confuse it.

## base45, not base64

QR codes have an "alphanumeric" mode with a 45-character charset that packs
significantly denser than byte mode. base45 maps exactly onto that charset. It
costs about 3% expansion over raw bytes but buys a much denser code.

More importantly: barcode engines return **strings**. `BarcodeDetector` in
particular mangles arbitrary binary. Encoding to a text alphabet sidesteps every
encoding-guessing problem in the stack.

## The three speed levers

Throughput = `codes on screen × swaps per second × bytes per code`.

1. **Grid mode (1×1 / 2×2 / 3×3).** Barcode engines return *every* code they find
   in one frame. A 3×3 grid is a genuine 9× multiplier with no protocol change —
   each cell is an independent fountain frame. This is the single biggest lever.
2. **Per-camera-frame decoding.** The receiver uses `requestVideoFrameCallback`
   (falling back to `rAF`, then `setTimeout`) and hands the `<video>` element
   straight to the engine — no intermediate canvas copy on the native/ZXing paths.
3. **Bytes per code.** Up to 2000 B. Capacity ceiling is QR v40-L alphanumeric =
   4296 chars; 2000 B → 3024 chars, so it fits with headroom.

### Why the worker frame factory exists

QR generation for a 1000–1400 B payload costs **30–44 ms** on the main thread
(measured, see `DECISIONS.md`). Ludicrous mode wants ~135 codes/sec, i.e. about
5 seconds of CPU per wall-clock second. Impossible synchronously.

So `src/template.html` spins up to `min(6, hardwareConcurrency-1)` Web Workers.
The workers are constructed from **the same inlined library source** as the main
thread (the `<script type="text/plain" id="libsrc">` block is read as text,
`eval`'d on the main thread, and passed verbatim as the Worker body via a Blob
URL) — which is how the single-file constraint survives multithreading.

- Each worker gets the whole payload once, plus a seed **stride** so workers
  never produce duplicate seeds.
- Workers render frames to raw RGBA and transfer the buffers (zero-copy).
- The main thread keeps a ring buffer, refills when it drops below `cells × 3`,
  requests `cells × 8` at a time, and paints with `putImageData`.
- If the queue momentarily runs dry, a rotating `cellPhase` ensures no cell
  starves — otherwise the same corner cells would always win.
- If Workers are unavailable, there is a synchronous fallback path that still works,
  just slowly.

## Barcode engine cascade

This mattered more than expected. See `DECISIONS.md` for the full story.

| Priority | Engine | Where it applies |
|---|---|---|
| 1 | Native `BarcodeDetector` | Chrome/Edge on **macOS and Android only** |
| 2 | **ZXing-C++ compiled to WASM, embedded in the file** | Windows, Linux, and anywhere else |
| 3 | jsQR | Last resort only; fails on codes above ~600 B |

All three are normalised behind a `read(video, canvas, ctx)` interface returning
`[{text, w}]`, where `w` is the detected code width in camera pixels — that
geometry is what powers the px/module diagnostic.

The WASM binary is embedded as base64 in a `<script type="text/plain">` block and
handed to the module via the `wasmBinary` override, so it **never fetches
anything**. Verified with all non-localhost requests blocked: zero external
requests.

## Calibration

`Send test signal` no longer just streams noise — it sweeps. The sender walks
six settings, marking each one with its rung number, and the receiver scores
them. The design reasoning is in `DECISIONS.md` §16; the mechanics:

```
   SENDER                                          RECEIVER

 six rungs, 6.5 s each, 20 swaps/s
 1x1 600 / 1x1 1400 / 2x2 800
 2x2 1200 / 3x3 800 / 3x3 1200
        │
        ├─ flags bits 4-7 = rung number
        │        │
        │     screen ═══════════════════════════►  camera
        │                                             │
        │                                    parse header only
        │                                    (no fountain decode:
        │                                     it would eat the CPU
        │                                     being measured)
        │                                             │
        │                                    reject duplicate seeds
        │                                    drop the first 1.5 s
        │                                             │
        │                                    per rung: codes/s, px/module
        │                                             │
   records only its own        sweep ends ──►  rank by measured KB/s
   paint rate per rung         (2.5 s quiet)         │
        │                                    recommend grid, bytes, swaps/s
        │                                             │
        └──── ACK QR ◄────────────────────────────────┘
              "…:C<rung><grid><bytes><fps>"
              (optional: only if the sender has a camera)
```

The sender's own contribution is the **paint rate** — codes it actually got on
screen versus codes it was asked for. A rung where those diverge is marked
*sender-limited*, so a slow machine is not misread as a weak camera.

If the sender is not watching, the verdict is on the receiving screen naming a
row number, and the sender's table has an Apply button on every row. Nothing
about the sweep requires a second camera.

## Receiver diagnostics

- **Engine** — which decoder actually got selected.
- **Camera resolution actually delivered** — browsers silently downgrade requests.
- **px/module** — exponential moving average of `detected code width ÷ module count`.
  The single number that decides whether a camera can do the job.
- **Optics verdict** — ≥4 comfortable, ≥3 adequate, below 3 too dense.
- **Measured KB/s** — decode rate × block size. The number to tune against.
- **Estimated progress** — codes received against codes needed.

### Why progress is an estimate, and why it is not "blocks solved"

The obvious progress bar is solved blocks over K. It is useless here, and the
reason is intrinsic to fountain coding rather than a defect.

A belief-propagation decoder can only resolve a mix when all but one of its
ingredients are already known. Early on almost nothing is known, so mixes pile
up unresolved. One frame eventually completes a chain, that release completes
others, and the whole pile collapses at once. Measured on a 4 MB file: at the
halfway point of the transfer the estimate read **54%** and solved blocks read
**0%**. The truthful number sits at zero for the entire run and then jumps.

So the bar is built on `readCount / codesNeeded(K)`, with `codesNeeded` from
the measured overhead table above. It is honest about being an estimate, is
clamped so it can never reach 100% before the file genuinely completes, and
never moves backwards. The solved-block count is still shown as a separate
figure in the readout for anyone who wants the literal truth.

The block-coverage grid this replaced was removed in the same change: it drew
one cell per block, so it grew with the file, and it showed the same stalled
signal in a form that also pushed the rest of the page off the screen.

## Files and responsibilities

- **`src/core.js`** — pure logic, no DOM. Exports for Node so the codec can be
  tested headlessly. Contains base45, CRC32, mulberry32 PRNG, robust soliton
  distribution, LT encoder/decoder, container build/open, and the async
  gzip/AES/SHA-256 helpers.
- **`src/template.html`** — all UI, all browser APIs, the worker source tail, the
  engine cascade, both role state machines.
- **`src/assemble.py`** — inlines vendor libs and core into the template. Also
  emits `test-copy.html` with test hooks (`window.__feed`, `__dec`, `__result`,
  `__q`, `__cells`, `__workers`, `__engine`, `__hf`, `__ppm`) injected at a fixed
  anchor. Tests run against `test-copy.html`, never against `dist/lightwire.html`.
