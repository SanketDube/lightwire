# Camera capability and tuning

## The only number that matters

**Pixels per QR module at the sensor.** Not megapixels, not brand, not "HD".

```
px/module = (camera pixels the code spans) ÷ (modules across the code)
```

A ZXing-class decoder needs roughly **3 px per module** (Nyquist plus margin for
noise, compression, and imperfect alignment). Below that no camera upgrade
helps, because the information is simply not being sampled. At **4 or more** it
is comfortable.

The receiver panel computes this live from the detected code geometry and shows
a verdict. Use it rather than guessing.

## Module counts by payload

Roughly, at ECC level L:

| Bytes per code | base45 chars | Modules across |
|---|---|---|
| 600 | ~924 | ~85 |
| 1000 | ~1524 | ~109 |
| 1400 | ~2124 | ~125 |
| 2000 | ~3024 | ~157 |

Capacity ceiling is QR v40-L alphanumeric = 4296 characters, so 2000 B fits with
headroom. Higher ECC levels cost modules for the same payload.

## The first field run, 2026-08-10

The first time any of this met a real camera. Read off the receiving screen at
the end of a genuine transfer, not simulated:

| | |
|---|---|
| File | 12.82 MB `.pptx` |
| On the wire | 11.99 MB (gzip declined it, as expected for a compressed format) |
| Blocks | 15,718 at 800 B |
| Codes read | 16,176 — **1.029x overhead** |
| Decode rate | 77.5 codes/s |
| **Measured throughput** | **60.6 KB/s** |
| Engine | **ZXing (bundled)** |
| px / module | 3.3 — "adequate" |
| Result | Complete, checksum verified |

Three things this settles:

1. **The WASM engine works on real hardware.** That was the first line of the
   manual checklist and the one that would have invalidated grid mode entirely.
2. **60.6 KB/s is real optical throughput**, not a nominal figure. Every KB/s
   number published before this was arithmetic.
3. **1.029x overhead at K=15,718 matches `tests/overhead.js`** (1.030x at
   K=16,476) and contradicts the old "approaching 1.13x" claim, which has been
   corrected in `ARCHITECTURE.md`.

Worth noting it held 77.5 codes/s at only **3.3 px per module** — barely above
the 3.0 floor where decoding is expected to fall apart. The forecasts in this
file assumed that thin a margin would cost real throughput. It did not.

**Still unknown, so not claimed:** the camera model, the operating system, and
which grid and swap rate were in use. Only the block size (800 B) is inferable.
A calibration sweep on the same hardware would fill those in, and would be the
first ranked optical table this project has.

---

## Worked forecast: Logitech C920 (1080p)

**These remain forecasts.** They predate the field run above and have not been
reconciled against it. Assuming the grid fills the camera frame:

| Setting | Modules | Code span | px/module | Verdict |
|---|---|---|---|---|
| 1×1 · 600 B | 85 | ~1000 px | ~11 | trivial |
| 2×2 · 1000 B | 109 | ~510 px | ~4.7 | comfortable |
| 2×2 · 1400 B | 125 | ~510 px | ~4.1 | comfortable |
| 3×3 · 1400 B | 125 | ~335 px | ~2.7 | below threshold |

**Practical conclusion for the C920: 2×2 at 1200–1400 B is the sweet spot**
(~60–84 KB/s nominal). Ludicrous 3×3 is marginal even at perfect frame fill —
the sensor runs out of pixels, and no amount of tuning changes that.

A 720p laptop camera has two-thirds the pixel budget: 2×2 at 1000 B lands around
3.1, right on the edge. Many laptop cameras are also fixed-focus beyond ~40 cm,
which in practice bites harder than resolution.

## Tuning protocol

**The tool does this for you now.** The manual method is kept below because it
is still the right mental model, and because it is what you fall back on if you
want to tune a setting the ladder does not contain.

1. Receiver: start the camera and point it at the sending screen.
2. Sender: click **Send test signal**.
3. Fill the frame with the codes and hold steady. Lock focus if the camera
   offers it. The sweep takes about 40 seconds.
4. Read the verdict on the **receiving** screen. It names a row number, a grid,
   a bytes-per-code and a swaps-per-second.
5. Sender: click **Apply** on that row.

The sweep drives six settings — 1×1 at 600 and 1400 B, 2×2 at 800 and 1200 B,
3×3 at 800 and 1200 B — each for 6.5 seconds at 20 swaps per second, and ranks
them by the bytes per second the camera actually recovered. Missing codes
during a sweep costs nothing, exactly as it does during a real transfer.

Two readings worth understanding:

- **"sender-limited"** on the sending machine's table means it could not paint
  codes as fast as it was asked to. That is a CPU verdict, not a camera one;
  a faster machine would score that row higher.
- **"Predicted, not measured"** in the verdict is arithmetic, not observation.
  px/module is `(pixels the cell spans) ÷ (modules across)`, and the pixel span
  is fixed by where the camera is standing, so a denser code at the same grid
  can be computed rather than tested. Treat it as a hint to try, not a result.

### Doing it by hand

1. Sender: **Send test signal**, then **Skip — just stream** to stop the sweep
   and hold the current setting.
2. Start at the **Fast** preset.
3. Receiver: start camera, fill the frame with the grid.
4. Lock focus once the image is sharp.
5. Read **px/module**:
   - **> 4** → step the preset up.
   - **3–4** → works, expect some misses; fine, because misses are free.
   - **< 3** → move closer, or reduce bytes per code.
6. Then watch **measured KB/s** and step up until it stops climbing. Back off one.

The camera is the limit, not the screen.

## Practical notes

- **Prefer smaller codes over fewer codes.** If 3×3 reads ~2.7 px/module, drop
  bytes-per-code to 1000 (109 modules) before abandoning the grid. Smaller codes
  recover the ratio faster than fewer codes lose throughput.
- **The C920 delivers 1080p30 over MJPEG.** Compression artifacts soften module
  edges. A bright screen, a dim room, and locked focus recover most of that margin.
- **Check the reported camera resolution.** Browsers silently downgrade
  `getUserMedia` requests. If the receiver says 1280×720 when you expected 1920×1080,
  the negotiation failed and every number above shifts down accordingly.
- **Glare is the silent killer.** A reflection across the code destroys the
  finder patterns. Angle the screen slightly rather than adding light.
- **Grid mode needs a real engine.** On the jsQR fallback path only one code per
  frame is read, so grid mode gains nothing. Check the Engine readout.

## Where the numbers come from in code

- `modulesFor(text, eccIdx)` in `template.html` re-derives the module count by
  building a throwaway QR at the same ECC level — which is why the ECC level is
  carried in the frame flags.
- `handleFrame(txt, codeW)` receives the detected width from the engine layer and
  maintains an exponential moving average (α = 0.2).
- Verdict thresholds live in `paint()`: ≥4 comfortable, ≥3 adequate, else
  "too dense".
