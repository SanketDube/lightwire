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

## Worked forecast: Logitech C920 (1080p)

Assuming the grid fills the camera frame:

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

1. Sender: click **Send test signal** (256 KB of incompressible noise — no gzip
   distortion of the numbers, no real file needed).
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
