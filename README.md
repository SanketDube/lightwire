# Lightwire

A single HTML file that moves a file between two computers using nothing but a
screen and a camera. No network, no install, no server. Built for crossing an
air gap.

The sender turns a file into an endless stream of QR codes. The receiver points
a camera at that screen and reassembles the file. Because the codes are
**fountain-coded**, the receiver can join late, miss codes, blink, or lose focus
and still finish — there is no retransmission request, no handshake, and the
sender never needs to know what was missed.

```
dist/lightwire.html      ← the deliverable. Open it in a browser. That's it.
```

**Status:** working and verified end to end against synthetic feeds. **No pass
on real optics yet** — every camera figure in these docs is a forecast from
first principles and is marked as one. Download-only: there is no hosted demo,
so nobody is asked to trust a server for an air-gap tool.

---

## Quickstart

**Sending machine:** open `dist/lightwire.html`, stay on the *Send* tab, drop a
file in. Codes start streaming immediately.

**Receiving machine:** open the same file, switch to *Receive*, click
*Start camera*, point it at the sending screen. Watch the coverage grid fill.
When it says "Complete — checksum verified", click *Save file*.

**Camera access needs a secure context.** Chrome treats `file://` as secure for
crypto and hashing, but `getUserMedia` generally is not granted there. On the
receiving machine, serve it instead:

```bash
cd <folder containing lightwire.html>
python -m http.server 8000
# then open http://localhost:8000/lightwire.html
```

The sending machine can just double-click the file — it needs no camera.

## Repository layout

| Path | What it is |
|---|---|
| `dist/lightwire.html` | Built single-file app (~1.65 MB). The only thing an end user needs. |
| `src/core.js` | Codec: base45, CRC32, LT fountain encoder/decoder, container format, crypto/gzip helpers. Node-testable, no DOM. |
| `src/template.html` | UI + app logic, with `__PLACEHOLDER__` slots for the vendored libraries. |
| `src/assemble.py` | Build script. Inlines everything into `dist/lightwire.html`. |
| `src/vendor/` | Third-party libraries, vendored deliberately (see `docs/PUBLISHING.md`). |
| `tests/` | Node codec tests and Puppeteer end-to-end tests. |
| `docs/` | Architecture, decision log, testing notes, camera theory, publishing analysis, handoff state. |
| `screenshots/` | Rendered UI states, captured from the headless test runs. |

## Building

```bash
cd src
python3 assemble.py     # writes ../dist/lightwire.html and test-copy.html
```

No npm install, no bundler, no network. The build is a string-substitution
script by design — see `docs/DECISIONS.md`.

## Speed, honestly

The presets are labelled with *nominal* rates — codes on screen × swaps per
second × bytes per code. Real throughput is lower and is set by the camera, not
the screen. A forecast for a Logitech C920 at 1080p puts the practical sweet
spot at **2×2 · 1200–1400 B, roughly 60–84 KB/s nominal**, with the 3×3
"Ludicrous" preset below the decodable pixel threshold on that sensor. See
`docs/CAMERA.md` for the arithmetic.

No optical figure here has been measured on real hardware yet. Rather than
publish a table of blessed webcams, the tool measures your own: **Send test
signal** runs a calibration sweep and tells you which settings your camera
actually sustains.

## Verifying what you downloaded

This is a security-adjacent tool, so check what you run. Release assets are
published with their SHA-256; compare before opening:

```bash
sha256sum lightwire.html
```

Building from source reproduces the same file — `assemble.py` is string
substitution over the tracked inputs, with no network and no dependency
resolution.

## Licence

Lightwire is **Apache-2.0** — see `LICENSE`.

It embeds four third-party components, unmodified: **jsQR** and **ZXing-C++**
(Apache-2.0), **qrcode-generator** and **zxing-wasm** (MIT). Full texts,
copyright lines and the WASM provenance hash are in `THIRD-PARTY-NOTICES.md`,
and a condensed attribution block is embedded in `dist/lightwire.html` itself,
because that file is meant to travel alone.

No code was taken from any prior optical-transfer tool. The codec, base45
implementation, container format and wire protocol were written from scratch;
the projects that informed the design are credited under "Prior art" in
`THIRD-PARTY-NOTICES.md`.

## Read this next

- **Taking over the project?** → `docs/HANDOFF.md`
- **Deciding whether/where to publish?** → `docs/PUBLISHING.md`
- **Need to understand or modify the protocol?** → `docs/ARCHITECTURE.md`
- **Wondering why something is the way it is?** → `docs/DECISIONS.md`
- **Tuning speed against a specific camera?** → `docs/CAMERA.md`
