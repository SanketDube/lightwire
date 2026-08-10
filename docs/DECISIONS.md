# Decision log

Why things are the way they are, including what was tried and rejected. If you
are about to "fix" something in this list, read the entry first.

---

## 1. Build from scratch rather than fork an existing tool

Surveyed before building: **Decimen** (decimen.app — good, but AGPL from v0.3.0
onward and a multi-file npm project), **qifi-dev/qrs** (qr-send.com, uses the
`luby-transform` npm package, also multi-file), **LucaIaco/QRFileTransfer** (the
only one with bidirectional ACK, but stop-and-wait and slow), **ShadowCat**
(single-file but sequential, no fountain coding), **libcimbar** (~106 KB/s,
genuinely fast, but not zero-install), **ggwave** (audio, 8–16 B/s).

Requirement was a genuinely single self-contained HTML file. Nothing met it with
fountain coding included, so the codec was written from scratch. This also keeps
the licence position clean — see `PUBLISHING.md`.

## 2. base45 over base64 or raw binary

QR alphanumeric mode has a 45-character charset that packs far denser than byte
mode. base45 maps exactly onto it. ~3% expansion, much denser code.

Decisive factor: barcode engines return **strings** and mangle arbitrary binary.
`BarcodeDetector` especially. A text alphabet removes an entire class of
encoding bugs.

## 3. Compress *then* encrypt

Standard ordering. Ciphertext is indistinguishable from noise and never
compresses; gzip must run first or it is pointless.

The CRIME/BREACH-style caveat (compression before encryption can leak
information about plaintext when an attacker can inject chosen content into the
stream) does not apply here: there is no attacker-controlled injection into a
single static file transfer.

Gzip is applied **only when it actually shrinks the payload** (by more than 64 B).
Random and already-compressed data skip it automatically, so nothing is wasted.
Compression is also a *speed* feature — a text-heavy file over the wire at 18%
of original size means 5× fewer codes.

## 4. Encryption is optional and off by default

Air-gapped transfers happen in rooms. Anything on the sending screen is readable
by any camera in that room. Passphrase → PBKDF2 (250k iterations, SHA-256) →
AES-256-GCM, with the filename hidden inside the encrypted region.

GCM authenticates, so a wrong passphrase fails cleanly and can be retried
**without re-running the transfer** — the receiver holds the raw payload and only
attempts the unlock pipeline on demand.

Left optional because the common case is a trusted desk, and the PBKDF2 cost is
noticeable on start.

## 5. Versioned frame header

Byte 0 is the version. Anything that is not the current version is ignored
entirely. Two builds of different vintage in the same room simply do not see
each other, instead of half-decoding garbage into a corrupt file.

**Bump it on any frame layout change.** It is currently `2` (bumped when the
flags byte was added).

## 6. Fountain coding makes the back-channel optional, not required

The sender's "Watch receiver" camera is pure convenience: live progress and
auto-stop at 100%. The transfer is strictly one-directional and works with the
sender's camera unplugged, covered, or absent. This was verified and is worth
preserving — it is what makes the tool usable in a one-camera setup.

## 7. Web Workers for frame generation

Measured QR generation cost on the main thread:

| Payload | Cost per code |
|---|---|
| 1000 B | 39.5 ms |
| 1400 B | 30.7 ms |
| 2000 B | 43.6 ms |

Ludicrous mode targets ~135 codes/sec ≈ 5 s of CPU per second. Synchronous
generation is impossible at that rate, so workers pre-render into a ring buffer
and the paint loop only blits.

The single-file constraint is preserved by keeping the library source in a
`<script type="text/plain">` block, `eval`-ing it on the main thread and reusing
the identical text as the Worker body through a Blob URL.

Rotating `cellPhase` on queue starvation was added after observing that a dry
queue would otherwise always refresh the same first cells.

## 8. Quiet zone padding = 4 modules

Started at 2 to save pixels. The QR specification requires 4. Fixed once dense
codes started being used; do not reduce it to reclaim screen space.

## 9. **The jsQR trap — read this before trusting any decode test**

A long debugging detour, worth preserving in full.

Grid cells rendered by the workers would not decode in tests. The obvious
suspicion was that the worker rendering path was broken.

A control experiment settled it: the same frame rendered through the worker's
RGBA path and through the main-thread `drawQR` path were compared pixel by pixel
— **`diffPixels: 0`**, byte-identical. And *neither* decoded under jsQR.

So the renderer was fine; the **decoder** was the problem. Confirmed further:
`@zxing/library` (the TypeScript port) also failed on the same images. Then the
same cells were fed to **zxing-wasm** (real ZXing-C++ compiled to WASM), which
decoded all four cells perfectly, with distinct seeds and a matching session ID.

**Conclusions that must survive into future work:**

- jsQR and `@zxing/library` cannot reliably decode dense QR codes (v24+, ~109+
  modules) *even from pixel-perfect synthetic renders*. This is a decoder
  limitation, not an image-quality or camera problem.
- Never use jsQR as the oracle in a test for dense codes. Use zxing-wasm.
- `tests/dbg3.js` is the pixel-identity control. `tests/zxwasm.js` is the proof.

## 10. Embedding ZXing-WASM (the biggest single change)

Originally the design assumed `BarcodeDetector` would carry Windows. It does not.
Chromium only exposes it where the OS provides detection — **macOS, Android, and
Android WebView**. On Windows the API is simply absent, which would have silently
dropped every Windows user onto jsQR, which (per §9) cannot decode the dense
codes the fast modes produce. The tool would have appeared "slow and flaky" for
the primary target platform.

Fix: embed ZXing-C++ via `zxing-wasm` (~940 KB binary, base64'd into the file)
and use `prepareZXingModule({overrides:{wasmBinary}})` so it never fetches.
File grew from ~363 KB to ~1.65 MB.

**The trade was accepted deliberately:** a 1.65 MB file that works everywhere
beats a 363 KB file that quietly fails on Windows. If someone later wants the
small build back, the correct approach is a *separate* slim build target, not
removing the engine from the default.

Provenance check: `sha256(zxing_reader.wasm)` =
`85d46f55d7c86a4d09bb04273367408b19c324f582d040d018aecb25a9a82942`, which matches
the `ZXING_WASM_SHA256` constant compiled into the upstream glue code. Re-verify
this if you ever re-download the binary.

## 11. Measure px/module rather than guess at "camera quality"

"Is my webcam good enough" has an exact answer: **pixels per QR module at the
sensor**, ~3 minimum, ≥4 comfortable. Rather than publish a table of blessed
webcams, the receiver computes it live from the detected code geometry and the
module count (derived from the payload plus the ECC bits in the flags).

See `CAMERA.md` for the arithmetic and per-camera forecasts.

## 12. Focus lock

Autofocus hunting on a static screen is a real throughput killer. Where the
camera exposes manual `focusMode` + `focusDistance` (the Logitech C920 does under
Chrome), a checkbox pins it. Hidden entirely when unsupported.

## 13. Build script is string substitution, not a bundler

`assemble.py` is 23 lines of `str.replace`. No npm, no webpack, no lockfile to
rot, no network needed to build. For a single-file offline tool this is a feature.
There is an `assert` guarding against a `</script>` sequence appearing inside the
inlined library text, which would break the `text/plain` block.

## 14. `test-copy.html` instead of testing the shipped file

The build emits a second file with test hooks injected at a fixed anchor
(`setRole("send");`). The shipped artifact stays free of test scaffolding, and
tests get direct access to internals. If you add a hook, add it in `assemble.py`,
not in `template.html`.

## 15. Puppeteer tests embed their own HTTP server

Backgrounded `python -m http.server` processes do not survive between tool
invocations in the development environment, which caused confusing
`ERR_CONNECTION_REFUSED` failures. Each e2e test now starts its own Node HTTP
server on a distinct port and closes it at the end. Keep this pattern.

## 16. Calibration: the receiver scores, the sender just walks a ladder

"Send test signal" used to hand you 256 KB of noise and a manual protocol in
`CAMERA.md`: step the preset up, watch the numbers, back off one. That protocol
is correct and almost nobody would follow it. It now runs itself.

**Why the sender cannot do the measuring.** The sender has no view of its own
screen. Everything that decides throughput — px/module, whether the engine
keeps up, whether focus is hunting — is only observable at the camera. So the
sender walks a fixed ladder of six settings on a fixed clock and records the one
thing it does know: how many codes it actually painted. The receiver scores.

**Why a fixed ladder and not a closed loop.** Closed-loop rate adaptation is
listed under "explicitly deferred" below, and the reason still holds: it needs a
camera on the *sending* machine too, which is the rarer setup. A fixed ladder
needs no back-channel at all. The ACK channel remains what it always was —
convenience. If the sender happens to be watching, the winning row applies
itself; if not, the verdict is on the receiving screen and you click the row.

**Why the rung number goes in the flags byte, and why the version did NOT get
bumped.** Bits 4-7 of the flags were unused. The rung number lives there, so
the receiver knows which setting it is looking at without any protocol
handshake. Invariant #3 says to bump the version on any *frame layout* change —
this is not one. No field moved, no field changed width, and no decoder reads
the nibble: a build that has never heard of calibration decodes a rung-marked
frame exactly as it always did. Bumping would have been the more disruptive
choice, because two builds of different vintage would then ignore each other
entirely. `tests/test3.js` pins this: if a rung-marked stream ever stops
decoding on a rung-blind decoder, that test fails and the version *must* be
bumped.

**Why the receiver does not run the fountain decoder during a sweep.** Belief
propagation costs CPU, and CPU is part of what the sweep is measuring. Running
it would make the measurement a function of itself. During calibration the
receiver parses the header, counts distinct seeds and tracks geometry — nothing
more. It also means a sweep cannot half-complete into a phantom file.

**Duplicate seeds are rejected.** The same code sitting on screen across two
camera frames is not throughput. Without the seed set, a fast camera reading a
slow screen would report a rate that is really the camera's frame rate.

**Why the ladder is driven at 20 swaps/second, faster than any preset.** The
point is to make the *receiver* the bottleneck. If the sweep ran at the preset
rate, the number coming back would be the ladder's ceiling, not the camera's.
When a rung does hit that ceiling anyway the verdict says so, and recommends
pushing higher rather than pretending the camera was the limit.

**Ranking is by measured KB/s, not by code rate or px/module.** Goodput is
self-correcting: a setting too dense to read collapses its own rate. Small
codes read easily and lose anyway, which is the honest answer. px/module is
reported as the *explanation*, not the criterion.

**The one extrapolation is labelled as one.** px/module is
`(pixels the cell spans) / (modules across)`, and the pixel span is fixed by
where the camera is standing — so a denser code at the same grid is a division,
not another experiment. The panel offers exactly one such suggestion and prints
"Predicted, not measured" in front of it. Everything else on that screen was
observed.

**Discard the first 1.5 s of every rung.** The code size just changed and
autofocus hunts. Including it would score the transition, not the setting.

---

## Explicitly deferred

Considered and consciously not built. Listed with the reasoning so the next
session does not have to re-derive it.

- **Multi-file / folder support.** Zip first and send the archive; gzip-awareness
  already makes that cheap. Adding archive handling to the tool duplicates a
  solved problem.
- **Resume across reload (IndexedDB).** Fountain coding makes a restart cheap —
  you re-catch frames, you do not re-request specific ones. Persistence
  complexity is not obviously worth it below very large files.
- **Dual-camera automatic rate adaptation.** The sender could watch the ACK rate
  and auto-tune fps/grid continuously. Real gains, but it needs both cameras
  pointed at both screens, which is a rarer setup than the manual tuning
  workflow. **Partly superseded by §16:** the calibration sweep gets most of the
  benefit with one camera, by measuring once rather than adapting continuously.
  What is still deferred is the *continuous* loop — reacting mid-transfer when
  someone nudges the laptop.
- **Colour / multi-layer codes (libcimbar-style).** Substantially higher density,
  but abandons standard QR and therefore every off-the-shelf decoder, including
  the embedded ZXing. Would mean writing a bespoke decoder.
- **Slim build without the WASM engine.** See §10 — legitimate as an *additional*
  target, not as a replacement.
