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
- **Cost:** the receiver needs roughly `K × 1.15` frames rather than exactly `K`,
  where K is the block count. Measured overhead in `tests/test.js` runs 1.13–1.5×,
  approaching 1.13× as K grows.

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
| 15 | 1 | Flags. bit0 `FLAG_ENC`, bit1 `FLAG_GZ`, bits2–3 ECC level index. |

The version byte is a hard compatibility gate: an old build and a new build will
simply ignore each other's frames rather than half-decoding garbage. **If you
change the frame layout, bump it.**

The receiver learns everything it needs from the first frame it happens to
catch — length, block size, flags — so there is no header frame to miss.

The ECC bits in the flags exist only so the receiver can reconstruct how many
modules the sender's codes have, which is needed for the px/module diagnostic
(see `CAMERA.md`). They do not affect decoding.

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
A1:<session 8 hex>:<solved 4 hex>:<K 4 hex>:<rate 2 hex>
```

The sender's optional "Watch receiver" camera reads it to display progress and
to auto-stop at 100%. Frames beginning with `A1:` are ignored by the receiver's
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

## Receiver diagnostics

- **Engine** — which decoder actually got selected.
- **Camera resolution actually delivered** — browsers silently downgrade requests.
- **px/module** — exponential moving average of `detected code width ÷ module count`.
  The single number that decides whether a camera can do the job.
- **Optics verdict** — ≥4 comfortable, ≥3 adequate, below 3 too dense.
- **Measured KB/s** — decode rate × block size. The number to tune against.

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
