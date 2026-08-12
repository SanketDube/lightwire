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

## Field runs on real hardware, 2026-08-10

Everything else in this file is arithmetic. These are not.

### Run 1 — 12.82 MB

| | |
|---|---|
| File | 12.82 MB `.pptx` |
| On the wire | 11.99 MB (gzip declined it, correct for an already-compressed format) |
| Blocks | 15,718 at 800 B |
| Codes read | 16,176 — **1.029x overhead** |
| Decode rate | 77.5 codes/s |
| **Measured throughput** | **60.6 KB/s** |
| Engine | **ZXing (bundled)** |
| px / module | 3.3 — "adequate" |
| Result | Complete, checksum verified |

### Runs 2 and 3 — 300 MB, twice

Same operator, same hardware, with the input cap manually raised. Read off the
receiving screen mid-transfer:

| | |
|---|---|
| File | 300.00 MB |
| Blocks | **393,217** at 800 B |
| Setting | **3x3 grid, 15 swaps/s, 800 B per code** |
| Decode rate | 81.9 codes/s, rising to **107.0 codes/s** after the operator adjusted focus by hand |
| **Measured throughput** | 63.9 KB/s, rising to **83.6 KB/s** after that adjustment |
| px / module | 3.2 — "adequate" |
| Engine | ZXing (bundled) |
| Result | Completed. Twice. |

### Runs 4, 5 and 6 — three completions, on v3.2.0

| | Run 4 | Run 5 | Run 6 |
|---|---|---|---|
| File | 300.00 MB | 17.08 MB | 300.00 MB |
| Blocks | 393,217 @ 800 B | 19,899 @ 900 B | 349,526 @ 900 B |
| Codes read | 409,304 | 20,377 | 362,893 |
| **Overhead** | 1.041x | 1.024x | 1.038x |
| Decode rate at the end | 27.4/s | 81.1/s | **102.4/s** |
| **Measured** | 21.4 KB/s | 71.3 KB/s | **90.0 KB/s** |
| px / module | 3.2 | 3.0 | 3.0 |
| Result | complete | complete | complete |

Run 6 is the best measured throughput this tool has produced: **90.0 KB/s at
900 B per code**, above the 800 B used in every earlier run. Run 4 is the one
that hit the drawing bug described below, which is why its end-of-run rate
reads 21 KB/s against the same setup managing 90.

The measured overheads (1.024x to 1.041x) sit slightly under the synthetic
figures in `ARCHITECTURE.md` — the progress estimate is therefore a touch
conservative, which is the safe direction for a bar that must never claim to be
finished early.

### What these settle

1. **The WASM engine works on real hardware.** First item on the manual
   checklist, and the one that would have made grid mode worthless.
2. **The throughput figures are real**, not nominal. Every KB/s published
   before this was arithmetic.
3. **3x3 is not aspirational after all.** This file used to say the 3x3 preset
   was "marginal even at perfect frame fill" and "below threshold" on a 1080p
   sensor. It was then measured running 3x3 at 800 B for an hour at 3.2
   px/module. The forecast was wrong because it was computed at 1400 B (125
   modules); at 800 B a cell is only 97 modules, and that difference is exactly
   the "prefer smaller codes over fewer codes" rule further down this page.
   The rule was right; the summary line contradicting it was not.
4. **3.2 px/module is enough.** Both runs sat barely above the 3.0 floor and
   still held their rate. The margin above 3.0 is worth less than this file
   previously implied.
5. **Manual focus is worth doing.** The operator's own note: *"I had to adjust
   the focus manually to get best results."* It moved the same transfer from
   63.9 to 83.6 KB/s — a **31% gain** from one adjustment, more than most
   setting changes achieve. Autofocus hunting on a static screen is the single
   biggest recoverable loss.
6. **300 MB is fine.** The shipped cap was 32 MB, and that was wrong rather
   than cautious. It is now 512 MB hard, with a warning above 64 MB.
   See `DECISIONS.md` §18.

### A throughput bug the 300 MB run exposed

The operator reported the transfer *"slowed down to nearly 10-15% of usual
speed towards the end"*. It was not the camera and not the codec. The block
coverage grid drew one rectangle per block — 393,217 of them — every time the
solved count changed, and the solved count changes on nearly every code once
the decode cascade starts. Measured: **177 ms per redraw**, against the 7.4 ms
per code a 135 codes/s link allows. The tail cost about an hour of wall clock.

Fixed in v3.2.0 by removing the grid entirely and moving the ACK redraw onto a
timer. `DECISIONS.md` §17.

### A measurement bug the 300 MB run exposed

Mid-run the receiver reported **141.5 codes/s**. That figure is impossible:
3x3 at 15 swaps per second is a hard ceiling of **135** distinct codes per
second, because that is all the sending screen can draw. Two faults, now fixed:

- **The rate window was 60 samples, not a span of time.** The engine returns
  every code it finds in one camera frame, so up to nine arrive sharing a
  timestamp. At high rates 60 samples covered under half a second — short
  enough that one burst set the whole reading. The window is now three seconds
  of wall clock, and reports nothing until it has a full second to work with.
- **n samples span n-1 intervals.** Dividing by n inflated everything slightly.

This matters beyond cosmetics: the rate is multiplied by the block size to give
the **KB/s** figure people quote, and it is the number the calibration sweep
ranks settings on. **Treat any KB/s reading taken before this fix as up to
~5% optimistic**, including the 60.6 and 83.6 figures above.

### The gap between nominal and measured

3x3 x 15 swaps/s x 800 B is **105.5 KB/s nominal**. Measured was 83.6 KB/s,
and the decode rate was 107 codes/s against 135 offered. Both come to **79%**.
So roughly one code in five is never read — and it costs nothing, which is the
whole point of the fountain coding. Treat nominal as about a quarter optimistic
on a good link, rather than as a target.

**Nominal is also a genuine ceiling, and worth using as a sanity check.** No
sustained decode rate can exceed `grid x grid x swaps per second`, because the
sender cannot produce more distinct codes than that. A reading above it means
the measurement is wrong, not that the link is fast — which is exactly how the
bug above was caught.

### The decoder was doing work it did not need to

The operator asked whether the tool converts to grayscale or adjusts contrast.
It does neither: the video frame is drawn to a canvas and handed to ZXing as
raw RGBA. **ZXing does the greyscale conversion and the thresholding itself**,
and by default it uses a *local average* threshold — it decides light-vs-dark
per region rather than once for the whole frame. That is why glare on one
corner does not destroy the whole grid. Swapping it for a global threshold was
tried and decoded **0 of 9** codes on the same image.

What it *was* doing needlessly: searching for rotated codes and for downscaled
ones. Measured on a blurred, noised 3x3 grid of 900 B codes at 1920x1080:

| Options | Decode time | Codes found |
|---|---|---|
| as shipped | 63.6 ms | 9/9 |
| no rotate search | 58.8 ms | 9/9 |
| no downscale search | 56.3 ms | 9/9 |
| **no rotate + no downscale** | **48.2 ms** | **9/9** |
| also no inversion search | 43.9 ms | 9/9 — **but 0/9 on an inverted screen** |

The first three switches cost nothing, because QR finder patterns are already
rotation-invariant and the codes always fill a known fraction of the frame.
**24% off the decode time**, which raises the ceiling from ~142 to ~187
codes/s. The inversion search is kept: a forced dark mode on the sending
machine would invert the codes, and without it every code is lost.

Adopted in v3.3.0. Decode time is the thing that caps codes/s, which caps
throughput, so this is the most valuable single knob in the file.

**Still unrecorded:** camera model and operating system.

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

~~**Practical conclusion for the C920: 2×2 at 1200–1400 B is the sweet spot.**
Ludicrous 3×3 is marginal even at perfect frame fill.~~ **Superseded by the
field runs above:** 3×3 at *800 B* was measured working for an hour. The
forecast only ever evaluated 3×3 at 1400 B, which is the dense end of a lever
this same page tells you to back off first. Do not repeat that mistake when
extending the table — vary bytes-per-code as well as grid.

A 720p laptop camera has two-thirds the pixel budget: 2×2 at 1000 B lands around
3.1, right on the edge. Many laptop cameras are also fixed-focus beyond ~40 cm,
which in practice bites harder than resolution.

## Tuning protocol

**The tool does this for you now.** The manual method is kept below because it
is still the right mental model, and because it is what you fall back on if you
want to tune a setting the ladder does not contain.

1. Receiver: start the camera and point it at the sending screen.
2. Sender: click **Send test signal**. It shows a steady pattern and **waits**.
3. **Aim.** No clock is running. Fill the frame, square on, and adjust angle,
   distance and focus while watching **px/module** on the receiving screen. It
   also shows the best value you have reached, so you can tell whether your
   last move helped. Take as long as you like — this is the part that pays.
4. Sender: press **Start sweep**.
5. Each of eight settings runs for 12 seconds. Press **Hold this one** to stop
   the clock on any of them and keep adjusting; **Next setting** to move on.
6. Read the verdict on the **receiving** screen. It names a row number, a grid,
   a bytes-per-code and a swaps-per-second.
7. Sender: click **Apply** on that row.

The ladder is 1×1 at 600 and 1400 B, 2×2 at 800, 1100 and 1400 B, and 3×3 at
700, 900 and 1100 B, all at 20 swaps per second — faster than any preset, so
that the *camera* is the bottleneck being measured rather than the ladder.
Ranking is by the bytes per second actually recovered. Missing codes during a
sweep costs nothing, exactly as during a real transfer.

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
