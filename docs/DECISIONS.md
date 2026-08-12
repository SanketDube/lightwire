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

## 17. The block grid is gone, and progress is an estimate

The receiver used to draw one cell per block and fill them in as blocks were
solved. Two problems, one cosmetic and one fundamental.

**Cosmetic:** the grid grew with the file. At four pixels per block, stretched
to the panel width, its on-screen height is `(rows / columns) x width`. Columns
were fixed at 100, so a 12 MB transfer produced 165 rows -- a grid two thirds
taller than the panel is wide, pushing the ACK code off the bottom of the
window. That was fixed first by widening the grid instead of deepening it.

**Fundamental, and why the grid went anyway:** solved-blocks is not progress.
A belief-propagation decoder can only resolve a mix when all but one of its
ingredients are already known, so early on nothing resolves and mixes pile up.
One frame eventually completes a chain, the release cascades, and the pile
collapses at once. Measured on a 4 MB file at the halfway point of the
transfer: **estimate 54%, solved blocks 0%.** A user watching the honest number
sees a dead bar for minutes and then a jump. The grid was a prettier way of
showing the same nothing.

So the bar counts **codes received against codes needed**. Three properties
make that defensible:

1. **The overhead factor was measured, not guessed** (`tests/overhead.js`).
   1.35x at K=100 falling to 1.03x at K=16,476. Note this also corrected a
   wrong claim in `ARCHITECTURE.md`, which said overhead *approached* 1.13x as
   K grew. It goes the other way.
2. **It does not depend on loss.** `readCount` only counts codes that arrived
   and were useful, so dropping 30% of frames changes how long the transfer
   takes, not how many codes are needed. A progress estimate built on this is
   stable on a bad link, where one built on elapsed time would not be.
3. **It cannot lie in the direction that matters.** Clamped to 99 until the
   file genuinely completes, and never allowed to move backwards. The literal
   solved-block count stays visible in the readout for anyone who wants it.

The word "Estimated" is on the label because it is one. If the codec or the
soliton parameters change, re-run `tests/overhead.js` and update the table in
`template.html`.

### The grid was also a throughput bug, which was found afterwards

Removing it turned out to matter for a second reason nobody had noticed. The
old `paint()` did this:

```js
if (dec.solvedCount !== lastCov) { lastCov = dec.solvedCount; drawCoverage(); drawAck(); }
```

`drawCoverage()` issues **one `fillRect` per block**. At 393,217 blocks that is
393,217 rectangles, and it fired once for every code received whose arrival
changed the solved count.

For most of a transfer the solved count barely moves (§17), so it almost never
ran. Then the cascade begins, the count changes on nearly every code, and it
runs on nearly every code. Measured at K=393,217: **177 ms per redraw.** A
camera delivering 135 codes/s has 7.4 ms per code to spend, so the ceiling
collapses to about **5.6 codes/s — 4% of the rate up to that point.**

This was reported from the field before it was understood: *"it slowed down to
nearly 10-15% of usual speed towards the end"* on a 300 MB transfer. The tail
cost roughly an extra hour of wall clock, spent entirely on drawing rectangles.

The decoder itself does genuinely slow during the cascade — measured in Node at
K=393,217, `push` throughput falls from ~12,000/s to ~1,600/s, because every
newly solved block must be XORed into each of the ~14.7 pending mixes that
reference it. But 1,600/s is still more than ten times any optical rate, so
that part is invisible. **The visible collapse was the canvas, not the codec.**

Two changes fixed it, both already made for other reasons:

- The grid is gone. The replacement writes two DOM properties, and only when
  the integer percentage changes — which during a cascade is at most twice.
- `drawAck()` moved off the decode path onto a 700 ms clock. It was building a
  QR code on every solved-count change for the same reason.

**The general lesson, worth more than the fix:** nothing whose cost scales with
the file may sit on the per-code path. That path runs at the camera's frame
rate and must stay O(1).

## 18. The size ceiling: 32 MB was wrong, 512 MB with a warning is the fix

The original build refused anything over 32 MB. That number was never measured
— it was a guess with a plausible-sounding justification ("larger files take
hours optically"). Two things demolished it on the same day:

- **A 300 MB file transferred successfully, twice**, on real hardware, at
  393,217 blocks. The owner raised the cap by hand to do it, which is exactly
  what a wrong limit invites.
- **At the settings actually in use it took about an hour**, not "hours".

So the ceiling is now evidence-shaped rather than a single flat refusal:

| Size | Behaviour |
|---|---|
| under 64 MB | sent, no interruption |
| 64 MB to 512 MB | a confirm box stating the wait at the settings selected, and the memory the receiver will hold. Proceed or cancel. |
| over 512 MB | refused, with the reason |

**Where the 512 MB comes from.** The receiver is the expensive side, and the
reason is the same avalanche that makes progress unmeasurable (§17): almost
every code that arrives sits in a pile of unresolved mixes until the very end,
so memory climbs for the whole transfer and peaks just before completion.
Measured on a 300 MB / 393,217-block decode, tracked to 68% of the way through
and extrapolated: **roughly 4x the file size**, plus one contiguous buffer the
size of the file when it is finally assembled. About 1.2 GB for 300 MB. At
512 MB that is around 2 GB, which is where a browser tab stops being reliable.

**A 2 GB file** would want roughly 8 GB before it drew a code, exceeds the
largest single buffer several engines will allocate, and at a real measured
83 KB/s is about 7 hours of unbroken streaming with both screens awake. It is
refused, and the message says why.

**If the ceiling ever needs to move again, fix the multiplier first.** The
sender hands each render worker its own full copy of the payload; sharing one
would take the sending side from ~5x down to ~2x. On the receiving side the
pending pile is intrinsic to LT decoding and cannot be avoided without changing
the code — that is the real wall.

**One thing that was checked and is NOT a problem:** the cascade in `solve()`
is recursive, and at 393,217 blocks a deep enough chain would blow the call
stack — a failure that would land after an hour of transfer, at 99%. Tested
directly at K = 16,000 / 50,000 / 120,000 / 250,000 / 393,217: every one
completed. The ripple resolves in many short chains rather than one long one.
Do not "fix" it into an explicit queue without re-testing; there is no bug here
to fix.

## 19. Decoder options: stop searching for things that cannot be there

Lightwire does **no** image processing of its own. The video frame is drawn to
a canvas and the raw RGBA handed to ZXing, which does its own greyscale
conversion and thresholding. That threshold is *local average* by default — it
decides light-vs-dark per region rather than once per frame, which is why glare
on one corner does not kill the whole grid. `GlobalHistogram` was tried on the
same image and decoded **0 of 9**. Do not change the binarizer.

What was wasteful was the *searching*. Measured on a blurred, noised 3x3 grid
of 900 B codes at 1920x1080:

| Options | Decode time | Found |
|---|---|---|
| as shipped (`tryHarder` only) | 63.6 ms | 9/9 |
| `tryRotate:false` | 58.8 ms | 9/9 |
| `tryDownscale:false` | 56.3 ms | 9/9 |
| **both off** | **48.2 ms** | **9/9** |
| plus `tryInvert:false` | 43.9 ms | 9/9 here, **0/9 on an inverted screen** |
| `tryHarder:false` | 56.4 ms | **8/9** — a code lost |

Adopted: `tryRotate:false, tryDownscale:false`. **24% off decode time**, taking
the ceiling from ~142 to ~187 codes/s, with no loss in any case tested —
including a frame rotated 90 degrees, because QR finder patterns are already
rotation-invariant, and a single large code filling the frame.

**`tryInvert` stays on deliberately.** It was the single biggest saving and it
is the one that is not safe: a forced dark mode on the sending machine inverts
the codes, and without the inversion search every code is lost. A 7% gain is
not worth a class of setup that silently transfers nothing.

Decode time caps codes/s, which caps throughput. This is the highest-leverage
knob in the file, and it should be re-measured whenever the engine is updated.

## 20. Calibrate in two phases: aim first, then sweep

The first sweep started measuring the instant the button was pressed. That is
the wrong order, and the field runs proved it: the operator's own report was
that *"camera angle focus etc matters a lot"*, and one manual focus adjustment
was worth **31%** on the same transfer — more than any setting change achieved.
A sweep that begins before the camera is aimed measures the aiming, not the
settings.

So there are now two phases:

1. **Aim.** A single fixed pattern (2x2 at 900 B) streams with **no clock
   running**. The receiving screen shows px/module live, plus the best value
   seen so far, so the operator can move the camera, change the angle and pin
   the focus while watching the number respond. The sweep starts only when
   they press the button. The aiming pattern carries rung number 15 and is
   never scored — it would otherwise put a row in the table nobody chose.
2. **Sweep.** Eight rungs rather than six, at **12 seconds** each rather than
   6.5, with **Hold** and **Next** controls so any rung can be extended
   indefinitely while the operator keeps adjusting. The ladder now covers three
   block sizes at 2x2 and three at 3x3, because the field runs landed on 900 B
   — a value the original six-rung ladder never tested.

The cost is time: about 100 seconds of sweep instead of 40, plus however long
aiming takes. That is the right trade for a measurement whose whole purpose is
to be trusted afterwards, and the operator controls both.

## 21. The efficiency pass: what was measured, what moved, what refused to

Every change here was benchmarked before and after (`tests/bench.js`); two
candidates were rejected because the numbers said no.

**The encoder no longer copies the file.** It used to cut the payload into K
separate little arrays — a second full copy of the file, held by the main
thread *and again by every render worker*. Now the blocks are *views* (windows
onto the same memory, a `subarray`), and only the final partial block gets real
storage for its zero padding. Measured on a 32 MB payload: the encoder used to
add **58 MB**; it now adds **15 MB** (the soliton table and per-view
bookkeeping). With 3 workers, sender-side memory for a large file drops by
roughly a full file-size per worker plus one for the main thread.

**Encoder XOR runs word-wise.** Mixing blocks is pure XOR, and doing it 4 bytes
at a time (`Uint32Array` views over the same memory) doubled frame generation:
**24,400 → 53,800 frames/s** on a 32 MB payload at 900 B. The worker pool
exists because frame generation was the sender's bottleneck (§7), so this is
direct headroom for Ludicrous mode on weak machines.

**The decoder deliberately does NOT use the word-wise helper.** Tried, measured,
reverted: the helper builds two typed-array views per call, which pays for
itself across an encoder frame's dozen large XORs but was a **net loss** in the
decoder — its cascade makes millions of tiny calls (K=120,000 run went 6.9 s →
9.2 s). The decoder keeps its plain byte loops and is no slower than before.
The helper also falls back to the byte loop below 64 bytes for the same reason.
**Measure before moving this boundary.**

**The receiver's readout repaints on a 150 ms clock, not per code.** Eight DOM
text writes per accepted code was the same class of mistake as the block grid
(§17), only smaller — layout work on the per-code path. At 100+ codes/s the
numbers changed faster than anyone can read anyway.

Not touched, with reasons: the per-frame `getImageData` copy is part of the
measured decode cost and ZXing needs the pixels anyway; the decoder's pending
pile is intrinsic to LT decoding (§18); `assemble()` overshoots the file length
by at most one block, which is under a kilobyte.

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
