# Handoff

Written for a session or person picking this up cold.

## Where things stand

The tool is **complete and working**. It has been built, exercised end to end,
and the headless test suite passes. Three build generations happened:

1. **v1** — fountain codec, base45, UI, ACK back-channel. ~363 KB.
2. **v2** — AES-256-GCM, gzip, wake lock, fingerprints, zoom, paste-to-send.
3. **v3 (turbo)** — grid mode, worker frame factory, per-camera-frame decoding,
   presets, then the embedded ZXing engine and camera diagnostics. **~1.65 MB.**

`dist/lightwire.html` is the current build. It has **not** been tested against a
real camera — the development environment has none. Every optical number in the
docs is a forecast from first principles, clearly marked as such.

Nothing has been published. See `PUBLISHING.md`.

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

## Immediate next steps

**Highest value: a manual pass on real hardware.** Everything below is untested
outside forecasts.

- [ ] Windows Chrome → confirm the engine readout says **ZXing (bundled)**, not
      jsQR. If it says jsQR, the WASM embed failed and grid mode is worthless.
- [ ] Confirm the delivered camera resolution matches expectations (browsers
      downgrade silently).
- [ ] Run the test signal at Fast, read real **px/module**, compare against the
      C920 forecast in `CAMERA.md` (predicted ~4.7 at 2×2/1000 B).
- [ ] Find the actual maximum sustained KB/s and record it — the docs currently
      have no measured optical figure at all.
- [ ] Verify focus lock appears and helps on the C920.
- [ ] Verify wake lock on both machines during a long transfer.
- [ ] Transfer a real file both ways and confirm the SHA-256 fingerprints match
      by eye.
- [ ] Try one deliberately bad camera to confirm the "too dense" verdict fires
      and the advice is actionable.

Then, if publishing: work through the `PUBLISHING.md` checklist, starting with
attribution, which is the one genuine blocker.

## Known limitations

- **jsQR fallback is weak.** Firefox and Safari fall through to it, and it cannot
  decode above ~600 B. Those browsers are effectively limited to Steady mode.
  Fixable by shipping a second WASM build or accepting the limitation loudly.
- **File size is 1.65 MB**, ~940 KB of which is the decoder engine. Deliberate.
- **32 MB soft cap** on input, with a warning. Arbitrary but sane — larger files
  take hours optically.
- **Ludicrous 3×3 is aspirational on 1080p.** The preset label says 189 KB/s
  nominal; the C920 forecast says the optics will not sustain it. Consider
  relabelling the presets with realistic ranges once measured.
- **No resume across reload** (deferred; see `DECISIONS.md`).
- **Single file only** — zip first for multiple files (deferred).

## Environment notes for the next session

- Node 18+ needed for `CompressionStream` and WebCrypto in the codec tests.
- Puppeteer e2e files hardcode a Chrome `executablePath` — update it.
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
