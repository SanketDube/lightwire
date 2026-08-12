# Handoff

Written for a session or person picking this up cold.

## Where things stand

The tool is **complete and working**. It has been built, exercised end to end,
and the headless test suite passes. Three build generations happened:

1. **v1** — fountain codec, base45, UI, ACK back-channel. ~363 KB.
2. **v2** — AES-256-GCM, gzip, wake lock, fingerprints, zoom, paste-to-send.
3. **v3 (turbo)** — grid mode, worker frame factory, per-camera-frame decoding,
   presets, then the embedded ZXing engine and camera diagnostics. **~1.65 MB.**

4. **v3.1 (2026-08-10)** — published as `github.com/SanketDube/lightwire` under
   Apache-2.0 with full third-party attribution, and the **calibration sweep**
   added to `Send test signal`.
5. **v3.2 (2026-08-10)** — field runs on real optics: 12.82 MB at 60.6 KB/s,
   then **300 MB twice** at up to 83.6 KB/s (393,217 blocks, 3x3 at 800 B).
   Receive screen reordered around them: result at the top, block grid replaced
   by an estimated progress bar, ACK code moved above anything that grows with
   the file, and the input ceiling raised from a guessed 32 MB to a measured
   512 MB with a warning above 64 MB. `DECISIONS.md` §17 and §18.
7. **v3.4 (2026-08-12)** — rectangular arrangements: the grid can match the
   sensor's shape (4×2 wide, 2×4 tall, auto from the sender's screen), worth
   +58% optical capacity on a 16:9 camera by geometry; ladder gained wide
   rungs; fullscreen honours the grid's aspect. From the operator's own
   observation. `DECISIONS.md` §23.
6. **v3.3 (2026-08-10)** — six more field runs, including 300 MB three times
   and a best of **90.0 KB/s**. Decoder options tuned on measurement (24% off
   decode time), two-phase calibration (aim, then sweep, with Hold and Next),
   auto-save on completion, and the px/module verdict made to agree with the
   number printed beside it. `DECISIONS.md` §19 and §20.

`dist/lightwire.html` is the current build. **Six real-camera transfers have
now happened**, up to 300 MB and a best of 90.0 KB/s — full figures in
`CAMERA.md`. The per-camera *forecast tables* in that file are still forecasts
and one has already been retracted as too pessimistic. **The calibration sweep
has still never run on real hardware:** its scoring and recommendation are
tested only against a simulated link, so the machinery is proven and no ranked
optical table exists yet. That remains the single most valuable missing
measurement.

Published 2026-08-10. See `PUBLISHING.md` for what that closed and what it did
not.

## Invariants — do not break these casually

1. **One file.** No external fetches, no sibling assets, no CDN. Verified by
   `e2e5.js` with request interception. This is the product.
2. **Fountain coding means no feedback is required.** The sender must keep working
   with no camera at all. The ACK channel is convenience only.
3. **Bump the version byte** on any frame layout change (`DECISIONS.md` §5).
4. **jsQR is not a valid oracle for dense codes.** Use `zxwasm.js`
   (`DECISIONS.md` §9). This will waste a day if forgotten.
5. **Compress before encrypt**, and only compress when it shrinks.
6. **Quiet zone stays at 4 modules.**
7. **Test hooks live in `assemble.py`**, never in `template.html`.
8. **Calibration never runs the fountain decoder** (`DECISIONS.md` §16). If you
   "fix" that, the sweep starts measuring its own CPU cost.
9. **Attribution stays inside `dist/lightwire.html`.** The file travels alone;
   a sibling `LICENSE` does not go with it.

## Immediate next steps

**Highest value: run one calibration sweep on the hardware that has already
moved 300 MB.** It now aims first with no clock running, then walks eight
settings you can hold individually — so it doubles as the tuning session the
operator was doing by hand. It produces this project's first ranked optical
table and closes most of what is left below.

- [x] Confirm the engine readout says **ZXing (bundled)**, not jsQR. **Done
      2026-08-10** — a real run reported `ZXing (bundled)`, so the WASM embed
      survives on real hardware and grid mode is not worthless. OS unrecorded;
      worth re-confirming specifically on Windows.
- [ ] Confirm the delivered camera resolution matches expectations (browsers
      downgrade silently).
- [ ] **Run one calibration sweep** and record the whole table — that is the
      first measured optical data this project will ever have.
- [ ] Compare the sweep's px/module against the C920 forecast in `CAMERA.md`
      (predicted ~4.7 at 2×2 / 1000 B). If they disagree badly, the forecast
      model in `CAMERA.md` is what needs correcting, not the sweep.
- [x] Check whether 3×3 works on a real sensor. **It does** — 300 MB moved on
      3×3 repeatedly. The "aspirational" note is retracted.
- [ ] Check whether the sweep's winner matches what was picked by hand (3×3 at
      900 B gave the best measured run, 90.0 KB/s).
- [ ] Confirm the "sender-limited" flag fires where expected — a laptop should
      be unable to paint 3×3 at 20 swaps/s.
- [ ] Verify focus lock appears and helps on the C920.
- [ ] Verify wake lock on both machines during a long transfer.
- [ ] Transfer a real file both ways and confirm the SHA-256 fingerprints match
      by eye.
- [ ] Try one deliberately bad camera to confirm the "too dense" verdict fires
      and the advice is actionable.
- [ ] With a second camera on the sender, confirm the ACK auto-apply path works
      optically and not only in the unit test.

Once there are measured numbers, rewrite the speed paragraph in `README.md` and
the forecast tables in `CAMERA.md` around them, and relabel the presets, which
`Known limitations` already flags as optimistic.

## Known limitations

- **jsQR fallback is weak.** Firefox and Safari fall through to it, and it cannot
  decode above ~600 B. Those browsers are effectively limited to Steady mode.
  Fixable by shipping a second WASM build or accepting the limitation loudly.
- **File size is 1.65 MB**, ~940 KB of which is the decoder engine. Deliberate.
- **512 MB hard ceiling, warning above 64 MB.** The limit is the *receiving*
  machine: it holds every code caught until the cascade at the end, about 4x
  the file size, plus a contiguous buffer the size of the file at assembly.
  300 MB has been done twice on real hardware. To move the ceiling again, fix
  the sender's 5x multiplier first (each worker gets its own copy of the
  payload); the receiver's pile is intrinsic to LT decoding. `DECISIONS.md` §18.
- ~~**Ludicrous 3×3 is aspirational on 1080p.**~~ **Retracted 2026-08-10.**
  3×3 was measured moving 300 MB repeatedly at 800 and 900 B per code. The
  forecast that said otherwise only ever evaluated 3×3 at 1400 B. The presets
  are still labelled with *nominal* rates, which measure ~25% above reality —
  relabelling them with measured ranges is still worth doing.
- **Progress is an estimate and says so.** It cannot be exact: the honest
  figure (solved blocks) is unwatchable on this codec -- 0% at the halfway
  point of a real transfer. `DECISIONS.md` §17. If the codec ever changes,
  re-run `tests/overhead.js` and update the `NEED` table in `template.html`.
- **The calibration ladder is fixed at eight settings.** It cannot recommend
  anything it did not send — 2000 B, or ECC levels above L, are outside it. The
  verdict extrapolates one step beyond the winner and says it is extrapolating.
  Widening the ladder costs sweep time linearly; **14** is the ceiling, because
  rung 15 is reserved for the aiming pattern.
- **jsQR-only browsers get a misleading sweep.** On the fallback decoder only
  one code per camera frame is read, so every grid rung scores as though it were
  1×1. The engine readout says which decoder is in use; the sweep does not
  currently warn on its own.
- **No resume across reload** (deferred; see `DECISIONS.md`).
- **Single file only** — zip first for multiple files (deferred).

## Environment notes for the next session

- Node 18+ needed for `CompressionStream` and WebCrypto in the codec tests.
- Puppeteer e2e files read `PUPPETEER_PATH` and `CHROME_PATH` from the
  environment; the hardcoded paths are gone.
- Two tests are Playwright (`e2e6-calibration.mjs`, `smoke-playwright.mjs`).
  Point `NODE_PATH` at a tree containing it. Deliberate: it keeps at least one
  runnable regression check on a machine with either driver installed.
- `window.__calTiming(ms, settle, quiet)` shortens the sweep for tests. Without
  it a single e2e run takes 40 seconds.
- Each e2e test runs its own HTTP server; do not rely on a backgrounded
  `python -m http.server`, it will not survive (`DECISIONS.md` §15).
- `assemble.py` must run from `src/`.
- `zxcheck.js` failing on dense cells is expected, not a regression
  (`TESTING.md`).

## If you change the protocol

Read `ARCHITECTURE.md` first, then:

1. Bump the version byte.
2. Update `parseHeader` and the encoder together.
3. Re-run `test.js` and `test2.js` before touching any UI.
4. Re-run `e2e2.js`, `e2e4.js`, `e2e5.js`.
5. Confirm `externalRequests: 0` still holds in `e2e5.js`.

## Ideas parked, with reasoning

All in `DECISIONS.md` under "Explicitly deferred": multi-file support, IndexedDB
resume, dual-camera auto rate adaptation, colour/multi-layer codes, and a slim
build without the WASM engine. Each has a stated reason for deferral — read it
before reviving one.
